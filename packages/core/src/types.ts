import { z } from 'zod';

// --- Agent Types ---

export type AutonomyLevel = 'supervised' | 'guided' | 'autonomous';

export interface AgentProfile {
  /** Unique identifier for this agent */
  id: string;
  /** Which adapter to use (claude-code, aider, gemini-cli, ollama, codex, custom) */
  adapter: string;
  /** Model name passed to the adapter */
  model?: string;
  /** What this agent is good at */
  strengths: string[];
  /** What this agent struggles with */
  weaknesses?: string[];
  /** Max seconds before timeout */
  timeout: number;
  /** Available tools/capabilities */
  tools?: string[];
}

export interface AgentState {
  id: string;
  trustScore: number;
  autonomyLevel: AutonomyLevel;
  tasksCompleted: number;
  avgScore: number;
  /** Rolling window of recent scores */
  scores: number[];
}

// --- Task / Spec Types ---

export interface TaskSpec {
  /** Unique slug for this task */
  id: string;
  /** Human-readable name */
  name: string;
  /** Full description of what to accomplish */
  description: string;
  /** What "done" looks like */
  acceptanceCriteria: string[];
  /** Which agent role should handle each phase */
  phases: PhaseAssignment[];
  /** 0-1 difficulty estimate */
  difficulty?: number;
  /** Tags for filtering/grouping */
  tags?: string[];
}

export interface PhaseAssignment {
  phase: PhaseName;
  /** Agent ID, or 'auto' to let delegation decide */
  agent: string;
  /** Phase-specific prompt template (uses {{variables}}) */
  prompt?: string;
  /** Run multiple agents in parallel for this phase */
  parallel?: {
    agents: string[];
    /** How to combine outputs: 'concatenate' or 'best' (highest-scoring) */
    merge: 'concatenate' | 'best';
  };
}

export const BUILT_IN_PHASES = ['plan', 'research', 'execute', 'review'] as const;
export type BuiltInPhase = typeof BUILT_IN_PHASES[number];
export type PhaseName = string;

// --- Cycle Types ---

export interface CycleResult {
  cycleNumber: number;
  task: string;
  timestamp: string;
  phases: PhaseResult[];
  finalScore: number;
  verdict: CycleVerdict;
  retryCount: number;
}

export type CycleVerdict = 'keep' | 'discard' | 'crash' | 'skip';

export interface PhaseResult {
  phase: PhaseName;
  agentId: string;
  output: string;
  durationMs: number;
  /** Extracted artifacts (code blocks, skills, etc.) */
  extractions: Extraction[];
}

export interface Extraction {
  type: 'code' | 'skill' | 'artifact';
  language?: string;
  path: string;
  content: string;
  lines: number;
}

// --- Ratchet / Quality Types ---

export interface RatchetConfig {
  /** Minimum QA score to keep (default: 6.0) */
  threshold: number;
  /** Max Ralph Loop retries (default: 1) */
  maxRetries: number;
  /** How to handle git on pass/fail */
  gitStrategy: 'commit-revert' | 'branch-per-task' | 'none';
}

export interface ReviewResult {
  score: number;
  verdict: 'pass' | 'needs_revision' | 'fail';
  feedback: string;
  /** Specific issues found */
  issues?: string[];
}

// --- Delegation Types ---

export interface DelegationConfig {
  initialTrust: number;
  /** How many scores to keep in rolling window */
  scoreWindow: number;
  levels: {
    supervised: { trustRange: [number, number]; minTasks?: number };
    guided: { trustRange: [number, number]; minTasks?: number };
    autonomous: { trustRange: [number, number]; minTasks?: number };
  };
}

export interface TaskProfile {
  complexity: number;
  researchNeeded: number;
  codeNeeded: number;
  reviewNeeded: number;
  creativity: number;
  risk: number;
  verifiability: number;
}

// --- Metrics Types ---

export interface ResultRow {
  timestamp: string;
  cycle: number;
  task: string;
  agent: string;
  score: number;
  status: CycleVerdict;
  description: string;
}

export interface AgentMetrics {
  agentId: string;
  tasksCompleted: number;
  avgScore: number;
  scores: number[];
  successRate: number;
}

export interface GlobalMetrics {
  cyclesCompleted: number;
  totalTasks: number;
  successRate: number;
  agents: Record<string, AgentMetrics>;
}

// --- Notification Types ---

export interface NotificationConfig {
  provider: 'ntfy' | 'slack' | 'discord' | 'webhook' | 'none';
  /** Provider-specific target (topic, channel, URL) */
  target: string;
  events: NotificationEvent[];
}

export type NotificationEvent =
  | 'breakthrough'   // score >= 9.0
  | 'failure'        // score < threshold
  | 'crash'          // infrastructure error
  | 'status'         // periodic summary
  | 'cycle_complete'; // every cycle

// --- Config Types ---

export interface ToryoConfig {
  /** Project name */
  name?: string;
  /** Agent definitions */
  agents: Record<string, AgentProfile>;
  /** Path to specs directory, or inline task list */
  tasks: string | TaskSpec[];
  /** Task rotation order (agent IDs or 'all') */
  rotation?: string[];
  /** Quality gate settings */
  ratchet: RatchetConfig;
  /** Trust-based delegation settings */
  delegation: DelegationConfig;
  /** Where to store results/metrics/artifacts */
  outputDir: string;
  /** Notification settings */
  notifications?: NotificationConfig;
  /** Phases to run per cycle (default: all 4) */
  phases?: PhaseName[];
}

// --- Adapter Interface ---

export interface AdapterSendOptions {
  agentId: string;
  prompt: string;
  timeout: number;
  model?: string;
  /** Autonomy instructions prepended to prompt */
  autonomyPrefix?: string;
  /** Working directory for the agent */
  cwd?: string;
}

export interface AdapterResponse {
  output: string;
  durationMs: number;
  /** Whether this was an infrastructure failure (timeout, crash, etc.) */
  infraFailure: boolean;
  error?: string;
}

export interface AgentAdapter {
  name: string;
  send(options: AdapterSendOptions): Promise<AdapterResponse>;
  /** Check if the adapter's CLI tool is installed */
  isAvailable(): Promise<boolean>;
}

// --- Event Types (for dashboard/plugins) ---

export type ToryoEvent =
  | { type: 'cycle:start'; cycle: number; task: string }
  | { type: 'phase:start'; cycle: number; phase: PhaseName; agent: string }
  | { type: 'phase:complete'; cycle: number; phase: PhaseName; result: PhaseResult }
  | { type: 'review:complete'; cycle: number; review: ReviewResult }
  | { type: 'ratchet:keep'; cycle: number; score: number }
  | { type: 'ratchet:revert'; cycle: number; score: number }
  | { type: 'ralph:retry'; cycle: number; attempt: number; feedback: string }
  | { type: 'cycle:complete'; cycle: number; result: CycleResult }
  | { type: 'metrics:update'; metrics: GlobalMetrics }
  | { type: 'extraction:saved'; extraction: Extraction };
