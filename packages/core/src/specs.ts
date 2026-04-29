import { readdir, readFile } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { TaskSpec, PhaseAssignment } from './types.js';

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

interface SpecPhaseConfig {
  agent: string;
  parallel?: {
    agents: string[];
    merge: 'concatenate' | 'best';
  };
}

interface SpecFrontmatter {
  name?: string;
  phases?: Record<string, string | SpecPhaseConfig>;
  difficulty?: number;
  tags?: string[];
  acceptance_criteria?: string[];
  reasoning_effort?: string;
}

export async function loadSpecs(specsPath: string): Promise<TaskSpec[]> {
  const entries = await readdir(specsPath);
  const mdFiles = entries
    .filter((f) => extname(f) === '.md')
    .sort();

  const specs: TaskSpec[] = [];

  for (const file of mdFiles) {
    const content = await readFile(join(specsPath, file), 'utf-8');
    const spec = parseSpec(content, basename(file, '.md'));
    if (spec) specs.push(spec);
  }

  return specs;
}

export function parseSpec(content: string, defaultId: string): TaskSpec | null {
  const match = content.match(FRONTMATTER_RE);

  if (!match) {
    // No frontmatter — treat entire content as description
    return {
      id: defaultId,
      name: defaultId.replace(/-/g, ' '),
      description: content.trim(),
      acceptanceCriteria: parseAcceptanceCriteria(content),
      phases: defaultPhases(),
    };
  }

  const [, yamlBlock, body] = match;
  let frontmatter: SpecFrontmatter;
  try {
    frontmatter = parseYaml(yamlBlock) ?? {};
  } catch {
    return null;
  }

  const acceptanceCriteria = frontmatter.acceptance_criteria ?? parseAcceptanceCriteria(body);

  const phases: PhaseAssignment[] = frontmatter.phases
    ? Object.entries(frontmatter.phases).map(([phase, value]) => {
        if (typeof value === 'string') {
          return { phase, agent: value };
        }
        // Object form: { agent, parallel? }
        const assignment: PhaseAssignment = { phase, agent: value.agent };
        if (value.parallel) {
          assignment.parallel = {
            agents: value.parallel.agents,
            merge: value.parallel.merge,
          };
        }
        return assignment;
      })
    : defaultPhases();

  return {
    id: defaultId,
    name: frontmatter.name ?? defaultId.replace(/-/g, ' '),
    description: body.trim(),
    acceptanceCriteria,
    phases,
    difficulty: frontmatter.difficulty,
    tags: frontmatter.tags,
    reasoningEffort: frontmatter.reasoning_effort as import('./types.js').ReasoningEffort | undefined,
  };
}

function defaultPhases(): PhaseAssignment[] {
  return [
    { phase: 'plan', agent: 'auto' },
    { phase: 'research', agent: 'auto' },
    { phase: 'execute', agent: 'auto' },
    { phase: 'review', agent: 'auto' },
  ];
}

/** Parse acceptance criteria from markdown body (lines starting with - [ ] or - ) */
function parseAcceptanceCriteria(body: string): string[] {
  const lines = body.split('\n');
  const criteria: string[] = [];
  let inCriteriaSection = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^#{1,3}\s*(acceptance|criteria|done when)/i.test(trimmed)) {
      inCriteriaSection = true;
      continue;
    }

    if (inCriteriaSection) {
      if (trimmed.startsWith('#')) break; // new section
      const bulletMatch = trimmed.match(/^[-*]\s*(?:\[.\]\s*)?(.+)/);
      if (bulletMatch) {
        criteria.push(bulletMatch[1].trim());
      }
    }
  }

  return criteria;
}
