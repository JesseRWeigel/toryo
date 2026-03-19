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

  async function commit(message: string, paths: string[] = ['.']): Promise<string | null> {
    if (cfg.gitStrategy === 'none') return null;

    try {
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
    commit,
    revert,
    shouldKeep,
    getVerdict,
    canRetry,
    buildRetryPrompt,
    config: cfg,
  };
}
