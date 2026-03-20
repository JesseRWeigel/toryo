import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RatchetConfig, ReviewResult, CycleVerdict } from './types.js';

const execFileAsync = promisify(execFile);

const DEFAULT_CONFIG: RatchetConfig = {
  threshold: 6.0,
  maxRetries: 1,
  gitStrategy: 'commit-revert',
};

export function createRatchet(config: Partial<RatchetConfig> = {}, cwd: string) {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  /** Tracks the branch we were on before creating a task branch */
  let originalBranch: string | null = null;
  /** Tracks the current task branch name */
  let currentTaskBranch: string | null = null;

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

  /** Check out the original branch and delete the task branch */
  async function deleteBranch(name: string): Promise<boolean> {
    try {
      const target = originalBranch ?? 'main';
      await git('checkout', target);
      await git('branch', '-D', name);
      if (currentTaskBranch === name) currentTaskBranch = null;
      originalBranch = null;
      return true;
    } catch {
      return false;
    }
  }

  async function commit(message: string, paths: string[] = ['.']): Promise<string | null> {
    if (cfg.gitStrategy === 'none') return null;

    try {
      // For branch-per-task, create a branch if we haven't yet
      if (cfg.gitStrategy === 'branch-per-task' && !currentTaskBranch) {
        const branchName = `toryo/${message.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
        const created = await createBranch(branchName);
        if (!created) return null;
      }

      for (const p of paths) {
        await git('add', p);
      }
      const status = await git('status', '--porcelain');
      if (!status) return null;

      await git('commit', '-m', message);
      const hash = await git('rev-parse', '--short', 'HEAD');
      return hash;
    } catch {
      return null;
    }
  }

  async function revert(): Promise<boolean> {
    if (cfg.gitStrategy === 'none') return false;

    try {
      if (cfg.gitStrategy === 'branch-per-task' && currentTaskBranch) {
        return deleteBranch(currentTaskBranch);
      }
      // Safety check: warn if there are uncommitted changes outside the toryo output
      const status = await git('status', '--porcelain');
      const untrackedLines = status.split('\n').filter(
        (line) => line.trim() && !line.includes('.toryo') && !line.startsWith('??'),
      );
      if (untrackedLines.length > 0) {
        // There are modified tracked files outside .toryo — only reset the last commit
        // rather than risking data loss on unrelated work
        console.warn('[toryo] Warning: uncommitted changes detected outside .toryo, reverting last commit only');
      }
      await git('reset', 'HEAD~1', '--hard');
      return true;
    } catch {
      return false;
    }
  }

  function shouldKeep(review: ReviewResult): boolean {
    return review.score >= cfg.threshold;
  }

  function getVerdict(review: ReviewResult, retryCount: number): CycleVerdict {
    if (review.score >= cfg.threshold) return 'keep';
    if (retryCount >= cfg.maxRetries) return 'discard';
    return 'discard';
  }

  function canRetry(retryCount: number): boolean {
    return retryCount < cfg.maxRetries;
  }

  function buildRetryPrompt(originalPrompt: string, feedback: string): string {
    return [
      'Your previous attempt was reviewed and needs revision.',
      '',
      '## QA Feedback',
      feedback,
      '',
      '## Original Task',
      originalPrompt,
      '',
      'Address the feedback above and produce an improved version.',
    ].join('\n');
  }

  return {
    isGitRepo,
    getCurrentBranch,
    createBranch,
    mergeBranch,
    deleteBranch,
    commit,
    revert,
    shouldKeep,
    getVerdict,
    canRetry,
    buildRetryPrompt,
    config: cfg,
    /** The branch we were on before creating a task branch */
    get originalBranch() { return originalBranch; },
    /** The current task branch name, if any */
    get currentTaskBranch() { return currentTaskBranch; },
  };
}
