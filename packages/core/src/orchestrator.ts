import type {
  ToryoConfig,
  TaskSpec,
  AgentAdapter,
  AgentState,
  CycleResult,
  PhaseResult,
  PhaseName,
  ReviewResult,
  ToryoEvent,
  ResultRow,
  GlobalMetrics,
} from './types.js';
import { createDelegation } from './delegation.js';
import { createRatchet } from './ratchet.js';
import { createMetrics } from './metrics.js';
import { processOutput, saveToFile } from './extraction.js';
import { truncateForPhase } from './truncation.js';
import { createNotifier, shouldNotify, formatNotification } from './notifications.js';

interface OrchestratorOptions {
  config: ToryoConfig;
  adapters: Record<string, AgentAdapter>;
  cwd: string;
  onEvent?: (event: ToryoEvent) => void;
}

const INFRA_FAILURE_PATTERNS = [
  /session.*lock/i,
  /gateway.*closed/i,
  /ETIMEDOUT/i,
  /ECONNREFUSED/i,
  /context.*exceeded/i,
];

export async function createOrchestrator(options: OrchestratorOptions) {
  const { config, adapters, cwd, onEvent } = options;

  const delegation = createDelegation(config.delegation);
  const ratchet = createRatchet(config.ratchet, cwd);
  const metrics = createMetrics(config.outputDir);

  // Load or initialize state
  let globalMetrics = await metrics.loadMetrics();
  const agentStates: Record<string, AgentState> = {};

  for (const id of Object.keys(config.agents)) {
    const saved = globalMetrics.agents[id];
    agentStates[id] = saved
      ? {
          id,
          trustScore: delegation.computeTrust({
            id,
            trustScore: 0,
            autonomyLevel: 'supervised',
            tasksCompleted: saved.tasksCompleted,
            avgScore: saved.avgScore,
            scores: saved.scores,
          }),
          autonomyLevel: 'supervised', // computed below
          tasksCompleted: saved.tasksCompleted,
          avgScore: saved.avgScore,
          scores: saved.scores,
        }
      : delegation.initState(id);
    agentStates[id].autonomyLevel = delegation.getAutonomyLevel(agentStates[id]);
  }

  const notifier = createNotifier(config.notifications);

  function emit(event: ToryoEvent) {
    onEvent?.(event);

    // Send notifications for qualifying events
    if (notifier && config.notifications && shouldNotify(event, config.notifications.events)) {
      const { title, body, priority } = formatNotification(event, globalMetrics);
      notifier.send(title, body, priority).catch(() => {
        // Notification failures should not break the orchestrator
      });
    }
  }

  async function sendToAgent(
    agentId: string,
    prompt: string,
    phase: PhaseName,
  ): Promise<{ output: string; durationMs: number; infraFailure: boolean }> {
    const agentConfig = config.agents[agentId];
    if (!agentConfig) throw new Error(`Unknown agent: ${agentId}`);

    const adapter = adapters[agentConfig.adapter];
    if (!adapter) throw new Error(`Unknown adapter: ${agentConfig.adapter}`);

    const state = agentStates[agentId];
    const autonomyPrefix = delegation.getAutonomyInstructions(state.autonomyLevel);

    const response = await adapter.send({
      agentId,
      prompt,
      timeout: agentConfig.timeout,
      model: agentConfig.model,
      autonomyPrefix,
      cwd,
    });

    return response;
  }

  function isInfraFailure(output: string, error?: string): boolean {
    const text = `${output} ${error ?? ''}`;
    return INFRA_FAILURE_PATTERNS.some((p) => p.test(text));
  }

  function parseScore(output: string): number {
    // Look for X/10 pattern
    const match = output.match(/(\d+(?:\.\d+)?)\s*\/\s*10/);
    if (match) return parseFloat(match[1]);

    // Look for "score: X" pattern
    const scoreMatch = output.match(/score:\s*(\d+(?:\.\d+)?)/i);
    if (scoreMatch) return parseFloat(scoreMatch[1]);

    return 0;
  }

  function parseVerdict(output: string): ReviewResult['verdict'] {
    const lower = output.toLowerCase();
    if (lower.includes('pass')) return 'pass';
    if (lower.includes('needs_revision') || lower.includes('needs revision')) return 'needs_revision';
    return 'fail';
  }

  async function runPhase(
    phase: PhaseName,
    agentId: string,
    prompt: string,
    cycleNum: number,
  ): Promise<PhaseResult> {
    emit({ type: 'phase:start', cycle: cycleNum, phase, agent: agentId });

    const start = Date.now();
    const response = await sendToAgent(agentId, prompt, phase);
    const durationMs = Date.now() - start;

    // Process output for extractions
    const extractions = processOutput(
      response.output,
      `${phase}-cycle${cycleNum}`,
      config.outputDir,
    );

    // Save extractions
    for (const item of extractions) {
      await saveToFile(item);
      emit({ type: 'extraction:saved', extraction: item });
    }

    const result: PhaseResult = {
      phase,
      agentId,
      output: response.output,
      durationMs,
      extractions,
    };

    emit({ type: 'phase:complete', cycle: cycleNum, phase, result });
    return result;
  }

  async function runCycle(cycleNum: number, task: TaskSpec): Promise<CycleResult> {
    emit({ type: 'cycle:start', cycle: cycleNum, task: task.id });

    const phases = config.phases ?? ['plan', 'research', 'execute', 'review'];
    const phaseResults: PhaseResult[] = [];
    let previousOutput = '';

    // --- Run plan/research/execute phases ---
    for (const phase of phases) {
      if (phase === 'review') continue; // handled separately

      const assignment = task.phases.find((p) => p.phase === phase);
      const agentId =
        assignment?.agent === 'auto' || !assignment
          ? delegation.selectAgent(task, config.agents, agentStates)
          : assignment.agent;

      // Build prompt: task description + previous phase output
      const contextFromPrevious = previousOutput
        ? `\n\n## Context from previous phase\n${truncateForPhase(previousOutput)}`
        : '';
      const prompt = `${task.description}\n\n## Acceptance Criteria\n${task.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}${contextFromPrevious}`;

      const result = await runPhase(phase, agentId, prompt, cycleNum);
      phaseResults.push(result);
      previousOutput = result.output;
    }

    // --- Commit before QA ---
    if (await ratchet.isGitRepo()) {
      await ratchet.commit(`toryo cycle-${cycleNum}: ${task.id}`, [config.outputDir]);
    }

    // --- QA Review Phase ---
    if (!phases.includes('review')) {
      // No review phase — auto-keep
      const cycleResult: CycleResult = {
        cycleNumber: cycleNum,
        task: task.id,
        timestamp: new Date().toISOString(),
        phases: phaseResults,
        finalScore: 10,
        verdict: 'keep',
        retryCount: 0,
      };
      emit({ type: 'cycle:complete', cycle: cycleNum, result: cycleResult });
      return cycleResult;
    }

    const reviewAssignment = task.phases.find((p) => p.phase === 'review');
    const reviewerAgentId =
      reviewAssignment?.agent === 'auto' || !reviewAssignment
        ? delegation.selectAgent(
            { ...task, description: 'review and score output quality' },
            config.agents,
            agentStates,
          )
        : reviewAssignment.agent;

    const executeOutput = phaseResults.find((p) => p.phase === 'execute')?.output ?? previousOutput;

    const reviewPrompt = buildReviewPrompt(task, executeOutput);
    const reviewResult = await runPhase('review', reviewerAgentId, reviewPrompt, cycleNum);

    const review: ReviewResult = {
      score: parseScore(reviewResult.output),
      verdict: parseVerdict(reviewResult.output),
      feedback: reviewResult.output,
    };
    phaseResults.push(reviewResult);

    emit({ type: 'review:complete', cycle: cycleNum, review });

    // --- Ratchet Decision ---
    let finalScore = review.score;
    let verdict = ratchet.getVerdict(review, 0);
    let retryCount = 0;

    if (ratchet.shouldKeep(review)) {
      emit({ type: 'ratchet:keep', cycle: cycleNum, score: finalScore });
    } else {
      emit({ type: 'ratchet:revert', cycle: cycleNum, score: finalScore });

      if (await ratchet.isGitRepo()) {
        await ratchet.revert();
      }

      // --- Ralph Loop ---
      while (ratchet.canRetry(retryCount)) {
        retryCount++;
        emit({ type: 'ralph:retry', cycle: cycleNum, attempt: retryCount, feedback: review.feedback });

        // Retry the execute phase with QA feedback
        const executeAgent = phaseResults.find((p) => p.phase === 'execute')?.agentId ??
          Object.keys(config.agents)[0];
        const retryPrompt = ratchet.buildRetryPrompt(task.description, review.feedback);
        const retryResult = await runPhase('execute', executeAgent, retryPrompt, cycleNum);

        // Commit retry
        if (await ratchet.isGitRepo()) {
          await ratchet.commit(
            `toryo cycle-${cycleNum}: ${task.id} (retry ${retryCount})`,
            [config.outputDir],
          );
        }

        // Re-review
        const retryReviewResult = await runPhase('review', reviewerAgentId, buildReviewPrompt(task, retryResult.output), cycleNum);
        const retryReview: ReviewResult = {
          score: parseScore(retryReviewResult.output),
          verdict: parseVerdict(retryReviewResult.output),
          feedback: retryReviewResult.output,
        };

        finalScore = retryReview.score;

        if (ratchet.shouldKeep(retryReview)) {
          verdict = 'keep';
          emit({ type: 'ratchet:keep', cycle: cycleNum, score: finalScore });
          break;
        } else {
          if (await ratchet.isGitRepo()) {
            await ratchet.revert();
          }
          verdict = 'discard';
        }
      }
    }

    // --- Update metrics ---
    const executorId = phaseResults.find((p) => p.phase === 'execute')?.agentId ?? Object.keys(config.agents)[0];
    agentStates[executorId] = delegation.updateState(agentStates[executorId], finalScore);

    globalMetrics = metrics.updateAgentMetrics(
      globalMetrics,
      executorId,
      finalScore,
      verdict === 'keep',
    );
    globalMetrics.cyclesCompleted = cycleNum;
    await metrics.saveMetrics(globalMetrics);

    // Log to results.tsv
    const row: ResultRow = {
      timestamp: new Date().toISOString(),
      cycle: cycleNum,
      task: task.id,
      agent: executorId,
      score: finalScore,
      status: verdict,
      description: `QA ${verdict === 'keep' ? 'approved' : 'rejected'}${retryCount > 0 ? ` after retry ${retryCount}` : ''}: ${review.verdict.toUpperCase()}`,
    };
    await metrics.appendResult(row);

    emit({ type: 'metrics:update', metrics: globalMetrics });

    const cycleResult: CycleResult = {
      cycleNumber: cycleNum,
      task: task.id,
      timestamp: new Date().toISOString(),
      phases: phaseResults,
      finalScore,
      verdict,
      retryCount,
    };

    emit({ type: 'cycle:complete', cycle: cycleNum, result: cycleResult });
    return cycleResult;
  }

  async function run(tasks: TaskSpec[], startCycle = 1, maxCycles?: number): Promise<CycleResult[]> {
    const results: CycleResult[] = [];
    let cycleNum = startCycle;

    while (true) {
      if (maxCycles && cycleNum - startCycle >= maxCycles) break;

      const taskIndex = (cycleNum - 1) % tasks.length;
      const task = tasks[taskIndex];

      try {
        const result = await runCycle(cycleNum, task);
        results.push(result);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        if (isInfraFailure('', errorMsg)) {
          const row: ResultRow = {
            timestamp: new Date().toISOString(),
            cycle: cycleNum,
            task: task.id,
            agent: 'system',
            score: 0,
            status: 'crash',
            description: `Infrastructure failure: ${errorMsg.slice(0, 200)}`,
          };
          await metrics.appendResult(row);
        } else {
          throw error;
        }
      }

      cycleNum++;
    }

    return results;
  }

  return {
    run,
    runCycle,
    getMetrics: () => globalMetrics,
    getAgentStates: () => ({ ...agentStates }),
  };
}

function buildReviewPrompt(task: TaskSpec, output: string): string {
  return [
    'Review the following output and score it on a scale of 1-10.',
    '',
    '## Scoring Rubric',
    '- 9-10: Exceptional. Exceeds all criteria. Production-ready.',
    '- 7-8: Good. Meets criteria with minor issues.',
    '- 5-6: Acceptable. Meets basic criteria but needs improvement.',
    '- 3-4: Below standard. Missing key criteria.',
    '- 1-2: Poor. Fundamentally flawed.',
    '',
    '## Task',
    task.description,
    '',
    '## Acceptance Criteria',
    ...task.acceptanceCriteria.map((c) => `- ${c}`),
    '',
    '## Output to Review',
    truncateForPhase(output),
    '',
    'Respond with:',
    '1. A score as X/10',
    '2. PASS, NEEDS_REVISION, or FAIL',
    '3. Specific feedback on what was good and what needs improvement',
  ].join('\n');
}
