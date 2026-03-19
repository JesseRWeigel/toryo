import { describe, it, expect } from 'vitest';
import { shouldSelfImprove, buildSelfImprovePrompt } from '../self-improve.js';
import type { ResultRow } from '../types.js';

function makeResult(overrides: Partial<ResultRow> = {}): ResultRow {
  return {
    timestamp: '2026-03-19T10:00:00Z',
    cycle: 1,
    task: 'write-tests',
    agent: 'coder',
    score: 7.0,
    status: 'keep',
    description: 'QA approved',
    ...overrides,
  };
}

describe('shouldSelfImprove', () => {
  it('does not trigger with insufficient data', () => {
    const results = [makeResult(), makeResult()];
    const result = shouldSelfImprove(results, 'coder', { windowSize: 5 });
    expect(result.triggered).toBe(false);
    expect(result.reason).toContain('Not enough data');
  });

  it('does not trigger when scores are above threshold', () => {
    const results = Array.from({ length: 5 }, (_, i) =>
      makeResult({ cycle: i, score: 7.5 }),
    );
    const result = shouldSelfImprove(results, 'coder');
    expect(result.triggered).toBe(false);
  });

  it('triggers when avg score drops below threshold', () => {
    const results = Array.from({ length: 5 }, (_, i) =>
      makeResult({ cycle: i, score: 4.0 }),
    );
    const result = shouldSelfImprove(results, 'coder');
    expect(result.triggered).toBe(true);
    expect(result.reason).toContain('below threshold');
  });

  it('only considers the specified agent', () => {
    const results = [
      ...Array.from({ length: 5 }, (_, i) =>
        makeResult({ cycle: i, score: 9.0, agent: 'researcher' }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        makeResult({ cycle: i + 5, score: 3.0, agent: 'coder' }),
      ),
    ];
    const researcherResult = shouldSelfImprove(results, 'researcher');
    expect(researcherResult.triggered).toBe(false);

    const coderResult = shouldSelfImprove(results, 'coder');
    expect(coderResult.triggered).toBe(true);
  });

  it('identifies failure patterns', () => {
    const results = Array.from({ length: 5 }, (_, i) =>
      makeResult({ cycle: i, score: 3.0, status: 'discard' }),
    );
    const result = shouldSelfImprove(results, 'coder');
    expect(result.triggered).toBe(true);
    expect(result.analysis).toContain('discarded');
  });

  it('identifies crash patterns', () => {
    const results = Array.from({ length: 5 }, (_, i) =>
      makeResult({ cycle: i, score: 0, status: i < 2 ? 'crash' : 'discard' }),
    );
    const result = shouldSelfImprove(results, 'coder');
    expect(result.analysis).toContain('crashes');
  });

  it('identifies task-specific weaknesses', () => {
    const results = [
      makeResult({ cycle: 1, score: 3.0, task: 'refactor' }),
      makeResult({ cycle: 2, score: 4.0, task: 'refactor' }),
      makeResult({ cycle: 3, score: 3.5, task: 'refactor' }),
      makeResult({ cycle: 4, score: 4.0, task: 'write-tests' }),
      makeResult({ cycle: 5, score: 5.0, task: 'write-tests' }),
    ];
    const result = shouldSelfImprove(results, 'coder');
    expect(result.analysis).toContain('refactor');
  });

  it('respects custom window size', () => {
    const results = [
      ...Array.from({ length: 3 }, (_, i) =>
        makeResult({ cycle: i, score: 2.0 }),
      ),
      ...Array.from({ length: 7 }, (_, i) =>
        makeResult({ cycle: i + 3, score: 9.0 }),
      ),
    ];
    // Window of 3 sees only the last 3 high scores
    const result = shouldSelfImprove(results, 'coder', { windowSize: 3 });
    expect(result.triggered).toBe(false);
  });
});

describe('buildSelfImprovePrompt', () => {
  it('includes agent id and reason', () => {
    const prompt = buildSelfImprovePrompt(
      {
        triggered: true,
        agentId: 'coder',
        reason: 'Avg score 4.2 is below threshold 5.5',
        analysis: '3/5 tasks discarded',
      },
      ['Output was too vague', 'Missing error handling'],
    );
    expect(prompt).toContain('coder');
    expect(prompt).toContain('4.2');
    expect(prompt).toContain('3/5 tasks discarded');
    expect(prompt).toContain('Output was too vague');
    expect(prompt).toContain('Missing error handling');
  });

  it('handles empty feedback', () => {
    const prompt = buildSelfImprovePrompt(
      { triggered: true, agentId: 'coder', reason: 'low scores' },
      [],
    );
    expect(prompt).toContain('Root causes');
  });
});
