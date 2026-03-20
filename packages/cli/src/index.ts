#!/usr/bin/env node

import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createOrchestrator, loadSpecs } from 'toryo-core';
import { createAdapter } from 'toryo-adapters';
import type { ToryoConfig, AgentAdapter, ToryoEvent } from 'toryo-core';

const USAGE = `
toryo — The intelligent agent orchestrator (棟梁)

Usage:
  toryo run [--config <path>] [--cycles <n>]    Run orchestration cycles
  toryo status [--config <path>]                Show metrics and agent states
  toryo dashboard [--config <path>]             Open real-time web dashboard
  toryo history [--config <path>]                Show score trend chart
  toryo export [--config <path>]                 Export results as markdown report
  toryo check [--config <path>]                 Validate config and check tools
  toryo init                                    Create example config + specs
  toryo --help                                  Show this help

Options:
  --config, -c    Path to toryo.config.json (default: ./toryo.config.json)
  --cycles, -n    Max cycles to run (default: unlimited)
  --task, -t      Run only the task matching this ID (substring match)
  --dry-run       Show what would run without executing
  --verbose       Show all events including extraction saves
  --quiet         Show only cycle results (no phase details)
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
    case 'dashboard':
      await dashboardCommand(args.slice(1));
      break;
    case 'check':
      await checkCommand(args.slice(1));
      break;
    case 'export':
      await exportCommand(args.slice(1));
      break;
    case 'history':
      await historyCommand(args.slice(1));
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

  let raw: string;
  try {
    raw = await readFile(configPath, 'utf-8');
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Config file not found: ${configPath}. Run 'toryo init' to create one.`);
    }
    throw new Error(`Error reading config: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    return JSON.parse(raw);
  } catch (err: unknown) {
    if (err instanceof SyntaxError) {
      throw new Error(`Invalid JSON in config file: ${err.message}`);
    }
    throw err;
  }
}

function parseMaxCycles(args: string[]): number | undefined {
  const cyclesIndex = args.indexOf('--cycles') !== -1 ? args.indexOf('--cycles') : args.indexOf('-n');
  if (cyclesIndex !== -1) return parseInt(args[cyclesIndex + 1], 10);
  return undefined;
}

function parseTaskFilter(args: string[]): string | undefined {
  const taskIndex = args.indexOf('--task') !== -1 ? args.indexOf('--task') : args.indexOf('-t');
  if (taskIndex !== -1) return args[taskIndex + 1];
  return undefined;
}

// ANSI color helpers
const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

function colorScore(score: number): string {
  const s = `${score}/10`;
  if (score >= 8) return c.green(s);
  if (score >= 6) return c.yellow(s);
  return c.red(s);
}

function formatEvent(event: ToryoEvent): string {
  const time = c.dim(new Date().toLocaleTimeString());

  switch (event.type) {
    case 'cycle:start':
      return `${time} ${c.bold(`⟳ Cycle ${event.cycle}`)}: ${event.task}`;
    case 'phase:start':
      return `${time}   → ${event.phase} ${c.cyan(`(${event.agent})`)}`;
    case 'phase:complete':
      return `${time}   ${c.green('✓')} ${event.phase} done ${c.dim(`(${(event.result.durationMs / 1000).toFixed(1)}s, ${event.result.extractions.length} extractions)`)}`;
    case 'review:complete':
      return `${time}   ★ Score: ${colorScore(event.review.score)} — ${event.review.verdict === 'pass' ? c.green('PASS') : event.review.verdict === 'needs_revision' ? c.yellow('NEEDS_REVISION') : c.red('FAIL')}`;
    case 'ratchet:keep':
      return `${time}   ${c.green(`✓ KEEP (${event.score}/10)`)}`;
    case 'ratchet:revert':
      return `${time}   ${c.red(`✗ REVERT (${event.score}/10)`)}`;
    case 'ralph:retry':
      return `${time}   ${c.yellow(`↺ Ralph Loop retry ${event.attempt}`)}`;
    case 'cycle:complete': {
      const totalMs = event.result.phases.reduce((s, p) => s + p.durationMs, 0);
      const duration = totalMs > 60000 ? `${(totalMs / 60000).toFixed(1)}m` : `${(totalMs / 1000).toFixed(0)}s`;
      const verdict = event.result.verdict === 'keep' ? c.green('keep') : c.red(event.result.verdict);
      return `${time} ● Cycle ${event.cycle} complete: ${verdict} (${colorScore(event.result.finalScore)}) ${c.dim(`in ${duration}`)}`;
    }
    case 'metrics:update':
      return `${time}   📊 ${event.metrics.cyclesCompleted} cycles, ${(event.metrics.successRate * 100).toFixed(0)}% success`;
    case 'extraction:saved':
      return `${time}   💾 Saved ${event.extraction.type}: ${c.dim(event.extraction.path)}`;
    default:
      return `${time} ${JSON.stringify(event)}`;
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
  let tasks = typeof config.tasks === 'string'
    ? await loadSpecs(resolve(config.tasks))
    : config.tasks;

  const taskFilter = parseTaskFilter(args);
  if (taskFilter) {
    const filtered = tasks.filter(t => t.id === taskFilter || t.id.includes(taskFilter));
    if (filtered.length === 0) {
      console.error(`No task matching "${taskFilter}". Available: ${tasks.map(t => t.id).join(', ')}`);
      process.exit(1);
    }
    tasks = filtered;
  }

  if (tasks.length === 0) {
    console.error('No task specs found. Run `toryo init` to create examples.');
    process.exit(1);
  }

  console.log(`\n棟梁 Toryo — Intelligent Agent Orchestrator`);
  console.log(`  Agents: ${Object.keys(config.agents).join(', ')}`);
  console.log(`  Tasks: ${tasks.map((t) => t.id).join(', ')}`);
  console.log(`  Ratchet threshold: ${config.ratchet.threshold}/10`);
  console.log(`  Max cycles: ${maxCycles ?? '∞'}\n`);

  // Dry run — show config and exit
  if (args.includes('--dry-run')) {
    console.log('  [dry-run] Would execute the above configuration.');
    console.log(`  [dry-run] Tasks: ${tasks.map((t) => t.id).join(' → ')}`);
    for (const t of tasks) {
      console.log(`    ${t.id}: ${t.phases.map((p) => `${p.phase}(${p.agent})`).join(' → ')}`);
    }
    console.log('\n  Run without --dry-run to start orchestration.');
    return;
  }

  const orchestrator = await createOrchestrator({
    config,
    adapters,
    cwd,
    onEvent: (event) => {
      const verbose = args.includes('--verbose');
      const quiet = args.includes('--quiet');

      // In quiet mode, only show cycle-level events
      if (quiet) {
        if (event.type === 'cycle:start' || event.type === 'cycle:complete' || event.type === 'review:complete') {
          console.log(formatEvent(event));
        }
        return;
      }

      // In normal mode, skip extraction saves (noisy). Show with --verbose.
      if (event.type === 'extraction:saved' && !verbose) return;

      console.log(formatEvent(event));
    },
  });

  // Load starting cycle from metrics
  const metrics = orchestrator.getMetrics();
  const startCycle = metrics.cyclesCompleted + 1;

  await orchestrator.run(tasks, startCycle, maxCycles);

  console.log('\nDone.');
}

async function statusCommand(args: string[]) {
  const config = await loadConfig(args);
  const { createMetrics } = await import('toryo-core');
  const metricsManager = createMetrics(config.outputDir);
  const metrics = await metricsManager.loadMetrics();
  const results = await metricsManager.loadResults();

  console.log(`\n棟梁 Toryo — Status`);
  console.log(`  Cycles: ${metrics.cyclesCompleted}`);
  console.log(`  Total tasks: ${metrics.totalTasks}`);
  console.log(`  Success rate: ${(metrics.successRate * 100).toFixed(1)}%\n`);

  for (const [id, agent] of Object.entries(metrics.agents)) {
    // Determine autonomy level from trust
    const trust = Math.min(agent.avgScore / 10, 1);
    const level = trust >= 0.8 && agent.tasksCompleted >= 10
      ? 'AUTONOMOUS' : trust >= 0.6 && agent.tasksCompleted >= 5
      ? 'GUIDED' : 'SUPERVISED';
    const levelIcon = level === 'AUTONOMOUS' ? '●' : level === 'GUIDED' ? '◐' : '○';

    // Score trend (last 5 vs previous 5)
    const recent5 = agent.scores.slice(-5);
    const prev5 = agent.scores.slice(-10, -5);
    let trend = '';
    if (recent5.length >= 3 && prev5.length >= 3) {
      const recentAvg = recent5.reduce((a, b) => a + b, 0) / recent5.length;
      const prevAvg = prev5.reduce((a, b) => a + b, 0) / prev5.length;
      trend = recentAvg > prevAvg + 0.3 ? ' ↑' : recentAvg < prevAvg - 0.3 ? ' ↓' : ' →';
    }

    console.log(`  ${id}: ${levelIcon} ${level}`);
    console.log(`    Tasks: ${agent.tasksCompleted} | Avg: ${agent.avgScore.toFixed(1)}/10${trend} | Success: ${(agent.successRate * 100).toFixed(0)}%`);
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

  // Score distribution
  if (results.length > 0) {
    const allScores = results.map(r => r.score).filter(s => s > 0);
    if (allScores.length > 0) {
      const min = Math.min(...allScores);
      const max = Math.max(...allScores);
      const avg = allScores.reduce((a, b) => a + b, 0) / allScores.length;
      console.log(`\n  Scores: min ${min.toFixed(1)} / avg ${avg.toFixed(1)} / max ${max.toFixed(1)}`);
    }
  }
}

async function initCommand() {
  const { writeFile, mkdir } = await import('node:fs/promises');
  const { createAdapter } = await import('toryo-adapters');

  console.log('\n棟梁 Toryo — Initializing...\n');

  // Detect available tools
  const tools = ['claude-code', 'aider', 'gemini-cli', 'codex', 'ollama'] as const;
  const available: string[] = [];

  for (const name of tools) {
    try {
      const adapter = createAdapter(name);
      if (await adapter.isAvailable()) {
        available.push(name);
        console.log(`  ✓ Found: ${name}`);
      }
    } catch { /* skip */ }
  }

  if (available.length === 0) {
    console.log('  ⚠ No AI tools detected. Install at least one:');
    console.log('    - claude (Claude Code): https://claude.ai/code');
    console.log('    - ollama: https://ollama.ai');
    console.log('    - aider: https://aider.chat');
    console.log('\n  Generating config with claude-code as default (install it before running).\n');
    available.push('claude-code');
  }

  // Pick the best available tool for each role
  const primary = available[0];
  const secondary = available.length > 1 ? available[1] : primary;

  const agents: Record<string, unknown> = {
    planner: {
      adapter: primary,
      ...(primary === 'ollama' ? { model: 'qwen3.5:9b' } : {}),
      strengths: ['planning', 'analysis', 'strategy'],
      timeout: primary === 'ollama' ? 120 : 900,
    },
    coder: {
      adapter: secondary,
      ...(secondary === 'ollama' ? { model: 'qwen3.5:27b' } : {}),
      strengths: ['code', 'implementation', 'testing'],
      timeout: secondary === 'ollama' ? 120 : 900,
    },
    reviewer: {
      adapter: primary,
      ...(primary === 'ollama' ? { model: 'qwen3.5:9b' } : {}),
      strengths: ['review', 'scoring', 'quality'],
      timeout: primary === 'ollama' ? 120 : 600,
    },
  };

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
    agents,
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
    context: {
      projectDir: '.',
      maxContextChars: 4000,
    },
    notifications: {
      provider: 'none',
      target: '',
      events: ['breakthrough', 'failure'],
    },
  }, null, 2) + '\n');

  console.log('\n  Created: toryo.config.json');
  console.log('  Created: specs/01-write-tests.md');
  console.log(`  Agents configured for: ${available.join(', ')}`);
  console.log('\nNext steps:');
  console.log('  toryo check    — validate your setup');
  console.log('  toryo run      — start orchestration');
  console.log('  toryo run');
}

async function dashboardCommand(args: string[]) {
  const config = await loadConfig(args);
  const { resolve: pathResolve } = await import('node:path');

  const outputDir = pathResolve(config.outputDir);

  // Try to find and run the dashboard server
  const dashboardPaths = [
    pathResolve('node_modules/@toryo/dashboard/dist/server.js'),
    pathResolve('packages/dashboard/dist/server.js'),
  ];

  let serverPath: string | null = null;
  const { access } = await import('node:fs/promises');
  for (const p of dashboardPaths) {
    try {
      await access(p);
      serverPath = p;
      break;
    } catch { /* try next */ }
  }

  if (!serverPath) {
    console.error('Dashboard not found. Install @toryo/dashboard or build from packages/dashboard.');
    process.exit(1);
  }

  console.log(`\n棟梁 Toryo Dashboard`);
  console.log(`  Starting at http://localhost:3100`);
  console.log(`  Watching: ${outputDir}\n`);

  const { spawn } = await import('node:child_process');
  const child = spawn('node', [serverPath], {
    env: { ...process.env, TORYO_OUTPUT_DIR: outputDir },
    stdio: 'inherit',
  });

  // Forward signals for clean shutdown
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));

  await new Promise<void>((resolve) => child.on('close', () => resolve()));
}

