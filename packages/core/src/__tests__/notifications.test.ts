import { describe, it, expect } from 'vitest';
import { createNotifier, shouldNotify, formatNotification } from '../notifications.js';
import type { ToryoEvent, NotificationEvent, GlobalMetrics, CycleResult, ReviewResult } from '../types.js';

// --- Helpers to build typed events ---

function reviewEvent(score: number, cycle = 1): ToryoEvent & { type: 'review:complete' } {
  return {
    type: 'review:complete',
    cycle,
    review: { score, verdict: score >= 7 ? 'pass' : 'fail', feedback: 'test' } satisfies ReviewResult,
  };
}

function cycleEvent(
  opts: { verdict?: CycleResult['verdict']; cycle?: number; task?: string; finalScore?: number } = {},
): ToryoEvent & { type: 'cycle:complete' } {
  const { verdict = 'keep', cycle = 1, task = 'test-task', finalScore = 7.0 } = opts;
  return {
    type: 'cycle:complete',
    cycle,
    result: {
      cycleNumber: cycle,
      task,
      timestamp: new Date().toISOString(),
      phases: [],
      finalScore,
      verdict,
      retryCount: 0,
    },
  };
}

// ============================================================
// createNotifier
// ============================================================

describe('createNotifier', () => {
  it('returns null for "none" provider', () => {
    const notifier = createNotifier({ provider: 'none', target: '', events: [] });
    expect(notifier).toBeNull();
  });

  it('returns null for undefined config', () => {
    const notifier = createNotifier(undefined);
    expect(notifier).toBeNull();
  });

  it.each(['ntfy', 'webhook', 'slack', 'discord'] as const)(
    'returns a provider with a send method for "%s"',
    (provider) => {
      const notifier = createNotifier({ provider, target: 'https://example.com/hook', events: [] });
      expect(notifier).not.toBeNull();
      expect(notifier).toHaveProperty('send');
      expect(typeof notifier!.send).toBe('function');
    },
  );
});

// ============================================================
// shouldNotify
// ============================================================

describe('shouldNotify', () => {
  it('returns true for breakthrough when score >= 9.0 and events includes "breakthrough"', () => {
    const event = reviewEvent(9.0);
    expect(shouldNotify(event, ['breakthrough'])).toBe(true);
  });

  it('returns true for failure when score < 6.0 and events includes "failure"', () => {
    const event = reviewEvent(5.5);
    expect(shouldNotify(event, ['failure'])).toBe(true);
  });

  it('returns true for crash when verdict is "crash" and events includes "crash"', () => {
    const event = cycleEvent({ verdict: 'crash' });
    expect(shouldNotify(event, ['crash'])).toBe(true);
  });

  it('returns true for status on every 5th cycle', () => {
    const event = cycleEvent({ cycle: 10 });
    expect(shouldNotify(event, ['status'])).toBe(true);

    const event15 = cycleEvent({ cycle: 15 });
    expect(shouldNotify(event15, ['status'])).toBe(true);
  });

  it('returns false when event type does not match configured events', () => {
    // High score but only listening for 'failure'
    const highScore = reviewEvent(9.5);
    expect(shouldNotify(highScore, ['failure'])).toBe(false);

    // Low score but only listening for 'breakthrough'
    const lowScore = reviewEvent(4.0);
    expect(shouldNotify(lowScore, ['breakthrough'])).toBe(false);

    // Non-crash cycle but only listening for 'crash'
    const normalCycle = cycleEvent({ verdict: 'keep', cycle: 3 });
    expect(shouldNotify(normalCycle, ['crash'])).toBe(false);

    // Non-5th cycle with only 'status'
    const cycle3 = cycleEvent({ cycle: 3 });
    expect(shouldNotify(cycle3, ['status'])).toBe(false);
  });
});

// ============================================================
// formatNotification
// ============================================================

describe('formatNotification', () => {
  it('formats breakthrough with high priority', () => {
    const event = reviewEvent(9.5, 42);
    const result = formatNotification(event);

    expect(result.priority).toBe('high');
    expect(result.title).toContain('Breakthrough');
    expect(result.title).toContain('9.5');
    expect(result.body).toContain('42');
  });

  it('formats failure with default priority', () => {
    const event = reviewEvent(4.0, 7);
    const result = formatNotification(event);

    expect(result.priority).toBe('default');
    expect(result.title).toContain('Low score');
    expect(result.title).toContain('4');
    expect(result.body).toContain('7');
  });

  it('formats crash with high priority', () => {
    const event = cycleEvent({ verdict: 'crash', cycle: 5, task: 'deploy' });
    const result = formatNotification(event);

    expect(result.priority).toBe('high');
    expect(result.title).toContain('failure');
    expect(result.body).toContain('deploy');
    expect(result.body).toContain('crashed');
  });

  it('includes metrics info in cycle complete notification', () => {
    const event = cycleEvent({ verdict: 'keep', cycle: 10, task: 'code-review', finalScore: 8.0 });
    const metrics: GlobalMetrics = {
      cyclesCompleted: 10,
      totalTasks: 10,
      successRate: 0.8,
      agents: {},
    };
    const result = formatNotification(event, metrics);

    expect(result.body).toContain('10 cycles');
    expect(result.body).toContain('80%');
    expect(result.body).toContain('code-review');
    expect(result.body).toContain('8');
  });
});
