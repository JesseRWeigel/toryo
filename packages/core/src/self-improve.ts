import type {
  AgentAdapter,
  AgentState,
  AgentProfile,
  ToryoConfig,
  ResultRow,
  ToryoEvent,
} from './types.js';

interface SelfImproveOptions {
  /** Number of recent results to analyze */
  windowSize: number;
  /** Trigger if avg score in window drops below this */
  triggerThreshold: number;
  /** Require human approval before deploying improvements */
  requireApproval: boolean;
}

const DEFAULT_OPTIONS: SelfImproveOptions = {
  windowSize: 5,
  triggerThreshold: 5.5,
  requireApproval: true,
};

export interface SelfImproveResult {
  triggered: boolean;
  agentId: string;
  reason: string;
  analysis?: string;
  suggestions?: string[];
}

/**
 * Analyzes recent results and determines if self-improvement should trigger.
 */
export function shouldSelfImprove(
  results: ResultRow[],
  agentId: string,
  options: Partial<SelfImproveOptions> = {},
): SelfImproveResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Filter to this agent's recent results
  const agentResults = results
    .filter((r) => r.agent === agentId)
    .slice(-opts.windowSize);

  if (agentResults.length < opts.windowSize) {
    return { triggered: false, agentId, reason: 'Not enough data yet' };
  }

  const avgScore =
    agentResults.reduce((sum, r) => sum + r.score, 0) / agentResults.length;

  if (avgScore >= opts.triggerThreshold) {
    return {
      triggered: false,
      agentId,
      reason: `Avg score ${avgScore.toFixed(1)} is above threshold ${opts.triggerThreshold}`,
    };
  }

  // Analyze failure patterns
  const failures = agentResults.filter((r) => r.status === 'discard');
  const crashes = agentResults.filter((r) => r.status === 'crash');

  const patterns: string[] = [];
  if (failures.length > agentResults.length / 2) {
    patterns.push(`${failures.length}/${agentResults.length} recent tasks were discarded`);
  }
  if (crashes.length > 0) {
    patterns.push(`${crashes.length} infrastructure crashes detected`);
  }

  // Group by task to find task-specific weaknesses
  const taskScores: Record<string, number[]> = {};
  for (const r of agentResults) {
    if (!taskScores[r.task]) taskScores[r.task] = [];
    taskScores[r.task].push(r.score);
  }
  for (const [task, scores] of Object.entries(taskScores)) {
    const taskAvg = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (taskAvg < opts.triggerThreshold) {
      patterns.push(`Consistently low on "${task}" (avg ${taskAvg.toFixed(1)})`);
    }
  }

  return {
    triggered: true,
    agentId,
    reason: `Avg score ${avgScore.toFixed(1)} is below threshold ${opts.triggerThreshold}`,
    analysis: patterns.join('; '),
    suggestions: [
      'Analyze QA feedback for recurring issues',
      'Review task specs for clarity — vague specs produce vague output',
      'Consider switching to a more capable model for this agent',
      'Check if the agent timeout is sufficient for the task complexity',
    ],
  };
}

/**
 * Build a self-improvement prompt that asks an agent to analyze failures
 * and suggest improvements.
 */
export function buildSelfImprovePrompt(
  result: SelfImproveResult,
  recentFeedback: string[],
): string {
  return [
    '## Self-Improvement Analysis',
    '',
    `Agent "${result.agentId}" has been underperforming.`,
    `Reason: ${result.reason}`,
    result.analysis ? `Patterns: ${result.analysis}` : '',
    '',
    '## Recent QA Feedback',
    ...recentFeedback.map((f, i) => `### Feedback ${i + 1}\n${f}\n`),
    '',
    '## Your Task',
    'Analyze the feedback above and provide:',
    '1. Root causes of the poor performance (be specific)',
    '2. Concrete changes to improve output quality',
    '3. A revised approach or checklist the agent should follow',
    '',
    'Focus on actionable improvements, not general advice.',
  ]
    .filter(Boolean)
    .join('\n');
}
