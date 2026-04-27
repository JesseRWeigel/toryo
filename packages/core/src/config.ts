import { z } from 'zod';
import type { ToryoConfig } from './types.js';

const KNOWN_ADAPTERS = ['claude-code', 'aider', 'gemini-cli', 'codex', 'cursor', 'ollama', 'custom'];
const KNOWN_PROVIDERS = ['ntfy', 'slack', 'discord', 'webhook', 'none'];

const AgentProfileSchema = z.object({
  adapter: z.string().refine(
    (v) => KNOWN_ADAPTERS.includes(v),
    (v) => ({ message: `Unknown adapter "${v}". Available: ${KNOWN_ADAPTERS.join(', ')}` }),
  ),
  model: z.string().optional(),
  strengths: z.array(z.string()).min(1, 'At least one strength is required'),
  weaknesses: z.array(z.string()).optional(),
  timeout: z.number().positive('Timeout must be positive').default(900),
  tools: z.array(z.string()).optional(),
});

const RatchetSchema = z.object({
  threshold: z.number().min(0).max(10).default(6.0),
  maxRetries: z.number().int().min(0).default(1),
  gitStrategy: z.enum(['commit-revert', 'branch-per-task', 'none']).default('commit-revert'),
});

const TrustRangeSchema = z.object({
  trustRange: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
  minTasks: z.number().int().min(0).optional(),
});

const DelegationSchema = z.object({
  initialTrust: z.number().min(0).max(1).default(0.5),
  scoreWindow: z.number().int().positive().default(50),
  levels: z.object({
    supervised: TrustRangeSchema.default({ trustRange: [0, 0.6] }),
    guided: TrustRangeSchema.default({ trustRange: [0.6, 0.8], minTasks: 5 }),
    autonomous: TrustRangeSchema.default({ trustRange: [0.8, 1.0], minTasks: 10 }),
  }).default({}),
}).default({});

const NotificationSchema = z.object({
  provider: z.string().refine(
    (v) => KNOWN_PROVIDERS.includes(v),
    (v) => ({ message: `Unknown notification provider "${v}". Available: ${KNOWN_PROVIDERS.join(', ')}` }),
  ).default('none'),
  target: z.string().default(''),
  events: z.array(z.string()).default([]),
}).optional();

const ProjectContextSchema = z.object({
  projectDir: z.string().optional(),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  maxContextChars: z.number().positive().optional(),
}).optional();

const ToryoConfigSchema = z.object({
  name: z.string().optional(),
  agents: z.record(AgentProfileSchema).refine(
    (agents) => Object.keys(agents).length > 0,
    'At least one agent must be defined',
  ),
  tasks: z.union([z.string(), z.array(z.any())]),
  rotation: z.array(z.string()).optional(),
  ratchet: RatchetSchema.default({}),
  delegation: DelegationSchema,
  outputDir: z.string().default('.toryo'),
  notifications: NotificationSchema,
  phases: z.array(z.string()).optional(),
  context: ProjectContextSchema,
});

export interface ConfigValidationResult {
  success: boolean;
  config?: ToryoConfig;
  errors?: string[];
}

export function validateConfig(raw: unknown): ConfigValidationResult {
  const result = ToryoConfigSchema.safeParse(raw);

  if (result.success) {
    return { success: true, config: result.data as ToryoConfig };
  }

  const errors = result.error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });

  return { success: false, errors };
}
