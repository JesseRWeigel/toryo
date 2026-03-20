import type {
  AgentProfile,
  AgentState,
  AutonomyLevel,
  DelegationConfig,
  TaskProfile,
  TaskSpec,
} from './types.js';

const DEFAULT_CONFIG: DelegationConfig = {
  initialTrust: 0.5,
  scoreWindow: 50,
  levels: {
    supervised: { trustRange: [0, 0.6], minTasks: 0 },
    guided: { trustRange: [0.6, 0.8], minTasks: 5 },
    autonomous: { trustRange: [0.8, 1.0], minTasks: 10 },
  },
};

export function createDelegation(config: Partial<DelegationConfig> = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  function computeTrust(state: AgentState): number {
    if (state.tasksCompleted < 3) return cfg.initialTrust;
    return Math.min(state.avgScore / 10.0, 1.0);
  }

  function getAutonomyLevel(state: AgentState): AutonomyLevel {
    const trust = computeTrust(state);
    const tasks = state.tasksCompleted;

    if (
      trust >= cfg.levels.autonomous.trustRange[0] &&
      tasks >= (cfg.levels.autonomous.minTasks ?? 10)
    ) {
      return 'autonomous';
    }
    if (
      trust >= cfg.levels.guided.trustRange[0] &&
      tasks >= (cfg.levels.guided.minTasks ?? 5)
    ) {
      return 'guided';
    }
    return 'supervised';
  }

  function getAutonomyInstructions(level: AutonomyLevel): string {
    switch (level) {
      case 'supervised':
        return [
          'AUTONOMY: SUPERVISED — Follow instructions precisely.',
          'Do not deviate from the task description.',
          'Use exact formats specified. Flag any uncertain decisions.',
        ].join('\n');
      case 'guided':
        return [
          'AUTONOMY: GUIDED — Follow the spec but suggest improvements.',
          'You may propose alternatives if you see a better approach.',
          'Flag decisions that deviate from the original plan.',
        ].join('\n');
      case 'autonomous':
        return [
          'AUTONOMY: AUTONOMOUS — Take initiative and be creative.',
          'You have earned trust through consistent high-quality work.',
          'Make decisions independently. Report results after action.',
        ].join('\n');
    }
  }

  function profileTask(spec: TaskSpec): TaskProfile {
    const text = `${spec.name} ${spec.description} ${spec.acceptanceCriteria.join(' ')}`.toLowerCase();

    const score = (keywords: string[]) =>
      Math.min(keywords.filter((k) => text.includes(k)).length / keywords.length, 1.0);

    return {
      complexity: spec.difficulty ?? 0.5,
      researchNeeded: score(['research', 'find', 'search', 'analyze', 'investigate', 'survey', 'compare']),
      codeNeeded: score(['implement', 'code', 'build', 'write', 'create', 'function', 'class', 'test']),
      reviewNeeded: score(['review', 'audit', 'check', 'verify', 'validate', 'assess', 'score']),
      creativity: score(['design', 'creative', 'novel', 'explore', 'brainstorm', 'innovate']),
      risk: score(['refactor', 'migrate', 'delete', 'remove', 'replace', 'breaking']),
      verifiability: score(['test', 'verify', 'benchmark', 'measure', 'assert', 'expect']),
    };
  }

  function selectAgent(
    spec: TaskSpec,
    agents: Record<string, AgentProfile>,
    states: Record<string, AgentState>,
  ): string {
    const profile = profileTask(spec);

    // Find the dominant dimension
    const dimensions: [string, number][] = [
      ['plan', profile.complexity],
      ['research', profile.researchNeeded],
      ['code', profile.codeNeeded],
      ['review', profile.reviewNeeded],
    ];
    dimensions.sort((a, b) => b[1] - a[1]);

    // Match dimension to agent strengths (check synonyms too)
    const synonyms: Record<string, string[]> = {
      plan: ['plan', 'planning', 'architect', 'design', 'strategy'],
      research: ['research', 'analysis', 'search', 'investigate', 'find'],
      code: ['code', 'coding', 'implement', 'build', 'develop', 'test'],
      review: ['review', 'score', 'quality', 'audit', 'check', 'qa'],
    };

    // Score each agent per dimension: count how many synonyms match their strengths
    for (const [dimension] of dimensions) {
      const terms = synonyms[dimension] ?? [dimension];

      let bestId: string | null = null;
      let bestScore = 0;
      let bestTrust = -1;
      let bestHasExact = false;

      for (const [id, agent] of Object.entries(agents)) {
        const state = states[id];
        // Skip agents with very low trust if they have enough history
        if (state && state.tasksCompleted >= 5 && computeTrust(state) < 0.4) {
          continue;
        }

        // Count how many synonyms match any of this agent's strengths
        const matchCount = terms.filter((t) =>
          agent.strengths.some((s) => s.toLowerCase().includes(t)),
        ).length;

        if (matchCount === 0) continue;

        const trust = state ? computeTrust(state) : cfg.initialTrust;
        const hasExact = agent.strengths.some(
          (s) => s.toLowerCase() === dimension,
        );

        // Pick agent with highest match count; break ties by trust, then exact match
        if (
          matchCount > bestScore ||
          (matchCount === bestScore && trust > bestTrust) ||
          (matchCount === bestScore && trust === bestTrust && hasExact && !bestHasExact)
        ) {
          bestId = id;
          bestScore = matchCount;
          bestTrust = trust;
          bestHasExact = hasExact;
        }
      }

      if (bestId) return bestId;
    }

    // Fallback: first agent
    return Object.keys(agents)[0];
  }

  function updateState(
    state: AgentState,
    score: number,
  ): AgentState {
    const scores = [...state.scores, score].slice(-cfg.scoreWindow);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const tasksCompleted = state.tasksCompleted + 1;
    const trustScore = computeTrust({ ...state, avgScore, tasksCompleted });

    const updated: AgentState = {
      ...state,
      scores,
      avgScore,
      tasksCompleted,
      trustScore,
      autonomyLevel: 'supervised', // placeholder, computed below
    };
    updated.autonomyLevel = getAutonomyLevel(updated);

    return updated;
  }

  function initState(agentId: string): AgentState {
    return {
      id: agentId,
      trustScore: cfg.initialTrust,
      autonomyLevel: 'supervised',
      tasksCompleted: 0,
      avgScore: 0,
      scores: [],
    };
  }

  return {
    computeTrust,
    getAutonomyLevel,
    getAutonomyInstructions,
    profileTask,
    selectAgent,
    updateState,
    initState,
  };
}
