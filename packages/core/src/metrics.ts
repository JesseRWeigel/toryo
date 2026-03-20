import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ResultRow, GlobalMetrics, AgentMetrics, CycleVerdict } from './types.js';

const RESULTS_HEADER = 'timestamp\tcycle\ttask\tagent\tscore\tstatus\tdescription';
const METRICS_FILE = 'metrics.json';
const RESULTS_FILE = 'results.tsv';

export function createMetrics(outputDir: string) {
  const metricsPath = join(outputDir, METRICS_FILE);
  const resultsPath = join(outputDir, RESULTS_FILE);

  async function ensureDir(): Promise<void> {
    await mkdir(outputDir, { recursive: true });
  }

  async function loadMetrics(): Promise<GlobalMetrics> {
    try {
      const data = await readFile(metricsPath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return {
        cyclesCompleted: 0,
        totalTasks: 0,
        successRate: 0,
        agents: {},
      };
    }
  }

  async function saveMetrics(metrics: GlobalMetrics): Promise<void> {
    await ensureDir();
    await writeFile(metricsPath, JSON.stringify(metrics, null, 2));
  }

  async function appendResult(row: ResultRow): Promise<void> {
    await ensureDir();

    // Create file with header if it doesn't exist
    try {
      await readFile(resultsPath, 'utf-8');
    } catch {
      await writeFile(resultsPath, RESULTS_HEADER + '\n');
    }

    const line = [
      row.timestamp,
      row.cycle,
      row.task,
      row.agent,
      row.score.toFixed(1),
      row.status,
      // Strip tabs and newlines from description to prevent TSV corruption
      row.description.replace(/[\t\n\r]/g, ' '),
    ].join('\t');

    await appendFile(resultsPath, line + '\n');
  }

  async function loadResults(): Promise<ResultRow[]> {
    try {
      const data = await readFile(resultsPath, 'utf-8');
      const lines = data.trim().split('\n').slice(1); // skip header
      return lines
        .filter((line) => line.trim())
        .map((line) => {
          const [timestamp, cycle, task, agent, score, status, description] = line.split('\t');
          return {
            timestamp,
            cycle: Number(cycle),
            task,
            agent,
            score: Number(score),
            status: status as CycleVerdict,
            description: description ?? '',
          };
        });
    } catch {
      return [];
    }
  }

  function updateAgentMetrics(
    metrics: GlobalMetrics,
    agentId: string,
    score: number,
    passed: boolean,
    scoreWindow = 50,
  ): GlobalMetrics {
    const existing: AgentMetrics = metrics.agents[agentId] ?? {
      agentId,
      tasksCompleted: 0,
      avgScore: 0,
      scores: [],
      successRate: 0,
      successCount: 0,
    };

    const scores = [...existing.scores, score].slice(-scoreWindow);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const tasksCompleted = existing.tasksCompleted + 1;
    // Use integer count to avoid floating-point drift
    const prevCount = existing.successCount ?? Math.round(existing.successRate * existing.tasksCompleted);
    const successCount = prevCount + (passed ? 1 : 0);
    const successRate = successCount / tasksCompleted;

    const totalTasks = metrics.totalTasks + 1;
    const globalPrevCount = metrics.successCount ?? Math.round(metrics.successRate * metrics.totalTasks);
    const globalSuccessCount = globalPrevCount + (passed ? 1 : 0);

    return {
      ...metrics,
      totalTasks,
      successRate: globalSuccessCount / totalTasks,
      successCount: globalSuccessCount,
      agents: {
        ...metrics.agents,
        [agentId]: { agentId, tasksCompleted, avgScore, scores, successRate, successCount },
      },
    };
  }

  return {
    loadMetrics,
    saveMetrics,
    appendResult,
    loadResults,
    updateAgentMetrics,
  };
}
