import { describe, expect, it } from 'vitest';
import { parseReview } from '../review.js';
import type { ReviewEvidence } from '../types.js';

const evidence: ReviewEvidence = {
  patch: {
    id: 'patch:abc123',
    base: 'abc123',
    head: 'def456',
    diff: 'diff --git a/a.ts b/a.ts',
  },
  checks: [
    {
      id: 'check:test',
      command: 'npm',
      args: ['test'],
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
    },
    {
      id: 'check:build',
      command: 'npm',
      args: ['run', 'build'],
      exitCode: 0,
      stdout: 'built',
      stderr: '',
    },
  ],
};

function review(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    score: 8,
    verdict: 'pass',
    feedback: 'The patch meets the acceptance criteria.',
    evidenceRefs: ['patch:abc123', 'check:test', 'check:build'],
    ...overrides,
  });
}

describe('parseReview', () => {
  it('parses a strict review and attaches the independently captured evidence', () => {
    expect(parseReview(review(), 8, evidence)).toEqual({
      score: 8,
      verdict: 'pass',
      feedback: 'The patch meets the acceptance criteria.',
      evidenceRefs: ['patch:abc123', 'check:test', 'check:build'],
      evidence,
      checksPassed: true,
    });
  });

  it('accepts one whole JSON fenced block', () => {
    const output = `\n\`\`\`json\n${review()}\n\`\`\`\n`;
    expect(parseReview(output, 8, evidence).verdict).toBe('pass');
  });

  it.each([
    ['leading prose', `Review follows:\n${review()}`],
    ['trailing prose', `${review()}\nLooks good`],
    ['multiple objects', `${review()}\n${review()}`],
    ['non-JSON fence', `\`\`\`\n${review()}\n\`\`\``],
    ['malformed JSON', '{"score": 8'],
    ['array root', '[]'],
  ])('rejects ambiguous or malformed output: %s', (_name, output) => {
    expect(() => parseReview(output, 8, evidence)).toThrow(/review/i);
  });

  it.each([
    ['extra field', { extra: true }],
    ['wrong score type', { score: '8' }],
    ['negative score', { score: -1 }],
    ['score above ten', { score: 11 }],
    ['unknown verdict', { verdict: 'keep' }],
    ['blank feedback', { feedback: '   ' }],
    ['empty evidence references', { evidenceRefs: [] }],
    ['blank evidence reference', { evidenceRefs: ['patch:abc123', 'check:test', ' '] }],
    ['non-string evidence reference', { evidenceRefs: ['patch:abc123', 'check:test', 42] }],
  ])('rejects invalid schema: %s', (_name, overrides) => {
    expect(() => parseReview(review(overrides), 8, evidence)).toThrow(/review/i);
  });

  it('rejects a non-finite score expressed as a valid JSON number', () => {
    const output = review().replace('"score":8', '"score":1e309');
    expect(() => parseReview(output, 8, evidence)).toThrow(/score/i);
  });

  it.each([
    ['literal duplicate', '{"score":8,"score":9,"verdict":"pass","feedback":"ok","evidenceRefs":["patch:abc123","check:test","check:build"]}'],
    ['escaped-equivalent duplicate', String.raw`{"score":8,"\u0073core":9,"verdict":"pass","feedback":"ok","evidenceRefs":["patch:abc123","check:test","check:build"]}`],
  ])('rejects duplicate JSON keys: %s', (_name, output) => {
    expect(() => parseReview(output, 8, evidence)).toThrow(/duplicate.*score/i);
  });

  it.each([
    ['missing captured ID', ['patch:abc123', 'check:test']],
    ['unknown ID', ['patch:abc123', 'check:test', 'check:build', 'check:other']],
    ['duplicate reference', ['patch:abc123', 'check:test', 'check:build', 'check:test']],
  ])('rejects incomplete or ambiguous evidence references: %s', (_name, evidenceRefs) => {
    expect(() => parseReview(review({ evidenceRefs }), 8, evidence)).toThrow(/evidence/i);
  });

  it.each([
    ['duplicate captured IDs', {
      ...evidence,
      checks: [evidence.checks[0], { ...evidence.checks[1], id: 'check:test' }],
    }],
    ['blank captured ID', {
      ...evidence,
      checks: [{ ...evidence.checks[0], id: '' }, evidence.checks[1]],
    }],
  ])('rejects ambiguous captured evidence: %s', (_name, captured) => {
    expect(() => parseReview(review(), 8, captured)).toThrow(/evidence/i);
  });

  it.each([
    ['pass below threshold', 7, 'pass'],
    ['fail at threshold', 8, 'fail'],
    ['needs revision above threshold', 9, 'needs_revision'],
  ])('rejects score/verdict contradictions: %s', (_name, score, verdict) => {
    expect(() => parseReview(review({ score, verdict }), 8, evidence)).toThrow(/score.*verdict|verdict.*score/i);
  });

  it.each([
    ['nonzero exit', { exitCode: 1 }],
    ['missing exit', { exitCode: null }],
    ['execution error', { error: 'spawn failed' }],
  ])('rejects a passing verdict when a required check failed: %s', (_name, failure) => {
    const failedEvidence: ReviewEvidence = {
      ...evidence,
      checks: [{ ...evidence.checks[0], ...failure }, evidence.checks[1]],
    };
    expect(() => parseReview(review(), 8, failedEvidence)).toThrow(/check.*pass|pass.*check/i);
  });

  it('allows successful checks to write diagnostic stderr', () => {
    const diagnosticEvidence: ReviewEvidence = {
      ...evidence,
      checks: [{ ...evidence.checks[0], stderr: 'warning' }, evidence.checks[1]],
    };
    expect(parseReview(review(), 8, diagnosticEvidence).checksPassed).toBe(true);
  });

  it('returns checksPassed false for a consistent non-passing review', () => {
    const failedEvidence: ReviewEvidence = {
      ...evidence,
      checks: [{ ...evidence.checks[0], exitCode: 1 }, evidence.checks[1]],
    };
    const result = parseReview(review({ score: 5, verdict: 'needs_revision' }), 8, failedEvidence);
    expect(result.checksPassed).toBe(false);
  });

  it('supports patch-only evidence when no checks are configured', () => {
    const patchOnly: ReviewEvidence = { patch: evidence.patch, checks: [] };
    const output = review({ evidenceRefs: ['patch:abc123'] });
    expect(parseReview(output, 8, patchOnly).checksPassed).toBe(true);
  });

  it.each([-1, 11, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid threshold: %s',
    threshold => {
      expect(() => parseReview(review(), threshold, evidence)).toThrow(/threshold/i);
    },
  );
});
