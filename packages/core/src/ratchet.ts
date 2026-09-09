import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { relative, resolve, isAbsolute, sep } from 'node:path';
import { open, readFile, writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { RatchetConfig, ReviewResult, CycleVerdict } from './types.js';

const execFileAsync = promisify(execFile);

const DEFAULT_CONFIG: RatchetConfig = {
  threshold: 6.0,
  maxRetries: 1,
  gitStrategy: 'commit-revert',
};

export function createRatchet(config: Partial<RatchetConfig> = {}, cwd: string) {
  const cfg = { ...DEFAULT_CONFIG, ...structuredClone(config) };

  /** Tracks the branch we were on before creating a task branch */
  let originalBranch: string | null = null;
  /** Tracks the current task branch name */
  let currentTaskBranch: string | null = null;

  // Full identities, never inferred from HEAD~1. A failed attempt remains pending
  // so a subsequent cycle cannot silently claim its edits.
  let attempt: { base: string; branch: string } | null = null;
  let checkpoint: { base: string; hash: string; branch: string } | null = null;

  let lockPath: string | null = null;
  const lockId = randomUUID();

  async function ownsLock(): Promise<boolean> {
    if (!lockPath) return false;
    try {
      return JSON.parse(await readFile(lockPath, 'utf8')).id === lockId;
    } catch {
      return false;
    }
  }

  async function persistBoundary(): Promise<void> {
    if (!lockPath || !(await ownsLock()))
      throw new Error('Ratchet lock ownership changed; inspect preserved work');
    await writeFile(
      lockPath,
      JSON.stringify(
        {
          id: lockId,
          pid: process.pid,
          cwd,
          base: attempt?.base,
          branch: checkpoint?.branch ?? attempt?.branch,
          checkpoint: checkpoint?.hash,
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  }

  async function releaseLock(): Promise<void> {
    if (!lockPath || !(await ownsLock()))
      throw new Error('Ratchet lock ownership changed; inspect preserved work');
    await unlink(lockPath);
    lockPath = null;
  }

  /** Safe git execution — uses execFile (array args, no shell injection) */
  async function git(...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, { cwd });
    return stdout.trim();
  }

  async function isGitRepo(): Promise<boolean> {
    try {
      await git('rev-parse', '--is-inside-work-tree');
      return true;
    } catch {
      return false;
    }
  }

  /** Get the current branch name */
  async function getCurrentBranch(): Promise<string> {
    return git('rev-parse', '--abbrev-ref', 'HEAD');
  }

  /** Create and check out a new branch */
  async function createBranch(name: string): Promise<boolean> {
    try {
      originalBranch = await getCurrentBranch();
      await git('checkout', '-b', name);
      currentTaskBranch = name;
      return true;
    } catch {
      return false;
    }
  }

  /** Merge a task branch back to the original branch and delete it */
  async function mergeBranch(name: string): Promise<boolean> {
    try {
      const target = originalBranch ?? 'main';
      await git('checkout', target);
      await git('merge', name);
      await git('branch', '-d', name);
      if (currentTaskBranch === name) currentTaskBranch = null;
      originalBranch = null;
      return true;
    } catch {
      return false;
    }
  }

  /** Delete only our fully merged task branch; never force-delete unique work. */
  async function deleteBranch(name: string): Promise<boolean> {
    try {
      if (
        name !== currentTaskBranch ||
        !originalBranch ||
        (await getCurrentBranch()) !== name ||
        (await git('status', '--porcelain', '--untracked-files=all'))
      )
        return false;
      const target = originalBranch;
      await git('merge-base', '--is-ancestor', name, target);
      await git('checkout', target);
      await git('branch', '-d', name);
      if (currentTaskBranch === name) currentTaskBranch = null;
      originalBranch = null;
      return true;
    } catch {
      return false;
    }
  }

  /** Refuse to take ownership of pre-existing user work. */
  async function beginAttempt(outputDir?: string): Promise<void> {
    if (cfg.gitStrategy === 'none') return;
    if (attempt)
      throw new Error(
        'Checkpoint attempt is still pending; inspect preserved work before continuing',
      );
    const commonDir = await git('rev-parse', '--git-common-dir');
    const candidate = resolve(cwd, commonDir, 'toryo-ratchet.lock');
    let handle;
    try {
      handle = await open(candidate, 'wx');
    } catch (error) {
      throw new Error(
        `Ratchet lock unavailable at ${candidate}; another run is active or recovery is required`,
        { cause: error },
      );
    }
    lockPath = candidate;
    try {
      await handle.writeFile(JSON.stringify({ id: lockId, pid: process.pid, cwd }));
    } finally {
      await handle.close();
    }
    try {
      if (await git('rev-parse', '--show-prefix')) {
        throw new Error('Run the Git ratchet from the repository root');
      }
      if (outputDir) {
        const path = relative(resolve(cwd), resolve(cwd, outputDir)).split(sep).join('/');
        if (!path) throw new Error('Ratchet outputDir must not be the repository root');
        if (path !== '..' && !path.startsWith('../') && !isAbsolute(path)) {
          // Runtime artifacts change after QA/metrics. They must not be part of a
          // source checkpoint, including when outputDir uses a custom name.
          if (await git('ls-files', '--', `:(literal)${path}`)) {
            throw new Error(
              'Ratchet outputDir contains tracked files; use an ignored runtime directory',
            );
          }
          try {
            await git('check-ignore', '-q', '--', `${path}/`);
          } catch {
            throw new Error(
              'Ratchet outputDir must be gitignored (or outside the repository) before starting',
            );
          }
        }
      }
      if (await git('status', '--porcelain', '--untracked-files=all')) {
        throw new Error(
          'Ratchet requires a clean working tree and index; commit your work or use an isolated worktree',
        );
      }
      checkpoint = null;
      attempt = { base: await git('rev-parse', 'HEAD'), branch: await getCurrentBranch() };
      await persistBoundary();
    } catch (error) {
      attempt = null;
      await releaseLock();
      throw error;
    }
  }

  async function commit(message: string, paths: string[] = ['.']): Promise<string | null> {
    if (cfg.gitStrategy === 'none') return null;
    if (!attempt || !(await ownsLock()))
      throw new Error('Call beginAttempt before creating a checkpoint');
    if (checkpoint)
      throw new Error('An attempt already has a checkpoint; accept or revert it first');
    try {
      const base = attempt.base;
      if (
        (await git('rev-parse', 'HEAD')) !== base ||
        (attempt && (await getCurrentBranch()) !== attempt.branch)
      ) {
        throw new Error(
          'HEAD or branch changed during the attempt; preserving work for inspection',
        );
      }
      if (cfg.gitStrategy === 'branch-per-task' && !currentTaskBranch) {
        const branchName = `toryo/${message
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')}`;
        if (!(await createBranch(branchName))) throw new Error('Could not create task branch');
      }
      for (const p of paths) await git('add', '-A', '--', p);
      // Inspect the index, not the whole worktree: no staged diff is a genuine
      // no-op, distinct from a failed commit. Never reuse a previous checkpoint.
      const changed = await git('diff', '--cached', '--name-only');
      const branch = await getCurrentBranch();
      if (!changed) {
        checkpoint = { base, hash: base, branch };
        await persistBoundary();
        return null;
      }
      await git('commit', '-m', message);
      const hash = await git('rev-parse', 'HEAD');
      if ((await git('rev-parse', `${hash}^`)) !== base) {
        throw new Error('Checkpoint parent does not match attempt base');
      }
      checkpoint = { base, hash, branch };
      await persistBoundary();
      return hash;
    } catch (error) {
      throw new Error('Checkpoint commit failed; work is preserved and QA must not continue', {
        cause: error,
      });
    }
  }

  async function isCheckpointCurrent(): Promise<boolean> {
    return (
      (await ownsLock()) &&
      checkpoint !== null &&
      (await git('rev-parse', 'HEAD')) === checkpoint.hash &&
      (await getCurrentBranch()) === checkpoint.branch &&
      !(await git('status', '--porcelain', '--untracked-files=all'))
    );
  }

  async function accept(): Promise<void> {
    if (cfg.gitStrategy === 'none') return;
    if (!(await isCheckpointCurrent())) {
      throw new Error(
        'Checkpoint changed during review; preserving work instead of accepting unreviewed edits',
      );
    }
    await releaseLock();
    attempt = null;
    checkpoint = null;
  }

  async function revert(): Promise<boolean> {
    if (cfg.gitStrategy === 'none') return false;
    try {
      if (!(await isCheckpointCurrent()) || !checkpoint) return false;
      if (checkpoint.hash !== checkpoint.base) {
        // Undo only our verified checkpoint. Keep history and accepted work on
        // task branches; deleting the whole branch could discard earlier keeps.
        await git('revert', '--no-edit', checkpoint.hash);
        if (
          (await getCurrentBranch()) !== checkpoint.branch ||
          (await git('rev-parse', 'HEAD^')) !== checkpoint.hash ||
          (await git('rev-parse', 'HEAD^{tree}')) !==
            (await git('rev-parse', `${checkpoint.base}^{tree}`)) ||
          (await git('status', '--porcelain', '--untracked-files=all'))
        )
          return false;
      }
      await releaseLock();
      checkpoint = null;
      attempt = null;
      return true;
    } catch {
      // Do not reset/abort automatically: preserve any conflict state for review.
      return false;
    }
  }

  function shouldKeep(review: ReviewResult): boolean {
    const required = cfg.requiredChecks ?? [];
    if (required.length > 0) {
      const evidence = review.evidence;
      const refs = review.evidenceRefs;
      if (!evidence || !refs || review.checksPassed !== true || evidence.checks.length !== required.length)
        return false;
      const ids = [evidence.patch.id, ...evidence.checks.map((check) => check.id)];
      if (new Set(ids).size !== ids.length || refs.length !== ids.length ||
        new Set(refs).size !== refs.length || ids.some((id) => !refs.includes(id))) return false;
      for (const check of required) {
        const captured = evidence.checks.find((entry) => entry.id.startsWith(`check:${check.id}:`));
        if (!captured || captured.command !== check.command ||
          JSON.stringify(captured.args) !== JSON.stringify(check.args ?? [])) return false;
      }
    }
    return Number.isFinite(review.score) && review.score >= 0 && review.score <= 10 &&
      review.score >= cfg.threshold && review.verdict === 'pass' &&
      !review.validationError && review.checksPassed !== false &&
      (review.evidence?.checks.every((check) => check.exitCode === 0 && !check.error) ?? true);
  }

  function getVerdict(review: ReviewResult, retryCount: number): CycleVerdict {
    if (shouldKeep(review)) return 'keep';
    if (retryCount >= cfg.maxRetries) return 'discard';
    return 'discard';
  }

  function canRetry(retryCount: number): boolean {
    return retryCount < cfg.maxRetries;
  }

  function buildRetryPrompt(originalPrompt: string, feedback: string, attempt = 1): string {
    return [
      `## Revision Required (Attempt ${attempt + 1})`,
      '',
      'Your previous attempt scored below the quality threshold and was rejected.',
      'Read the QA feedback carefully and address EVERY issue mentioned.',
      '',
      '### What went wrong',
      feedback,
      '',
      '### Key instructions for this retry',
      '- Fix the specific issues identified in the feedback above',
      '- Do NOT repeat the same approach if it was criticized',
      '- Be more concrete and specific in your output',
      '- If the feedback says output was too vague, include actual code/examples',
      '- If the feedback says criteria were missed, address each criterion explicitly',
      '',
      '### Original Task',
      originalPrompt,
    ].join('\n');
  }

  return {
    isGitRepo,
    getCurrentBranch,
    createBranch,
    mergeBranch,
    deleteBranch,
    beginAttempt,
    commit,
    accept,
    revert,
    shouldKeep,
    getVerdict,
    canRetry,
    buildRetryPrompt,
    config: structuredClone(cfg),
    /** The branch we were on before creating a task branch */
    get originalBranch() {
      return originalBranch;
    },
    /** The current task branch name, if any */
    get currentTaskBranch() {
      return currentTaskBranch;
    },
  };
}
