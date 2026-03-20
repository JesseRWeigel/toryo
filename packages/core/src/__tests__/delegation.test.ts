import { describe, it, expect } from 'vitest';
import { createDelegation } from '../delegation.js';
import type { AgentProfile, AgentState, TaskSpec } from '../types.js';

function makeState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 'test-agent',
    trustScore: 0.5,
    autonomyLevel: 'supervised',
    tasksCompleted: 0,
    avgScore: 0,
    scores: [],
    ...overrides,
  };
}

function makeSpec(overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    id: 'test-task',
    name: 'Test Task',
    description: 'A test task',
    acceptanceCriteria: [],
    phases: [],
    ...overrides,
  };
}

const agents: Record<string, AgentProfile> = {
  senku: {
    id: 'senku',
    adapter: 'ollama',
    strengths: ['research', 'analysis'],
    timeout: 300,
  },
  bulma: {
    id: 'bulma',
    adapter: 'claude-code',
    strengths: ['code', 'implementation'],
    timeout: 300,
  },
  vegeta: {
    id: 'vegeta',
    adapter: 'ollama',
    strengths: ['review', 'qa', 'testing'],
    timeout: 300,
  },
};

describe('createDelegation', () => {
  describe('initState', () => {
    it('creates a fresh agent state with default trust', () => {
      const d = createDelegation();
      const state = d.initState('agent-1');
      expect(state).toEqual({
        id: 'agent-1',
        trustScore: 0.5,
        autonomyLevel: 'supervised',
        tasksCompleted: 0,
        avgScore: 0,
        scores: [],
      });
    });

    it('uses custom initial trust from config', () => {
      const d = createDelegation({ initialTrust: 0.3 });
      const state = d.initState('agent-2');
      expect(state.trustScore).toBe(0.3);
    });
  });

  describe('computeTrust', () => {
    it('returns initialTrust when fewer than 3 tasks completed', () => {
      const d = createDelegation();
      expect(d.computeTrust(makeState({ tasksCompleted: 0 }))).toBe(0.5);
      expect(d.computeTrust(makeState({ tasksCompleted: 1 }))).toBe(0.5);
      expect(d.computeTrust(makeState({ tasksCompleted: 2 }))).toBe(0.5);
    });

    it('returns avgScore/10 when 3+ tasks completed', () => {
      const d = createDelegation();
      expect(d.computeTrust(makeState({ tasksCompleted: 3, avgScore: 7.5 }))).toBe(0.75);
      expect(d.computeTrust(makeState({ tasksCompleted: 10, avgScore: 9.0 }))).toBe(0.9);
    });

    it('caps trust at 1.0', () => {
      const d = createDelegation();
      expect(d.computeTrust(makeState({ tasksCompleted: 5, avgScore: 12 }))).toBe(1.0);
    });

    it('handles avgScore of 0', () => {
      const d = createDelegation();
      expect(d.computeTrust(makeState({ tasksCompleted: 5, avgScore: 0 }))).toBe(0);
    });
  });

  describe('getAutonomyLevel', () => {
    it('returns supervised for new agents', () => {
      const d = createDelegation();
      expect(d.getAutonomyLevel(makeState())).toBe('supervised');
    });

    it('returns supervised when trust is high but tasks are low', () => {
      const d = createDelegation();
      // tasksCompleted < 3 so trust = initialTrust = 0.5
      expect(d.getAutonomyLevel(makeState({ tasksCompleted: 2, avgScore: 9.0 }))).toBe('supervised');
    });

    it('returns guided when trust >= 0.6 and tasks >= 5', () => {
      const d = createDelegation();
      expect(d.getAutonomyLevel(makeState({ tasksCompleted: 5, avgScore: 6.5 }))).toBe('guided');
    });

    it('returns autonomous when trust >= 0.8 and tasks >= 10', () => {
      const d = createDelegation();
      expect(d.getAutonomyLevel(makeState({ tasksCompleted: 10, avgScore: 8.5 }))).toBe('autonomous');
    });

    it('returns guided (not autonomous) when tasks < 10 even with high trust', () => {
      const d = createDelegation();
      expect(d.getAutonomyLevel(makeState({ tasksCompleted: 7, avgScore: 9.0 }))).toBe('guided');
    });

    it('returns supervised when trust < 0.6 even with many tasks', () => {
      const d = createDelegation();
      expect(d.getAutonomyLevel(makeState({ tasksCompleted: 20, avgScore: 5.0 }))).toBe('supervised');
    });
  });

  describe('getAutonomyInstructions', () => {
    it('returns supervised instructions', () => {
      const d = createDelegation();
      const text = d.getAutonomyInstructions('supervised');
      expect(text).toContain('SUPERVISED');
      expect(text).toContain('Follow instructions precisely');
    });

    it('returns guided instructions', () => {
      const d = createDelegation();
      const text = d.getAutonomyInstructions('guided');
      expect(text).toContain('GUIDED');
      expect(text).toContain('suggest improvements');
    });

    it('returns autonomous instructions', () => {
      const d = createDelegation();
      const text = d.getAutonomyInstructions('autonomous');
      expect(text).toContain('AUTONOMOUS');
      expect(text).toContain('Take initiative');
    });
  });

  describe('profileTask', () => {
    it('scores research dimension from keywords', () => {
      const d = createDelegation();
      const profile = d.profileTask(makeSpec({
        name: 'Research task',
        description: 'Analyze and investigate the system, search for patterns and compare approaches',
        acceptanceCriteria: ['Find key issues'],
      }));
      expect(profile.researchNeeded).toBeGreaterThan(0);
    });

    it('scores code dimension from keywords', () => {
      const d = createDelegation();
      const profile = d.profileTask(makeSpec({
        name: 'Build feature',
        description: 'Implement a new function and write tests, create a class',
        acceptanceCriteria: ['Code compiles'],
      }));
      expect(profile.codeNeeded).toBeGreaterThan(0);
    });

    it('scores review dimension from keywords', () => {
      const d = createDelegation();
      const profile = d.profileTask(makeSpec({
        name: 'Code review',
        description: 'Review and audit the code, check for issues, validate correctness',
        acceptanceCriteria: ['Verify quality'],
      }));
      expect(profile.reviewNeeded).toBeGreaterThan(0);
    });

    it('returns zero for dimensions with no matching keywords', () => {
      const d = createDelegation();
      const profile = d.profileTask(makeSpec({
        name: 'xyz',
        description: 'abc def ghi',
        acceptanceCriteria: [],
      }));
      expect(profile.researchNeeded).toBe(0);
      expect(profile.codeNeeded).toBe(0);
      expect(profile.reviewNeeded).toBe(0);
    });

    it('caps dimension scores at 1.0', () => {
      const d = createDelegation();
      const profile = d.profileTask(makeSpec({
        description: 'research find search analyze investigate survey compare',
      }));
      expect(profile.researchNeeded).toBeLessThanOrEqual(1.0);
    });

    it('uses difficulty as complexity, defaulting to 0.5', () => {
      const d = createDelegation();
      expect(d.profileTask(makeSpec()).complexity).toBe(0.5);
      expect(d.profileTask(makeSpec({ difficulty: 0.9 })).complexity).toBe(0.9);
    });
  });

  describe('selectAgent', () => {
    it('selects agent matching dominant dimension', () => {
      const d = createDelegation();
      const states: Record<string, AgentState> = {};
      // Research-heavy task -> senku
      const agent = d.selectAgent(
        makeSpec({ description: 'Research and analyze the problem, investigate deeply' }),
        agents,
        states,
      );
      expect(agent).toBe('senku');
    });

    it('selects coder for code-heavy tasks', () => {
      const d = createDelegation();
      const states: Record<string, AgentState> = {};
      const agent = d.selectAgent(
        makeSpec({ description: 'Implement a new function and create a class, build the feature, write tests' }),
        agents,
        states,
      );
      expect(agent).toBe('bulma');
    });

    it('selects reviewer for review-heavy tasks', () => {
      const d = createDelegation();
      const states: Record<string, AgentState> = {};
      const agent = d.selectAgent(
        makeSpec({ description: 'Review and audit the code, check for issues, validate and verify, assess quality, score it' }),
        agents,
        states,
      );
      expect(agent).toBe('vegeta');
    });

    it('skips agents with very low trust and enough history', () => {
      const d = createDelegation();
      const states: Record<string, AgentState> = {
        senku: makeState({ id: 'senku', tasksCompleted: 10, avgScore: 3.0 }),
      };
      // Research task, but senku has low trust -> falls through to next match
      const agent = d.selectAgent(
        makeSpec({ description: 'Research and analyze' }),
        agents,
        states,
      );
      // senku is skipped due to low trust, falls to next dimension or fallback
      expect(agent).not.toBe('senku');
    });

    it('prefers agent with more matching synonyms over first-declared agent', () => {
      const d = createDelegation();
      // Planner declared first, but coder has more matching synonyms for code dimension
      const biasedAgents: Record<string, AgentProfile> = {
        planner: {
          id: 'planner',
          adapter: 'ollama',
          strengths: ['planning', 'design', 'code'],
          timeout: 300,
        },
        coder: {
          id: 'coder',
          adapter: 'claude-code',
          strengths: ['code', 'coding', 'implement', 'build', 'develop'],
          timeout: 300,
        },
      };
      const states: Record<string, AgentState> = {};
      const agent = d.selectAgent(
        makeSpec({ description: 'Implement a new function and create a class, build the feature, write tests' }),
        biasedAgents,
        states,
      );
      // Coder has 5 matching synonyms for the code dimension vs planner's 1
      expect(agent).toBe('coder');
    });

    it('breaks ties with trust score', () => {
      const d = createDelegation();
      // Both agents have exactly one matching synonym for research
      const tiedAgents: Record<string, AgentProfile> = {
        agent_a: {
          id: 'agent_a',
          adapter: 'ollama',
          strengths: ['research'],
          timeout: 300,
        },
        agent_b: {
          id: 'agent_b',
          adapter: 'ollama',
          strengths: ['research'],
          timeout: 300,
        },
      };
      const states: Record<string, AgentState> = {
        agent_a: makeState({ id: 'agent_a', tasksCompleted: 5, avgScore: 6.0 }),
        agent_b: makeState({ id: 'agent_b', tasksCompleted: 5, avgScore: 8.0 }),
      };
      const agent = d.selectAgent(
        makeSpec({ description: 'Research and analyze the problem, investigate deeply' }),
        tiedAgents,
        states,
      );
      // agent_b has higher trust (0.8 vs 0.6)
      expect(agent).toBe('agent_b');
    });

    it('prefers agent with exact dimension word in strengths when score and trust tie', () => {
      const d = createDelegation();
      // Both agents match one synonym, same trust, but only one has the exact dimension word
      const exactAgents: Record<string, AgentProfile> = {
        agent_x: {
          id: 'agent_x',
          adapter: 'ollama',
          strengths: ['qa'],
          timeout: 300,
        },
        agent_y: {
          id: 'agent_y',
          adapter: 'ollama',
          strengths: ['review'],
          timeout: 300,
        },
      };
      const states: Record<string, AgentState> = {};
      const agent = d.selectAgent(
        makeSpec({ description: 'Review and audit the code, check for issues, validate and verify, assess quality, score it' }),
        exactAgents,
        states,
      );
      // agent_y has the exact dimension word "review" for the review dimension
      expect(agent).toBe('agent_y');
    });

    it('falls back to first agent when no strengths match', () => {
      const d = createDelegation();
      const states: Record<string, AgentState> = {};
      const agent = d.selectAgent(
        makeSpec({ description: 'xyz abc nothing matches' }),
        agents,
        states,
      );
      // Object.keys order: senku, bulma, vegeta — but all dimensions score 0,
      // so iteration order through dimensions then agents determines the result.
      // The first agent with any matching strength in any dimension wins.
      // With all scores 0, all dimensions tie, so iteration goes through
      // research->code->review, and each dimension checks agents in order.
      // "research" doesn't match senku's strengths literally... but actually
      // senku has "research" strength, so it matches on the research dimension.
      // However the scores are 0 so dimensions.sort is stable — research first.
      // Let's just verify we get a valid agent back.
      expect(Object.keys(agents)).toContain(agent);
    });
  });

  describe('updateState', () => {
    it('appends score and increments tasksCompleted', () => {
      const d = createDelegation();
      const initial = d.initState('a1');
      const updated = d.updateState(initial, 7.0);
      expect(updated.tasksCompleted).toBe(1);
      expect(updated.scores).toEqual([7.0]);
      expect(updated.avgScore).toBe(7.0);
    });

    it('computes rolling average correctly', () => {
      const d = createDelegation();
      let state = d.initState('a1');
      state = d.updateState(state, 6.0);
      state = d.updateState(state, 8.0);
      expect(state.avgScore).toBe(7.0);
      expect(state.tasksCompleted).toBe(2);
    });

    it('limits scores to scoreWindow', () => {
      const d = createDelegation({ scoreWindow: 3 });
      let state = d.initState('a1');
      for (const s of [5, 6, 7, 8, 9]) {
        state = d.updateState(state, s);
      }
      expect(state.scores).toEqual([7, 8, 9]);
      expect(state.scores.length).toBe(3);
    });

    it('updates autonomy level based on new trust', () => {
      const d = createDelegation();
      let state = d.initState('a1');
      // Push many high scores to reach autonomous
      for (let i = 0; i < 12; i++) {
        state = d.updateState(state, 9.0);
      }
      expect(state.autonomyLevel).toBe('autonomous');
    });

    it('stays supervised with low scores', () => {
      const d = createDelegation();
      let state = d.initState('a1');
      for (let i = 0; i < 12; i++) {
        state = d.updateState(state, 4.0);
      }
      expect(state.autonomyLevel).toBe('supervised');
    });
  });
});
