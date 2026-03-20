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
});
