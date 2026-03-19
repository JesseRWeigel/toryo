# Contributing Guide

Toryo is a TypeScript monorepo managed with npm workspaces. This guide covers development setup, testing, project structure, and how to extend the system.

## Development Setup

### Prerequisites

- Node.js 20+
- npm 9+
- Git

### Clone and Build

```bash
git clone https://github.com/your-org/toryo.git
cd toryo
npm install
npm run build
```

The build command compiles all packages in dependency order:

1. `@toryo/core` (no dependencies on other packages)
2. `@toryo/adapters` (depends on `@toryo/core`)
3. `toryo` CLI (depends on `@toryo/core` and `@toryo/adapters`)

### Build Tooling

All packages use [tsup](https://tsup.egoist.dev/) for bundling. Each package has its own `tsconfig.json` extending the root `tsconfig.base.json`.

## Running Tests

```bash
# Run all tests across all packages
npm test

# Run tests for a specific package
npm test -w packages/core

# Run tests in watch mode
npx vitest -w packages/core
```

Tests use [Vitest](https://vitest.dev/) and are located in `__tests__/` directories within each package's `src/` folder.

Existing test files:

- `packages/core/src/__tests__/truncation.test.ts`
- `packages/core/src/__tests__/delegation.test.ts`
- `packages/core/src/__tests__/ratchet.test.ts`
- `packages/core/src/__tests__/metrics.test.ts`
- `packages/core/src/__tests__/extraction.test.ts`
- `packages/core/src/__tests__/specs.test.ts`

## Project Structure

```
toryo/
  package.json              # Root workspace config
  tsconfig.base.json        # Shared TypeScript config
  packages/
    core/                   # @toryo/core — Engine
      src/
        types.ts            # All TypeScript interfaces and type definitions
        orchestrator.ts     # Main cycle runner (createOrchestrator)
        delegation.ts       # Trust-based agent selection (createDelegation)
        ratchet.ts          # Git commit/revert quality gate (createRatchet)
        metrics.ts          # Results.tsv and metrics.json management (createMetrics)
        extraction.ts       # Code block and skill extraction from output
        truncation.ts       # Smart truncation for phase context passing
        specs.ts            # Markdown spec parser (YAML frontmatter + body)
        notifications.ts    # Push notification providers (ntfy, slack, discord, webhook)
        index.ts            # Public API exports
        __tests__/          # Vitest test files
      vitest.config.ts
    adapters/               # @toryo/adapters — Agent tool wrappers
      src/
        base.ts             # CliAdapter abstract base class
        claude-code.ts      # Claude Code CLI adapter
        aider.ts            # Aider CLI adapter
        gemini-cli.ts       # Gemini CLI adapter
        codex.ts            # Codex CLI adapter
        ollama.ts           # Ollama HTTP API adapter
        custom.ts           # Generic CLI adapter
        index.ts            # Public API + createAdapter factory
    cli/                    # toryo — CLI entry point
      src/
        index.ts            # CLI commands: run, status, init, dashboard
    dashboard/              # @toryo/dashboard — Web UI
      src/
        server.ts           # Hono HTTP + WebSocket server
        client.html         # Single-page dashboard (vanilla JS)
  examples/
    toryo.config.json       # Example configuration
    specs/                  # Example task specs
  docs/                     # Documentation
  specs/                    # Default specs directory (empty)
```

## How to Add a New Adapter

1. **Create the adapter file** in `packages/adapters/src/`:

```typescript
// packages/adapters/src/my-tool.ts
import { CliAdapter } from './base.js';
import type { AdapterSendOptions } from '@toryo/core';

export class MyToolAdapter extends CliAdapter {
  name = 'my-tool';

  buildCommand(options: AdapterSendOptions) {
    const args = ['--prompt', '{{PROMPT}}'];
    if (options.model) {
      args.unshift('--model', options.model);
    }
    return { command: 'my-tool-cli', args };
  }

  parseOutput(stdout: string): string {
    return stdout.trim();
  }

  async isAvailable(): Promise<boolean> {
    return this.commandExists('my-tool-cli');
  }
}
```

2. **Export it** from `packages/adapters/src/index.ts`:

```typescript
export { MyToolAdapter } from './my-tool.js';
```

3. **Register it** in the `createAdapter` factory in the same file:

```typescript
case 'my-tool':
  return new MyToolAdapter();
```

4. **Write tests** in `packages/adapters/src/__tests__/my-tool.test.ts`.

5. **Build and verify**:

```bash
npm run build
```

## How to Add a New Phase Type

Toryo's phase system is string-based -- you can add custom phases without changing core code.

1. **Add the phase to your config**:

```json
{
  "phases": ["plan", "research", "execute", "validate", "review"]
}
```

2. **Reference it in specs**:

```yaml
phases:
  plan: auto
  research: auto
  execute: coder
  validate: tester
  review: reviewer
```

3. **Optionally add phase hints** in `packages/core/src/orchestrator.ts` for better auto-delegation:

```typescript
const phaseHints: Record<string, string> = {
  plan: 'plan and design the approach',
  research: 'research and analyze information',
  execute: 'implement and write code',
  validate: 'run tests and validate the implementation',
  review: 'review and score output quality',
};
```

The `review` phase has special handling in the orchestrator -- it is always run last and its output is parsed for a score and verdict. Custom phases other than `review` are treated like plan/research/execute: their output is passed to the next phase as context.

## Key Design Patterns

### Factory Functions

Every subsystem in `@toryo/core` uses a factory function pattern rather than classes:

```typescript
const delegation = createDelegation(config);
const ratchet = createRatchet(config, cwd);
const metrics = createMetrics(outputDir);
```

This makes subsystems composable and testable in isolation.

### Event System

The orchestrator emits `ToryoEvent` objects via a callback (`onEvent`). Event types are defined as a discriminated union in `types.ts`. The CLI formats events for terminal output; the dashboard broadcasts them over WebSocket.

### No Global State

All state is passed explicitly through function arguments or returned from factory functions. The orchestrator, delegation system, ratchet, and metrics manager each hold their own state internally.

## PR Guidelines

- **Keep PRs focused** -- one feature or fix per PR.
- **Include tests** for new functionality. Run `npm test` to verify nothing is broken.
- **Build before pushing** -- run `npm run build` to catch TypeScript errors.
- **Update types** -- if you change interfaces or add new fields, update `packages/core/src/types.ts`.
- **Update docs** -- if your change affects user-facing behavior, update the relevant docs in `docs/`.
- **Follow existing patterns** -- look at how similar features are implemented before writing new code. Use factory functions, explicit state passing, and the event system.
