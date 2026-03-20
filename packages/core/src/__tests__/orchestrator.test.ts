import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createOrchestrator } from '../orchestrator.js';
import type { ToryoConfig, AgentAdapter, AdapterSendOptions, AdapterResponse, TaskSpec, ToryoEvent } from '../types.js';

const TEST_DIR = join(import.meta.dirname ?? __dirname, '../../.test-orchestrator');
const OUTPUT_DIR = join(TEST_DIR, '.toryo');

/** Mock adapter that returns configurable responses */
function createMockAdapter(responses: Record<string, string> = {}): AgentAdapter {
  let callCount = 0;
  return {
    name: 'mock',
    async send(options: AdapterSendOptions): Promise<AdapterResponse> {
      callCount++;
      const key = `call-${callCount}`;
      const output = responses[key] ?? responses['default'] ?? 'Mock output';
      return { output, durationMs: 10, infraFailure: false };
    },
    async isAvailable() { return true; },
  };
}

/** Mock adapter that returns a proper review score */
function createScoringAdapter(score: number): AgentAdapter {
  return {
    name: 'mock-scorer',
    async send(): Promise<AdapterResponse> {
      return {
        output: `Score: ${score}/10\n${score >= 6 ? 'PASS' : 'FAIL'}\nFeedback: Test feedback.`,
        durationMs: 10,
        infraFailure: false,
      };
    },
    async isAvailable() { return true; },
  };
}

function makeConfig(overrides: Partial<ToryoConfig> = {}): ToryoConfig {
  return {
    agents: {
      worker: { adapter: 'mock', strengths: ['code', 'plan', 'research'], timeout: 30 },
      reviewer: { adapter: 'mock-scorer', strengths: ['review', 'scoring', 'quality'], timeout: 30 },
    },
    tasks: [],
    ratchet: { threshold: 6.0, maxRetries: 0, gitStrategy: 'none' },
    delegation: {
      initialTrust: 0.5,
      scoreWindow: 50,
      levels: {
        supervised: { trustRange: [0, 0.6] },
        guided: { trustRange: [0.6, 0.8] },
        autonomous: { trustRange: [0.8, 1.0] },
      },
    },
    outputDir: OUTPUT_DIR,
    ...overrides,
  };
}

const TASK: TaskSpec = {
  id: 'test-task',
  name: 'Test Task',
  description: 'A test task for the orchestrator.',
  acceptanceCriteria: ['Must produce output'],
  phases: [
    { phase: 'plan', agent: 'worker' },
    { phase: 'execute', agent: 'worker' },
    { phase: 'review', agent: 'reviewer' },
  ],
};

