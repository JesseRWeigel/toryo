#!/usr/bin/env node

import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createOrchestrator, loadSpecs } from '@toryo/core';
import { createAdapter } from '@toryo/adapters';
import type { ToryoConfig, AgentAdapter, ToryoEvent } from '@toryo/core';

const USAGE = `
toryo — The intelligent agent orchestrator (棟梁)

Usage:
  toryo run [--config <path>] [--cycles <n>]    Run orchestration cycles
  toryo status [--config <path>]                Show metrics and agent states
  toryo init                                    Create example config + specs
  toryo --help                                  Show this help

Options:
  --config, -c    Path to toryo.config.json (default: ./toryo.config.json)
  --cycles, -n    Max cycles to run (default: unlimited)
`;

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    console.log(USAGE);
    process.exit(0);
  }

  switch (command) {
    case 'run':
      await runCommand(args.slice(1));
      break;
    case 'status':
      await statusCommand(args.slice(1));
      break;
    case 'init':
      await initCommand();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.log(USAGE);
      process.exit(1);
  }
}

async function loadConfig(args: string[]): Promise<ToryoConfig> {
  const configIndex = args.indexOf('--config') !== -1 ? args.indexOf('--config') : args.indexOf('-c');
  const configPath = configIndex !== -1
    ? resolve(args[configIndex + 1])
    : resolve('toryo.config.json');

  const raw = await readFile(configPath, 'utf-8');
  return JSON.parse(raw);
}

function parseMaxCycles(args: string[]): number | undefined {
  const cyclesIndex = args.indexOf('--cycles') !== -1 ? args.indexOf('--cycles') : args.indexOf('-n');
  if (cyclesIndex !== -1) return parseInt(args[cyclesIndex + 1], 10);
  return undefined;
}

function formatEvent(event: ToryoEvent): string {
  const time = new Date().toLocaleTimeString();

  switch (event.type) {
    case 'cycle:start':
      return `[${time}] ⟳ Cycle ${event.cycle}: ${event.task}`;
    case 'phase:start':
      return `[${time}]   → ${event.phase} (${event.agent})`;
    case 'phase:complete':
      return `[${time}]   ✓ ${event.phase} done (${(event.result.durationMs / 1000).toFixed(1)}s, ${event.result.extractions.length} extractions)`;
    case 'review:complete':
      return `[${time}]   ★ Score: ${event.review.score}/10 — ${event.review.verdict.toUpperCase()}`;
    case 'ratchet:keep':
      return `[${time}]   ✓ KEEP (${event.score}/10)`;
    case 'ratchet:revert':
      return `[${time}]   ✗ REVERT (${event.score}/10)`;
    case 'ralph:retry':
      return `[${time}]   ↺ Ralph Loop retry ${event.attempt}`;
    case 'cycle:complete':
      return `[${time}] ● Cycle ${event.cycle} complete: ${event.result.verdict} (${event.result.finalScore}/10)`;
    case 'metrics:update':
      return `[${time}]   📊 ${event.metrics.cyclesCompleted} cycles, ${(event.metrics.successRate * 100).toFixed(0)}% success`;
    case 'extraction:saved':
      return `[${time}]   💾 Saved ${event.extraction.type}: ${event.extraction.path}`;
    default:
      return `[${time}] ${JSON.stringify(event)}`;
  }
}

async function runCommand(args: string[]) {
  const config = await loadConfig(args);
  const maxCycles = parseMaxCycles(args);
  const cwd = process.cwd();

  // Create adapters
  const adapters: Record<string, AgentAdapter> = {};
  for (const [, agentConfig] of Object.entries(config.agents)) {
    if (!adapters[agentConfig.adapter]) {
      adapters[agentConfig.adapter] = createAdapter(agentConfig.adapter);
    }
  }

  // Check adapter availability
  for (const [name, adapter] of Object.entries(adapters)) {
    const available = await adapter.isAvailable();
    if (!available) {
      console.warn(`⚠ Adapter "${name}" is not available (CLI not found)`);
    }
  }

  // Load task specs
  const tasks = typeof config.tasks === 'string'
    ? await loadSpecs(resolve(config.tasks))
    : config.tasks;

  if (tasks.length === 0) {
    console.error('No task specs found. Run `toryo init` to create examples.');
    process.exit(1);
  }

  console.log(`\n棟梁 Toryo — Intelligent Agent Orchestrator`);
  console.log(`  Agents: ${Object.keys(config.agents).join(', ')}`);
  console.log(`  Tasks: ${tasks.map((t) => t.id).join(', ')}`);
  console.log(`  Ratchet threshold: ${config.ratchet.threshold}/10`);
  console.log(`  Max cycles: ${maxCycles ?? '∞'}\n`);

  const orchestrator = await createOrchestrator({
    config,
    adapters,
    cwd,
    onEvent: (event) => console.log(formatEvent(event)),
  });

  // Load starting cycle from metrics
  const metrics = orchestrator.getMetrics();
  const startCycle = metrics.cyclesCompleted + 1;

  await orchestrator.run(tasks, startCycle, maxCycles);

  console.log('\nDone.');
}