async function historyCommand(args: string[]) {
  const config = await loadConfig(args);
  const { createMetrics } = await import('toryo-core');
  const metricsManager = createMetrics(config.outputDir);
  const results = await metricsManager.loadResults();

  if (results.length === 0) {
    console.log('\n  No results yet. Run some cycles first.\n');
    return;
  }

  console.log('\n棟梁 Toryo — Score History\n');

  // ASCII chart: 10 rows (scores 1-10), columns = cycles
  const chartHeight = 10;
  const maxCols = Math.min(results.length, 60); // cap at 60 columns
  const data = results.slice(-maxCols);

  for (let row = chartHeight; row >= 1; row--) {
    const label = row.toString().padStart(2);
    let line = `  ${c.dim(label)} │`;
    for (const r of data) {
      if (Math.round(r.score) >= row) {
        if (r.status === 'keep') line += c.green('█');
        else if (r.status === 'discard') line += c.red('█');
        else line += c.yellow('█');
      } else {
        line += ' ';
      }
    }
    // Threshold marker
    if (row === Math.round(config.ratchet.threshold)) {
      line += `  ${c.dim('← threshold')}`;
    }
    console.log(line);
  }

  // X axis
  console.log(`  ${c.dim('   └' + '─'.repeat(data.length))}`);

  // Legend
  const keeps = data.filter((r) => r.status === 'keep').length;
  const discards = data.filter((r) => r.status === 'discard').length;
  const crashes = data.filter((r) => r.status === 'crash' || r.status === 'skip').length;
  console.log(`\n  ${c.green('█')} keep: ${keeps}  ${c.red('█')} discard: ${discards}${crashes ? `  ${c.yellow('█')} crash/skip: ${crashes}` : ''}`);

  // Stats
  const scores = data.map((r) => r.score).filter((s) => s > 0);
  if (scores.length > 0) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const recent5 = scores.slice(-5);
    const recentAvg = recent5.reduce((a, b) => a + b, 0) / recent5.length;
    console.log(`  avg: ${avg.toFixed(1)}/10  recent: ${recentAvg.toFixed(1)}/10  cycles: ${data.length}\n`);
  }
}

