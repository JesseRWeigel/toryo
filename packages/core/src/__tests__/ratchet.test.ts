import { describe, it, expect } from 'vitest';
import { createRatchet } from '../ratchet.js';
import type { ReviewResult } from '../types.js';

function makeReview(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    score: 7.0,
    verdict: 'pass',
    feedback: 'Looks good',
    ...overrides,
  };
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
});
