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
import { createKnowledgeStore } from './knowledge.js';
import { gatherProjectContext } from './context.js';

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
  /\[infra\]/i,
  /Timeout exceeded/i,
  /E2BIG/i,
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
  const knowledge = createKnowledgeStore(config.outputDir);
  let projectContext = '';

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
  ): Promise<{ output: string; durationMs: number; infraFailure: boolean; error?: string }> {
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
    const patterns = [
      /(\d+(?:\.\d+)?)\s*\/\s*10/,           // X/10
      /(\d+(?:\.\d+)?)\s*out of\s*10/i,       // X out of 10
      /Score:\s*\*?\*?(\d+(?:\.\d+)?)\*?\*?/i, // Score: **X** (markdown bold)
      /Rating:\s*(\d+(?:\.\d+)?)/i,            // Rating: X
      /score:\s*(\d+(?:\.\d+)?)/i,             // score: X (original fallback)
    ];

    for (const pattern of patterns) {
      const match = output.match(pattern);
      if (match) return parseFloat(match[1]);
    }

    return 0;
  }

  function parseVerdict(output: string, score: number, threshold: number): ReviewResult['verdict'] {
    if (score >= threshold) return 'pass';
    // Check if LLM explicitly said needs_revision (on its own line)
    if (/^(NEEDS_REVISION|needs revision)/m.test(output)) return 'needs_revision';
    return 'fail';
  }

  async function runPhase(
    phase: PhaseName,
    agentId: string,
    prompt: string,
    cycleNum: number,
  ): Promise<PhaseResult> {
    emit({ type: 'phase:start', cycle: cycleNum, phase, agent: agentId });

    const response = await sendToAgent(agentId, prompt, phase);

    // Check for infrastructure failures (timeout, connection refused, etc.)
    if (response.infraFailure) {
      const errorMsg = response.error ?? 'Unknown infrastructure failure';
      throw new Error(`[infra] ${phase} phase failed for agent ${agentId}: ${errorMsg}`);
    }

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
      durationMs: response.durationMs,
      extractions,
    };

    emit({ type: 'phase:complete', cycle: cycleNum, phase, result });
    return result;
  }

  async function runCycle(cycleNum: number, task: TaskSpec): Promise<CycleResult> {
    emit({ type: 'cycle:start', cycle: cycleNum, task: task.id });

    const phases = config.phases ?? ['plan', 'research', 'execute', 'review'];
    const reviewPhase = phases[phases.length - 1]; // Last phase is always the quality gate
    const workPhases = phases.slice(0, -1); // All phases except the last (quality gate)
    const phaseResults: PhaseResult[] = [];
    let previousOutput = '';

    // --- Run work phases (all except last/review phase) ---
    for (const phase of workPhases) {
      const assignment = task.phases.find((p) => p.phase === phase);

      // Build prompt: task description + previous phase output + knowledge context
      const contextFromPrevious = previousOutput
        ? `\n\n## Context from previous phase\n${truncateForPhase(previousOutput)}`
        : '';
      const knowledgeContext = await knowledge.toContext(2000);
      const knowledgeSection = knowledgeContext ? `\n\n${knowledgeContext}` : '';
      // Only inject project context into execute-like phases (not plan/research/review)
      // to avoid bloating prompts and causing timeouts
      const contextPhases = ['execute', 'implement', 'code', 'build'];
      const shouldInjectContext = contextPhases.some((cp) => phase.toLowerCase().includes(cp));
      const projectSection = shouldInjectContext && projectContext ? `\n\n${projectContext}` : '';
      const prompt = `${task.description}\n\n## Acceptance Criteria\n${task.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}${contextFromPrevious}${knowledgeSection}${projectSection}`;

      // --- Parallel execution: run multiple agents concurrently ---
      if (assignment?.parallel && assignment.parallel.agents.length > 0) {
        const parallelResults = await Promise.all(
          assignment.parallel.agents.map((id) => runPhase(phase, id, prompt, cycleNum)),
        );

        let mergedResult: PhaseResult;
        if (assignment.parallel.merge === 'best') {
          // Pick the result with the highest score (heuristic: longest output wins as proxy)
          // For a proper "best" strategy, score each output and pick the highest
          const scored = parallelResults.map((r) => ({
            result: r,
            score: parseScore(r.output),
          }));
          // If no scores found (all 0), fall back to longest output
          const hasScores = scored.some((s) => s.score > 0);
          if (hasScores) {
            scored.sort((a, b) => b.score - a.score);
          } else {
            scored.sort((a, b) => b.result.output.length - a.result.output.length);
          }
          mergedResult = scored[0].result;
        } else {
          // 'concatenate': combine all outputs
          mergedResult = {
            phase,
            agentId: assignment.parallel.agents.join('+'),
            output: parallelResults.map((r) => `## Output from ${r.agentId}\n${r.output}`).join('\n\n'),
            durationMs: Math.max(...parallelResults.map((r) => r.durationMs)),
            extractions: parallelResults.flatMap((r) => r.extractions),
          };
        }

        phaseResults.push(mergedResult);
        previousOutput = mergedResult.output;
      } else {
        // --- Single agent execution (original path) ---
        let agentId: string;
        if (assignment?.agent && assignment.agent !== 'auto') {
          agentId = assignment.agent;
        } else {
          // Phase-aware agent selection: create a synthetic task that emphasizes this phase
          // Use phase-only description so profiling matches the right agent
          // without being diluted by original task keywords
          const phaseDescriptions: Record<string, string> = {
            plan: 'plan design architect strategy approach',
            research: 'research analyze investigate search find survey',
            execute: 'implement code build write create function class test',
            review: 'review audit check verify validate assess score quality',
          };
          const phaseTask: TaskSpec = {
            ...task,
            description: phaseDescriptions[phase] ?? phase,
            acceptanceCriteria: [],
          };
          agentId = delegation.selectAgent(phaseTask, config.agents, agentStates);
        }

        const result = await runPhase(phase, agentId, prompt, cycleNum);
        phaseResults.push(result);
        previousOutput = result.output;
      }
    }

    // --- Commit before QA ---
    if (await ratchet.isGitRepo()) {
      await ratchet.commit(`toryo cycle-${cycleNum}: ${task.id}`, [config.outputDir]);
    }

    // --- QA Review Phase (last phase in the phases array) ---
    const reviewAssignment = task.phases.find((p) => p.phase === reviewPhase);
    const reviewerAgentId =
      reviewAssignment?.agent === 'auto' || !reviewAssignment
        ? delegation.selectAgent(
            { ...task, description: 'review audit check verify validate assess score quality', acceptanceCriteria: [] },
            config.agents,
            agentStates,
          )
        : reviewAssignment.agent;

    // Use the last work phase's output, or fall back to previousOutput
    const executeOutput = phaseResults.length > 0
      ? phaseResults[phaseResults.length - 1].output
      : previousOutput;

    const reviewPrompt = buildReviewPrompt(task, executeOutput);
    const reviewResult = await runPhase(reviewPhase, reviewerAgentId, reviewPrompt, cycleNum);

    const reviewScore = parseScore(reviewResult.output);
    const review: ReviewResult = {
      score: reviewScore,
      verdict: parseVerdict(reviewResult.output, reviewScore, config.ratchet.threshold),
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

        // Retry the last work phase with QA feedback
        const lastWorkPhase = workPhases[workPhases.length - 1];
        const executeAgent = phaseResults.find((p) => p.phase === lastWorkPhase)?.agentId ??
          Object.keys(config.agents)[0];
        const retryPrompt = ratchet.buildRetryPrompt(task.description, review.feedback);
        const retryResult = await runPhase(lastWorkPhase, executeAgent, retryPrompt, cycleNum);

        // Commit retry
        if (await ratchet.isGitRepo()) {
          await ratchet.commit(
            `toryo cycle-${cycleNum}: ${task.id} (retry ${retryCount})`,
            [config.outputDir],
          );
        }

        // Re-review
        const retryReviewResult = await runPhase(reviewPhase, reviewerAgentId, buildReviewPrompt(task, retryResult.output), cycleNum);
        const retryScore = parseScore(retryReviewResult.output);
        const retryReview: ReviewResult = {
          score: retryScore,
          verdict: parseVerdict(retryReviewResult.output, retryScore, config.ratchet.threshold),
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
    const lastWorkPhase = workPhases[workPhases.length - 1];
    const executorId = phaseResults.find((p) => p.phase === lastWorkPhase)?.agentId ?? Object.keys(config.agents)[0];
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

    // Save cycle result to knowledge store for cross-agent context sharing
    // Find the last work phase output (not the review phase)
    const workPhaseResults = phaseResults.filter(p => p.phase !== reviewPhase);
    const lastWorkOutput = workPhaseResults.length > 0
      ? workPhaseResults[workPhaseResults.length - 1].output
      : '';
    await knowledge.set(
      `cycle-${cycleNum}-${task.id}`,
      truncateForPhase(lastWorkOutput, 1000),
      executorId,
      [task.id, workPhaseResults[workPhaseResults.length - 1]?.phase ?? 'execute', verdict],
    );

    return cycleResult;
  }

  async function run(tasks: TaskSpec[], startCycle = 1, maxCycles?: number): Promise<CycleResult[]> {
    const results: CycleResult[] = [];
    let cycleNum = startCycle;

    let shuttingDown = false;
    const shutdown = () => { shuttingDown = true; };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Gather project context once at the start
    if (config.context) {
      projectContext = await gatherProjectContext(config.context, cwd);
    }

    try {
      while (!shuttingDown) {
        if (maxCycles && cycleNum - startCycle >= maxCycles) break;

        const taskIndex = (cycleNum - 1) % tasks.length;
        const task = tasks[taskIndex];

        try {
          const result = await runCycle(cycleNum, task);
          results.push(result);
        } catch (error) {
          if (shuttingDown) {
            // Interrupted mid-cycle — log as skip
            const row: ResultRow = {
              timestamp: new Date().toISOString(),
              cycle: cycleNum,
              task: task.id,
              agent: 'system',
              score: 0,
              status: 'skip',
              description: 'Interrupted by shutdown signal',
            };
            await metrics.appendResult(row);
            break;
          }

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
    } finally {
      process.off('SIGINT', shutdown);
      process.off('SIGTERM', shutdown);
      await metrics.saveMetrics(globalMetrics);
    }

    return results;
  }

  function stop() {
    // Programmatic graceful shutdown — equivalent to receiving SIGINT/SIGTERM
    process.emit('SIGINT');
  }

  return {
    run,
    runCycle,
    stop,
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