async function exportCommand(args: string[]) {
  const config = await loadConfig(args);
  const { createMetrics } = await import('toryo-core');
  const { writeFile } = await import('node:fs/promises');
  const metricsManager = createMetrics(config.outputDir);
  const metrics = await metricsManager.loadMetrics();
  const results = await metricsManager.loadResults();

  if (results.length === 0) {
    console.log('\n  No results to export. Run some cycles first.\n');
    return;
  }

  const keeps = results.filter((r) => r.status === 'keep');
  const discards = results.filter((r) => r.status === 'discard');
  const scores = results.map((r) => r.score).filter((s) => s > 0);
  const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

  const lines = [
    `# Toryo Report — ${config.name ?? 'Project'}`,
    '',
    `Generated: ${new Date().toISOString().split('T')[0]}`,
    '',
    '## Summary',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total cycles | ${results.length} |`,
    `| Kept (passed QA) | ${keeps.length} (${(keeps.length / results.length * 100).toFixed(0)}%) |`,
    `| Discarded | ${discards.length} |`,
    `| Average score | ${avg.toFixed(1)}/10 |`,
    `| Score range | ${Math.min(...scores).toFixed(1)} — ${Math.max(...scores).toFixed(1)} |`,
    '',
    '## Agent Performance',
    '',
    '| Agent | Tasks | Avg Score | Success Rate |',
    '|-------|-------|-----------|-------------|',
    ...Object.entries(metrics.agents).map(([id, a]) =>
      `| ${id} | ${a.tasksCompleted} | ${a.avgScore.toFixed(1)}/10 | ${(a.successRate * 100).toFixed(0)}% |`,
    ),
    '',
    '## Results',
    '',
    '| Cycle | Task | Agent | Score | Status |',
    '|-------|------|-------|-------|--------|',
    ...results.map((r) =>
      `| ${r.cycle} | ${r.task} | ${r.agent} | ${r.score.toFixed(1)} | ${r.status} |`,
    ),
    '',
  ];

  const report = lines.join('\n');
  const outPath = 'toryo-report.md';
  await writeFile(outPath, report);
  console.log(`\n  Exported ${results.length} results to ${outPath}\n`);
}

async function checkCommand(args: string[]) {
  const config = await loadConfig(args);
  const { validateConfig } = await import('toryo-core');
  const { createAdapter } = await import('toryo-adapters');

  console.log('\n棟梁 Toryo — Preflight Check\n');

  // Validate config
  const validation = validateConfig(config);
  if (!validation.success) {
    console.log('  ✗ Config: INVALID');
    for (const err of validation.errors ?? []) {
      console.log(`    - ${err}`);
    }
    process.exit(1);
  }
  console.log('  ✓ Config: valid');

  // Check each agent's adapter availability
  let allAvailable = true;
  const adapters = new Map<string, boolean>();

  for (const [id, agentConfig] of Object.entries(config.agents)) {
    const adapterName = agentConfig.adapter;
    if (!adapters.has(adapterName)) {
      try {
        const adapter = createAdapter(adapterName);
        const available = await adapter.isAvailable();
        adapters.set(adapterName, available);
      } catch {
        adapters.set(adapterName, false);
      }
    }

    const available = adapters.get(adapterName)!;
    const icon = available ? '✓' : '✗';
    const model = agentConfig.model ? ` (${agentConfig.model})` : '';
    console.log(`  ${icon} Agent "${id}": ${adapterName}${model}${available ? '' : ' — NOT FOUND'}`);
    if (!available) allAvailable = false;
  }

  // Check tasks
  const { resolve } = await import('node:path');
  const { loadSpecs } = await import('toryo-core');

  if (typeof config.tasks === 'string') {
    try {
      const specs = await loadSpecs(resolve(config.tasks));
      console.log(`  ✓ Specs: ${specs.length} task(s) in ${config.tasks}`);
      for (const spec of specs) {
        console.log(`    - ${spec.id}: ${spec.name}`);
      }
    } catch {
      console.log(`  ✗ Specs: directory "${config.tasks}" not found or empty`);
      allAvailable = false;
    }
  } else {
    console.log(`  ✓ Specs: ${config.tasks.length} inline task(s)`);
  }

  // Check output dir
  const { existsSync } = await import('node:fs');
  const outputExists = existsSync(config.outputDir);
  console.log(`  ${outputExists ? '✓' : '○'} Output: ${config.outputDir}${outputExists ? '' : ' (will be created)'}`);

  // Summary
  console.log(`\n  Ratchet: threshold ${config.ratchet.threshold}/10, ${config.ratchet.maxRetries} retries, ${config.ratchet.gitStrategy}`);
  console.log(`  Delegation: trust ${config.delegation.initialTrust}, window ${config.delegation.scoreWindow}`);
  if (config.notifications?.provider && config.notifications.provider !== 'none') {
    console.log(`  Notifications: ${config.notifications.provider} → ${config.notifications.target}`);
  }

  if (allAvailable) {
    console.log('\n  ✓ All checks passed — ready to run!\n');
  } else {
    console.log('\n  ⚠ Some checks failed — fix issues above before running.\n');
    process.exit(1);
  }
}

main().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${msg}`);
  process.exit(1);
});
