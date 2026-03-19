import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMetrics } from '../metrics.js';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GlobalMetrics, ResultRow } from '../types.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'toryo-metrics-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function makeRow(overrides: Partial<ResultRow> = {}): ResultRow {
  return {
    timestamp: '2026-03-19T10:00:00Z',
    cycle: 1,
    task: 'test-task',
    agent: 'agent-1',
    score: 7.5,
    status: 'keep',
    description: 'Test result',
    ...overrides,
  };
}

describe('createMetrics', () => {
  describe('loadMetrics', () => {
    it('returns empty metrics when file does not exist', async () => {
      const m = createMetrics(tempDir);
      const metrics = await m.loadMetrics();
      expect(metrics).toEqual({
        cyclesCompleted: 0,
        totalTasks: 0,
        successRate: 0,
        agents: {},
      });
    });

    it('loads saved metrics', async () => {
      const m = createMetrics(tempDir);
      const data: GlobalMetrics = {
        cyclesCompleted: 5,
        totalTasks: 10,
        successRate: 0.8,
        agents: {},
      };
      await m.saveMetrics(data);
      const loaded = await m.loadMetrics();
      expect(loaded).toEqual(data);
    });
  });

  describe('saveMetrics', () => {
    it('creates output directory if it does not exist', async () => {
      const nestedDir = join(tempDir, 'deep', 'nested');
      const m = createMetrics(nestedDir);
      await m.saveMetrics({
        cyclesCompleted: 0,
        totalTasks: 0,
        successRate: 0,
        agents: {},
      });
      const content = await readFile(join(nestedDir, 'metrics.json'), 'utf-8');
      expect(JSON.parse(content)).toHaveProperty('cyclesCompleted', 0);
    });

    it('overwrites existing metrics', async () => {
      const m = createMetrics(tempDir);
      await m.saveMetrics({ cyclesCompleted: 1, totalTasks: 1, successRate: 1, agents: {} });
      await m.saveMetrics({ cyclesCompleted: 2, totalTasks: 3, successRate: 0.67, agents: {} });
      const loaded = await m.loadMetrics();
      expect(loaded.cyclesCompleted).toBe(2);
      expect(loaded.totalTasks).toBe(3);
    });
  });

  describe('appendResult', () => {
    it('creates results.tsv with header on first append', async () => {
      const m = createMetrics(tempDir);
      await m.appendResult(makeRow());
      const content = await readFile(join(tempDir, 'results.tsv'), 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines[0]).toContain('timestamp');
      expect(lines[0]).toContain('cycle');
      expect(lines[0]).toContain('score');
      expect(lines.length).toBe(2);
    });

    it('appends multiple results', async () => {
      const m = createMetrics(tempDir);
      await m.appendResult(makeRow({ cycle: 1 }));
      await m.appendResult(makeRow({ cycle: 2 }));
      await m.appendResult(makeRow({ cycle: 3 }));
      const content = await readFile(join(tempDir, 'results.tsv'), 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(4); // header + 3 rows
    });

    it('formats score with one decimal place', async () => {
      const m = createMetrics(tempDir);
      await m.appendResult(makeRow({ score: 8.123 }));
      const content = await readFile(join(tempDir, 'results.tsv'), 'utf-8');
      expect(content).toContain('8.1');
    });

    it('uses tab separators', async () => {
      const m = createMetrics(tempDir);
      await m.appendResult(makeRow());
      const content = await readFile(join(tempDir, 'results.tsv'), 'utf-8');
      const dataLine = content.trim().split('\n')[1];
      expect(dataLine.split('\t').length).toBe(7);
    });
  });

  describe('loadResults', () => {
    it('returns empty array when file does not exist', async () => {
      const m = createMetrics(tempDir);
      const results = await m.loadResults();
      expect(results).toEqual([]);
    });

    it('parses saved results correctly', async () => {
      const m = createMetrics(tempDir);
      await m.appendResult(makeRow({ score: 7.5, cycle: 3, agent: 'senku' }));
      const results = await m.loadResults();
      expect(results.length).toBe(1);
      expect(results[0].score).toBe(7.5);
      expect(results[0].cycle).toBe(3);
      expect(results[0].agent).toBe('senku');
      expect(results[0].status).toBe('keep');
    });

    it('parses multiple results', async () => {
      const m = createMetrics(tempDir);
      await m.appendResult(makeRow({ cycle: 1, score: 6.0 }));
      await m.appendResult(makeRow({ cycle: 2, score: 8.0 }));
      const results = await m.loadResults();
      expect(results.length).toBe(2);
      expect(results[0].score).toBe(6.0);
      expect(results[1].score).toBe(8.0);
    });
  });

  describe('updateAgentMetrics', () => {
    it('initializes new agent metrics', () => {
      const m = createMetrics(tempDir);
      const initial: GlobalMetrics = {
        cyclesCompleted: 0,
        totalTasks: 0,
        successRate: 0,
        agents: {},
      };
      const updated = m.updateAgentMetrics(initial, 'agent-1', 7.0, true);
      expect(updated.agents['agent-1']).toBeDefined();
      expect(updated.agents['agent-1'].tasksCompleted).toBe(1);
      expect(updated.agents['agent-1'].avgScore).toBe(7.0);
      expect(updated.agents['agent-1'].successRate).toBe(1.0);
    });

    it('updates existing agent metrics', () => {
      const m = createMetrics(tempDir);
      let metrics: GlobalMetrics = {
        cyclesCompleted: 0,
        totalTasks: 0,
        successRate: 0,
        agents: {},
      };
      metrics = m.updateAgentMetrics(metrics, 'a1', 6.0, true);
      metrics = m.updateAgentMetrics(metrics, 'a1', 8.0, true);
      expect(metrics.agents['a1'].tasksCompleted).toBe(2);
      expect(metrics.agents['a1'].avgScore).toBe(7.0);
      expect(metrics.agents['a1'].successRate).toBe(1.0);
    });

    it('tracks failure rate', () => {
      const m = createMetrics(tempDir);
      let metrics: GlobalMetrics = {
        cyclesCompleted: 0,
        totalTasks: 0,
        successRate: 0,
        agents: {},
      };
      metrics = m.updateAgentMetrics(metrics, 'a1', 8.0, true);
      metrics = m.updateAgentMetrics(metrics, 'a1', 3.0, false);
      expect(metrics.agents['a1'].successRate).toBe(0.5);
      expect(metrics.totalTasks).toBe(2);
      expect(metrics.successRate).toBe(0.5);
    });

    it('updates global success rate across multiple agents', () => {
      const m = createMetrics(tempDir);
      let metrics: GlobalMetrics = {
        cyclesCompleted: 0,
        totalTasks: 0,
        successRate: 0,
        agents: {},
      };
      metrics = m.updateAgentMetrics(metrics, 'a1', 8.0, true);
      metrics = m.updateAgentMetrics(metrics, 'a2', 4.0, false);
      metrics = m.updateAgentMetrics(metrics, 'a1', 7.0, true);
      expect(metrics.totalTasks).toBe(3);
      // 2 successes out of 3
      expect(metrics.successRate).toBeCloseTo(2 / 3);
    });

    it('respects scoreWindow limit', () => {
      const m = createMetrics(tempDir);
      let metrics: GlobalMetrics = {
        cyclesCompleted: 0,
        totalTasks: 0,
        successRate: 0,
        agents: {},
      };
      for (let i = 0; i < 5; i++) {
        metrics = m.updateAgentMetrics(metrics, 'a1', i + 1, true, 3);
      }
      // Only last 3 scores kept: [3, 4, 5]
      expect(metrics.agents['a1'].scores).toEqual([3, 4, 5]);
      expect(metrics.agents['a1'].avgScore).toBe(4);
    });

    it('handles zero initial state gracefully', () => {
      const m = createMetrics(tempDir);
      const metrics: GlobalMetrics = {
        cyclesCompleted: 0,
        totalTasks: 0,
        successRate: 0,
        agents: {},
      };
      const updated = m.updateAgentMetrics(metrics, 'new-agent', 5.0, false);
      expect(updated.agents['new-agent'].successRate).toBe(0);
      expect(updated.successRate).toBe(0);
      expect(updated.totalTasks).toBe(1);
    });
  });
});