beforeEach(async () => {
  await mkdir(OUTPUT_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe('createOrchestrator', () => {
  it('runs a single cycle with keep verdict', async () => {
    const config = makeConfig();
    const orchestrator = await createOrchestrator({
      config,
      adapters: { mock: createMockAdapter(), 'mock-scorer': createScoringAdapter(8) },
      cwd: TEST_DIR,
    });

    const results = await orchestrator.run([TASK], 1, 1);
    expect(results).toHaveLength(1);
    expect(results[0].verdict).toBe('keep');
    expect(results[0].finalScore).toBe(8);
    expect(results[0].task).toBe('test-task');
  });

  it('discards when score below threshold', async () => {
    const config = makeConfig();
    const orchestrator = await createOrchestrator({
      config,
      adapters: { mock: createMockAdapter(), 'mock-scorer': createScoringAdapter(3) },
      cwd: TEST_DIR,
    });

    const results = await orchestrator.run([TASK], 1, 1);
    expect(results[0].verdict).toBe('discard');
    expect(results[0].finalScore).toBe(3);
  });

  it('emits events in correct order', async () => {
    const config = makeConfig();
    const events: ToryoEvent[] = [];

    const orchestrator = await createOrchestrator({
      config,
      adapters: { mock: createMockAdapter(), 'mock-scorer': createScoringAdapter(7) },
      cwd: TEST_DIR,
      onEvent: (e) => events.push(e),
    });

    await orchestrator.run([TASK], 1, 1);

    const types = events.map((e) => e.type);
    expect(types[0]).toBe('cycle:start');
    expect(types).toContain('phase:start');
    expect(types).toContain('phase:complete');
    expect(types).toContain('review:complete');
    expect(types[types.length - 1]).toBe('cycle:complete');
  });

  it('updates metrics after cycle', async () => {
    const config = makeConfig();
    const orchestrator = await createOrchestrator({
      config,
      adapters: { mock: createMockAdapter(), 'mock-scorer': createScoringAdapter(8) },
      cwd: TEST_DIR,
    });

    await orchestrator.run([TASK], 1, 1);
    const metrics = orchestrator.getMetrics();
    expect(metrics.cyclesCompleted).toBe(1);
    expect(metrics.totalTasks).toBe(1);
    expect(metrics.successRate).toBe(1);
  });

  it('rotates through multiple tasks', async () => {
    const task2: TaskSpec = { ...TASK, id: 'task-2', name: 'Task 2' };
    const config = makeConfig();

    const orchestrator = await createOrchestrator({
      config,
      adapters: { mock: createMockAdapter(), 'mock-scorer': createScoringAdapter(7) },
      cwd: TEST_DIR,
    });

    const results = await orchestrator.run([TASK, task2], 1, 4);
    expect(results).toHaveLength(4);
    expect(results[0].task).toBe('test-task');
    expect(results[1].task).toBe('task-2');
    expect(results[2].task).toBe('test-task');
    expect(results[3].task).toBe('task-2');
  });

  it('handles infrastructure failure gracefully', async () => {
    const failAdapter: AgentAdapter = {
      name: 'fail',
      async send(): Promise<AdapterResponse> {
        return { output: '', durationMs: 0, infraFailure: true, error: 'ECONNREFUSED' };
      },
      async isAvailable() { return true; },
    };

    const config = makeConfig({
      agents: {
        worker: { adapter: 'fail', strengths: ['code', 'plan', 'research'], timeout: 30 },
        reviewer: { adapter: 'mock-scorer', strengths: ['review', 'scoring'], timeout: 30 },
      },
    });

    const orchestrator = await createOrchestrator({
      config,
      adapters: { fail: failAdapter, 'mock-scorer': createScoringAdapter(8) },
      cwd: TEST_DIR,
    });

    // Should not throw — infra failures are caught and logged as crash
    const results = await orchestrator.run([TASK], 1, 1);
    expect(results).toHaveLength(0); // crash is caught, not added to results
  });

  it('returns agent states with trust scores', async () => {
    const config = makeConfig();
    const orchestrator = await createOrchestrator({
      config,
      adapters: { mock: createMockAdapter(), 'mock-scorer': createScoringAdapter(9) },
      cwd: TEST_DIR,
    });

    await orchestrator.run([TASK], 1, 1);
    const states = orchestrator.getAgentStates();
    expect(states.worker).toBeDefined();
    expect(states.reviewer).toBeDefined();
  });

  it('retries via Ralph Loop when score below threshold', async () => {
    let reviewCount = 0;
    const retryScorer: AgentAdapter = {
      name: 'retry-scorer',
      async send(): Promise<AdapterResponse> {
        reviewCount++;
        // First review: fail. Second review (after retry): pass.
        const score = reviewCount === 1 ? 3 : 8;
        return {
          output: `Score: ${score}/10\n${score >= 6 ? 'PASS' : 'FAIL'}\nFeedback: ${score < 6 ? 'Needs more detail' : 'Good work'}`,
          durationMs: 10,
          infraFailure: false,
        };
      },
      async isAvailable() { return true; },
    };

    const config = makeConfig({
      ratchet: { threshold: 6, maxRetries: 1, gitStrategy: 'none' },
      agents: {
        worker: { adapter: 'mock', strengths: ['code', 'plan', 'research'], timeout: 30 },
        reviewer: { adapter: 'retry-scorer', strengths: ['review', 'scoring', 'quality'], timeout: 30 },
      },
    });
    const events: ToryoEvent[] = [];

    const orchestrator = await createOrchestrator({
      config,
      adapters: { mock: createMockAdapter(), 'retry-scorer': retryScorer },
      cwd: TEST_DIR,
      onEvent: (e) => events.push(e),
    });

    const results = await orchestrator.run([TASK], 1, 1);
    expect(results[0].verdict).toBe('keep');
    expect(results[0].finalScore).toBe(8);
    expect(results[0].retryCount).toBe(1);

    // Should have emitted ralph:retry event
    const retryEvents = events.filter((e) => e.type === 'ralph:retry');
    expect(retryEvents).toHaveLength(1);
  });

  it('discards after max retries exhausted', async () => {
    const alwaysFailScorer: AgentAdapter = {
      name: 'fail-scorer',
      async send(): Promise<AdapterResponse> {
        return { output: 'Score: 2/10\nFAIL\nTerrible output', durationMs: 10, infraFailure: false };
      },
      async isAvailable() { return true; },
    };

    const config = makeConfig({
      ratchet: { threshold: 6, maxRetries: 1, gitStrategy: 'none' },
      agents: {
        worker: { adapter: 'mock', strengths: ['code', 'plan', 'research'], timeout: 30 },
        reviewer: { adapter: 'fail-scorer', strengths: ['review', 'scoring', 'quality'], timeout: 30 },
      },
    });

    const orchestrator = await createOrchestrator({
      config,
      adapters: { mock: createMockAdapter(), 'fail-scorer': alwaysFailScorer },
      cwd: TEST_DIR,
    });

    const results = await orchestrator.run([TASK], 1, 1);
    expect(results[0].verdict).toBe('discard');
    expect(results[0].retryCount).toBe(1);
  });

  it('saves results to results.tsv', async () => {
    const { readFile } = await import('node:fs/promises');
    const config = makeConfig();

    const orchestrator = await createOrchestrator({
      config,
      adapters: { mock: createMockAdapter(), 'mock-scorer': createScoringAdapter(7) },
      cwd: TEST_DIR,
    });

    await orchestrator.run([TASK], 1, 1);

    const tsv = await readFile(join(OUTPUT_DIR, 'results.tsv'), 'utf-8');
    const lines = tsv.trim().split('\n');
    expect(lines[0]).toContain('timestamp\tcycle\ttask');
    expect(lines.length).toBe(2); // header + 1 result
    expect(lines[1]).toContain('test-task');
    expect(lines[1]).toContain('keep');
  });

  it('writes knowledge entries after cycles', async () => {
    const { readFile } = await import('node:fs/promises');
    const config = makeConfig();

    const orchestrator = await createOrchestrator({
      config,
      adapters: { mock: createMockAdapter(), 'mock-scorer': createScoringAdapter(7) },
      cwd: TEST_DIR,
    });

    await orchestrator.run([TASK], 1, 2);

    const knowledge = JSON.parse(await readFile(join(OUTPUT_DIR, 'knowledge.json'), 'utf-8'));
    expect(knowledge.entries.length).toBe(2);
    expect(knowledge.entries[0].key).toContain('cycle-1');
    expect(knowledge.entries[1].key).toContain('cycle-2');
  });

  it('tracks success rate across multiple cycles', async () => {
    let callNum = 0;
    const mixedScorer: AgentAdapter = {
      name: 'mixed-scorer',
      async send(): Promise<AdapterResponse> {
        callNum++;
        // Alternate: pass, fail, pass
        const score = callNum % 2 === 1 ? 8 : 3;
        return { output: `Score: ${score}/10\n${score >= 6 ? 'PASS' : 'FAIL'}`, durationMs: 10, infraFailure: false };
      },
      async isAvailable() { return true; },
    };

    const config = makeConfig({
      ratchet: { threshold: 6, maxRetries: 0, gitStrategy: 'none' },
      agents: {
        worker: { adapter: 'mock', strengths: ['code', 'plan', 'research'], timeout: 30 },
        reviewer: { adapter: 'mixed-scorer', strengths: ['review', 'scoring', 'quality'], timeout: 30 },
      },
    });

    const orchestrator = await createOrchestrator({
      config,
      adapters: { mock: createMockAdapter(), 'mixed-scorer': mixedScorer },
      cwd: TEST_DIR,
    });

    await orchestrator.run([TASK], 1, 3);
    const metrics = orchestrator.getMetrics();
    expect(metrics.totalTasks).toBe(3);
    // 2 keeps, 1 discard = 66.7%
    expect(metrics.successRate).toBeCloseTo(0.667, 1);
  });

  describe('score parsing via review output formats', () => {
    function makeScoreTest(reviewOutput: string, expectedScore: number) {
      return async () => {
        const scorer: AgentAdapter = {
          name: 'format-scorer',
          async send(): Promise<AdapterResponse> {
            return { output: reviewOutput, durationMs: 10, infraFailure: false };
          },
          async isAvailable() { return true; },
        };
        const cfg = makeConfig({
          agents: {
            worker: { adapter: 'mock', strengths: ['code', 'plan', 'research'], timeout: 30 },
            reviewer: { adapter: 'format-scorer', strengths: ['review', 'scoring'], timeout: 30 },
          },
          ratchet: { threshold: 1, maxRetries: 0, gitStrategy: 'none' },
        });
        const orch = await createOrchestrator({
          config: cfg,
          adapters: { mock: createMockAdapter(), 'format-scorer': scorer },
          cwd: TEST_DIR,
        });
        const results = await orch.run([TASK], 1, 1);
        expect(results[0].finalScore).toBe(expectedScore);
      };
    }

    it('parses X/10 format', makeScoreTest('Score: 7/10\nPASS', 7));
    it('parses X out of 10 format', makeScoreTest('I rate this 8 out of 10. Good job.', 8));
    it('parses markdown bold Score: **X**', makeScoreTest('Score: **9**\nExcellent work.', 9));
    it('parses Rating: X', makeScoreTest('Rating: 6.5\nDecent attempt.', 6.5));
    it('returns 0 when no score found', makeScoreTest('This output is okay I guess.', 0));
    it('parses decimal scores', makeScoreTest('Score: 7.5/10', 7.5));
  });
});
