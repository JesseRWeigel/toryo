# Contributing to Toryo

Thanks for your interest in contributing to Toryo! This guide covers everything you need to get started.

## Development Setup

1. **Prerequisites**: Node.js >= 20, npm >= 10

2. **Clone and install**:

   ```bash
   git clone https://github.com/JesseRWeigel/toryo.git
   cd toryo
   npm install
   ```

3. **Build all packages**:

   ```bash
   npm run build
   ```

   This builds packages in dependency order: core -> adapters -> cli.

4. **Run in dev mode** (watches for changes):

   ```bash
   npm run dev
   ```

## Project Structure

```
packages/
  core/       - Orchestration engine, task management, quality ratcheting, trust delegation
  adapters/   - Agent adapters (Claude Code, Aider, Gemini CLI, Ollama, Codex, custom)
  cli/        - CLI entry point (`toryo init`, `toryo run`)
  dashboard/  - Real-time monitoring dashboard
```

## Running Tests

```bash
# Run all tests across all packages
npm test

# Run tests for a specific package
npm test -w packages/core

# Run tests in watch mode
npx vitest -w packages/core
```

## How to Add an Adapter

Adapters live in `packages/adapters/src/`. Each adapter wraps a CLI tool or API behind the `AgentAdapter` interface from `@toryo/core`.

1. **Create a new file** in `packages/adapters/src/`, e.g. `my-agent.ts`.

2. **Extend `CliAdapter`** (from `base.ts`) and implement the required methods:

   ```ts
   import { CliAdapter } from './base.js';
   import type { AdapterSendOptions, AdapterResponse } from '@toryo/core';

   export class MyAgentAdapter extends CliAdapter {
     name = 'my-agent';

     buildCommand(options: AdapterSendOptions) {
       return {
         command: 'my-agent-cli',
         args: ['--prompt', '{{PROMPT}}'],
       };
     }

     parseOutput(stdout: string, stderr: string): string {
       return stdout.trim();
     }

     async isAvailable(): Promise<boolean> {
       try {
         // Check if the CLI tool is installed
         await execFileAsync('my-agent-cli', ['--version']);
         return true;
       } catch {
         return false;
       }
     }
   }
   ```

3. **Export it** from `packages/adapters/src/index.ts`.

4. **Add tests** if applicable in `packages/adapters/src/__tests__/`.

5. **Build and verify**:

   ```bash
   npm run build -w packages/adapters
   ```

## Pull Request Guidelines

- **Branch from `main`**. Use a descriptive branch name like `feat/new-adapter` or `fix/ratchet-score-bug`.
- **Keep PRs focused**. One feature or fix per PR.
- **Include tests** for new functionality when possible.
- **Run the full test suite** before submitting: `npm test`
- **Run the linter**: `npm run lint`
- **Build all packages** to catch type errors: `npm run build`
- **Write a clear PR description** explaining what changed and why.
- **Link related issues** in the PR description (e.g. "Closes #42").

## Code Style

- TypeScript with ES modules (`"type": "module"`)
- Use `tsup` for building
- Use `vitest` for testing
- Prefer named exports over default exports

## Reporting Bugs

Open an issue at https://github.com/JesseRWeigel/toryo/issues with:

- Steps to reproduce
- Expected vs actual behavior
- Node.js version and OS
- Relevant config or error output