async function statusCommand(args: string[]) {
  const config = await loadConfig(args);
  const { createMetrics } = await import('@toryo/core');
  const metricsManager = createMetrics(config.outputDir);
  const metrics = await metricsManager.loadMetrics();
  const results = await metricsManager.loadResults();

  console.log(`\n棟梁 Toryo — Status`);
  console.log(`  Cycles: ${metrics.cyclesCompleted}`);
  console.log(`  Total tasks: ${metrics.totalTasks}`);
  console.log(`  Success rate: ${(metrics.successRate * 100).toFixed(1)}%\n`);

  for (const [id, agent] of Object.entries(metrics.agents)) {
    console.log(`  ${id}:`);
    console.log(`    Tasks: ${agent.tasksCompleted}`);
    console.log(`    Avg score: ${agent.avgScore.toFixed(1)}/10`);
    console.log(`    Success rate: ${(agent.successRate * 100).toFixed(1)}%`);
  }

  // Last 5 results
  const recent = results.slice(-5);
  if (recent.length > 0) {
    console.log(`\n  Recent results:`);
    for (const row of recent) {
      const icon = row.status === 'keep' ? '✓' : row.status === 'discard' ? '✗' : '⚠';
      console.log(`    ${icon} Cycle ${row.cycle}: ${row.task} — ${row.score}/10 (${row.status})`);
    }
  }
}

async function initCommand() {
  const { writeFile, mkdir } = await import('node:fs/promises');

  // Create specs directory with example
  await mkdir('specs', { recursive: true });

  await writeFile('specs/01-write-tests.md', `---
name: Write Unit Tests
difficulty: 0.5
tags: [testing, code-quality]
phases:
  plan: auto
  research: auto
  execute: auto
  review: auto
---

Write comprehensive unit tests for uncovered code in the project.

Focus on:
- Functions with complex logic or branching
- Edge cases and error handling
- Integration points between modules

## Acceptance Criteria
- [ ] Tests cover at least one previously untested module
- [ ] All tests pass when run
- [ ] Edge cases are covered (null, empty, boundary values)
- [ ] Test names clearly describe what they verify
`);

  await writeFile('toryo.config.json', JSON.stringify({
    name: 'my-project',
    agents: {
      researcher: {
        adapter: 'claude-code',
        model: 'claude-sonnet-4-6',
        strengths: ['research', 'analysis', 'summarization'],
        timeout: 900,
      },
      coder: {
        adapter: 'claude-code',
        model: 'claude-sonnet-4-6',
        strengths: ['code', 'architecture', 'testing'],
        timeout: 900,
      },
      reviewer: {
        adapter: 'claude-code',
        model: 'claude-sonnet-4-6',
        strengths: ['review', 'scoring', 'quality'],
        timeout: 600,
      },
    },
    tasks: './specs/',
    ratchet: {
      threshold: 6.0,
      maxRetries: 1,
      gitStrategy: 'commit-revert',
    },
    delegation: {
      initialTrust: 0.5,
      scoreWindow: 50,
      levels: {
        supervised: { trustRange: [0, 0.6], minTasks: 0 },
        guided: { trustRange: [0.6, 0.8], minTasks: 5 },
        autonomous: { trustRange: [0.8, 1.0], minTasks: 10 },
      },
    },
    outputDir: '.toryo',
    notifications: {
      provider: 'none',
      target: '',
      events: ['breakthrough', 'failure'],
    },
  }, null, 2) + '\n');

  console.log('棟梁 Toryo initialized!');
  console.log('  Created: toryo.config.json');
  console.log('  Created: specs/01-write-tests.md');
  console.log('\nEdit toryo.config.json to configure your agents, then run:');
  console.log('  toryo run');
}

main().catch((error) => {
  console.error('Fatal:', error);
  process.exit(1);
});
