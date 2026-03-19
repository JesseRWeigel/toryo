import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRatchet } from '../ratchet.js';
import type { ReviewResult } from '../types.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function makeReview(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    score: 7.0,
    verdict: 'pass',
    feedback: 'Looks good',
    ...overrides,
  };
}

/** Create a temporary git repo for integration tests */
async function makeTempRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'toryo-ratchet-'));
  await execFileAsync('git', ['init'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  // Create an initial commit so we have a branch
  await writeFile(join(dir, 'README.md'), '# test');
  await execFileAsync('git', ['add', '.'], { cwd: dir });
  await execFileAsync('git', ['commit', '-m', 'init'], { cwd: dir });
  return dir;
}

describe('createRatchet', () => {
  // Use a dummy cwd — the pure functions don't need a real one
  const cwd = '/tmp/toryo-test';

  describe('shouldKeep', () => {
    it('returns true when score meets threshold', () => {
      const r = createRatchet({}, cwd);
      expect(r.shouldKeep(makeReview({ score: 6.0 }))).toBe(true);
    });

    it('returns true when score exceeds threshold', () => {
      const r = createRatchet({}, cwd);
      expect(r.shouldKeep(makeReview({ score: 9.0 }))).toBe(true);
    });

    it('returns false when score is below threshold', () => {
      const r = createRatchet({}, cwd);
      expect(r.shouldKeep(makeReview({ score: 5.9 }))).toBe(false);
    });

    it('respects custom threshold', () => {
      const r = createRatchet({ threshold: 8.0 }, cwd);
      expect(r.shouldKeep(makeReview({ score: 7.5 }))).toBe(false);
      expect(r.shouldKeep(makeReview({ score: 8.0 }))).toBe(true);
    });

    it('handles edge case of score exactly at threshold', () => {
      const r = createRatchet({ threshold: 7.0 }, cwd);
      expect(r.shouldKeep(makeReview({ score: 7.0 }))).toBe(true);
    });

    it('handles score of 0', () => {
      const r = createRatchet({}, cwd);
      expect(r.shouldKeep(makeReview({ score: 0 }))).toBe(false);
    });

    it('handles score of 10', () => {
      const r = createRatchet({}, cwd);
      expect(r.shouldKeep(makeReview({ score: 10 }))).toBe(true);
    });
  });

  describe('canRetry', () => {
    it('returns true when retryCount is below maxRetries', () => {
      const r = createRatchet({ maxRetries: 2 }, cwd);
      expect(r.canRetry(0)).toBe(true);
      expect(r.canRetry(1)).toBe(true);
    });

    it('returns false when retryCount meets maxRetries', () => {
      const r = createRatchet({ maxRetries: 2 }, cwd);
      expect(r.canRetry(2)).toBe(false);
    });

    it('returns false when retryCount exceeds maxRetries', () => {
      const r = createRatchet({ maxRetries: 1 }, cwd);
      expect(r.canRetry(3)).toBe(false);
    });

    it('returns false for default maxRetries=1 when retryCount=1', () => {
      const r = createRatchet({}, cwd);
      expect(r.canRetry(0)).toBe(true);
      expect(r.canRetry(1)).toBe(false);
    });

    it('handles maxRetries=0 (no retries allowed)', () => {
      const r = createRatchet({ maxRetries: 0 }, cwd);
      expect(r.canRetry(0)).toBe(false);
    });
  });

  describe('getVerdict', () => {
    it('returns keep when score meets threshold', () => {
      const r = createRatchet({}, cwd);
      expect(r.getVerdict(makeReview({ score: 7.0 }), 0)).toBe('keep');
    });

    it('returns discard when score below threshold and retries exhausted', () => {
      const r = createRatchet({ maxRetries: 1 }, cwd);
      expect(r.getVerdict(makeReview({ score: 4.0 }), 1)).toBe('discard');
    });

    it('returns discard when score below threshold even with retries left', () => {
      // Current implementation always returns discard when below threshold
      const r = createRatchet({ maxRetries: 3 }, cwd);
      expect(r.getVerdict(makeReview({ score: 4.0 }), 0)).toBe('discard');
    });

    it('returns keep regardless of retry count when score passes', () => {
      const r = createRatchet({}, cwd);
      expect(r.getVerdict(makeReview({ score: 8.0 }), 5)).toBe('keep');
    });
  });

  describe('buildRetryPrompt', () => {
    it('includes QA feedback and original prompt', () => {
      const r = createRatchet({}, cwd);
      const result = r.buildRetryPrompt('Write a function', 'Missing error handling');
      expect(result).toContain('QA Feedback');
      expect(result).toContain('Missing error handling');
      expect(result).toContain('Original Task');
      expect(result).toContain('Write a function');
    });

    it('includes improvement instruction', () => {
      const r = createRatchet({}, cwd);
      const result = r.buildRetryPrompt('task', 'feedback');
      expect(result).toContain('Address the feedback');
      expect(result).toContain('improved version');
    });

    it('handles empty strings', () => {
      const r = createRatchet({}, cwd);
      const result = r.buildRetryPrompt('', '');
      expect(result).toContain('QA Feedback');
      expect(result).toContain('Original Task');
    });

    it('preserves multiline feedback', () => {
      const r = createRatchet({}, cwd);
      const feedback = 'Issue 1: missing tests\nIssue 2: no docs\nIssue 3: bad naming';
      const result = r.buildRetryPrompt('task', feedback);
      expect(result).toContain('Issue 1: missing tests');
      expect(result).toContain('Issue 3: bad naming');
    });
  });

  describe('config', () => {
    it('uses default config values', () => {
      const r = createRatchet({}, cwd);
      expect(r.config.threshold).toBe(6.0);
      expect(r.config.maxRetries).toBe(1);
      expect(r.config.gitStrategy).toBe('commit-revert');
    });

    it('merges custom config', () => {
      const r = createRatchet({ threshold: 8.0, maxRetries: 3 }, cwd);
      expect(r.config.threshold).toBe(8.0);
      expect(r.config.maxRetries).toBe(3);
      expect(r.config.gitStrategy).toBe('commit-revert');
    });
  });

  describe('branch-per-task (integration)', () => {
    let repoDir: string;

    beforeEach(async () => {
      repoDir = await makeTempRepo();
    });

    afterEach(async () => {
      await rm(repoDir, { recursive: true, force: true });
    });

    it('createBranch creates and checks out a new branch', async () => {
      const r = createRatchet({ gitStrategy: 'branch-per-task' }, repoDir);
      const result = await r.createBranch('toryo/test-task');
      expect(result).toBe(true);

      const branch = await r.getCurrentBranch();
      expect(branch).toBe('toryo/test-task');
      expect(r.originalBranch).toBe('master');
      expect(r.currentTaskBranch).toBe('toryo/test-task');
    });

    it('createBranch returns false for invalid branch name', async () => {
      const r = createRatchet({ gitStrategy: 'branch-per-task' }, repoDir);
      // Space in branch name is invalid
      const result = await r.createBranch('invalid branch name');
      expect(result).toBe(false);
    });

    it('mergeBranch merges task branch back and deletes it', async () => {
      const r = createRatchet({ gitStrategy: 'branch-per-task' }, repoDir);
      await r.createBranch('toryo/merge-test');

      // Make a commit on the task branch
      await writeFile(join(repoDir, 'feature.txt'), 'new feature');
      await r.commit('add feature', ['feature.txt']);

      const result = await r.mergeBranch('toryo/merge-test');
      expect(result).toBe(true);

      const branch = await r.getCurrentBranch();
      expect(branch).toBe('master');
      expect(r.currentTaskBranch).toBeNull();
      expect(r.originalBranch).toBeNull();

      // Branch should be deleted
      const { stdout } = await execFileAsync('git', ['branch'], { cwd: repoDir });
      expect(stdout).not.toContain('toryo/merge-test');
    });

    it('deleteBranch checks out original and force-deletes the branch', async () => {
      const r = createRatchet({ gitStrategy: 'branch-per-task' }, repoDir);
      await r.createBranch('toryo/delete-test');

      // Make a commit so the branch diverges
      await writeFile(join(repoDir, 'tmp.txt'), 'temp');
      await r.commit('temp commit', ['tmp.txt']);

      const result = await r.deleteBranch('toryo/delete-test');
      expect(result).toBe(true);

      const branch = await r.getCurrentBranch();
      expect(branch).toBe('master');
      expect(r.currentTaskBranch).toBeNull();

      // Branch should be gone
      const { stdout } = await execFileAsync('git', ['branch'], { cwd: repoDir });
      expect(stdout).not.toContain('toryo/delete-test');
    });

    it('commit auto-creates a branch in branch-per-task mode', async () => {
      const r = createRatchet({ gitStrategy: 'branch-per-task' }, repoDir);
      expect(r.currentTaskBranch).toBeNull();

      await writeFile(join(repoDir, 'auto.txt'), 'auto-branched');
      const hash = await r.commit('Auto Branch Task', ['auto.txt']);

      expect(hash).toBeTruthy();
      expect(r.currentTaskBranch).toBe('toryo/auto-branch-task');
      expect(r.originalBranch).toBe('master');

      const branch = await r.getCurrentBranch();
      expect(branch).toBe('toryo/auto-branch-task');
    });

    it('commit reuses existing task branch on subsequent calls', async () => {
      const r = createRatchet({ gitStrategy: 'branch-per-task' }, repoDir);

      await writeFile(join(repoDir, 'first.txt'), 'first');
      await r.commit('My Task', ['first.txt']);
      const branchAfterFirst = r.currentTaskBranch;

      await writeFile(join(repoDir, 'second.txt'), 'second');
      await r.commit('My Task again', ['second.txt']);
      const branchAfterSecond = r.currentTaskBranch;

      expect(branchAfterFirst).toBe(branchAfterSecond);
    });

    it('revert in branch-per-task deletes the task branch', async () => {
      const r = createRatchet({ gitStrategy: 'branch-per-task' }, repoDir);

      await writeFile(join(repoDir, 'revert.txt'), 'will be reverted');
      await r.commit('Revert Task', ['revert.txt']);

      expect(r.currentTaskBranch).toBeTruthy();

      const result = await r.revert();
      expect(result).toBe(true);

      const branch = await r.getCurrentBranch();
      expect(branch).toBe('master');
      expect(r.currentTaskBranch).toBeNull();
    });

    it('revert in commit-revert mode still does git reset', async () => {
      const r = createRatchet({ gitStrategy: 'commit-revert' }, repoDir);

      await writeFile(join(repoDir, 'file.txt'), 'content');
      const hash = await r.commit('commit to revert', ['file.txt']);
      expect(hash).toBeTruthy();

      const result = await r.revert();
      expect(result).toBe(true);

      // Should still be on master, no task branch involved
      const branch = await r.getCurrentBranch();
      expect(branch).toBe('master');
    });

    it('isGitRepo returns true for a real repo', async () => {
      const r = createRatchet({}, repoDir);
      expect(await r.isGitRepo()).toBe(true);
    });

    it('isGitRepo returns false for a non-repo directory', async () => {
      const nonRepo = await mkdtemp(join(tmpdir(), 'toryo-no-git-'));
      const r = createRatchet({}, nonRepo);
      expect(await r.isGitRepo()).toBe(false);
      await rm(nonRepo, { recursive: true, force: true });
    });
  });
});
