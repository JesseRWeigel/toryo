# Adapters Guide

Adapters are how Toryo communicates with AI coding tools. Each adapter wraps a specific CLI or API, translating Toryo's prompts into tool-specific invocations and parsing the output back.

## How Adapters Work

Every adapter implements the `AgentAdapter` interface defined in `@toryo/core`:

```typescript
interface AgentAdapter {
  name: string;
  send(options: AdapterSendOptions): Promise<AdapterResponse>;
  isAvailable(): Promise<boolean>;
}

interface AdapterSendOptions {
  agentId: string;
  prompt: string;
  timeout: number;
  model?: string;
  autonomyPrefix?: string;  // Prepended to prompt based on trust level
  cwd?: string;             // Working directory for the agent
}

interface AdapterResponse {
  output: string;
  durationMs: number;
  infraFailure: boolean;    // True if timeout, crash, connection error, etc.
  error?: string;
}
```

When Toryo sends a task to an agent:

1. The delegation system prepends an **autonomy prefix** to the prompt (e.g., "AUTONOMY: SUPERVISED -- Follow instructions precisely.").
2. The adapter's `send()` method is called with the full prompt, model, timeout, and working directory.
3. The adapter executes the underlying tool and returns the output.
4. If the tool crashes, times out, or fails to connect, the adapter sets `infraFailure: true` and includes an error message.

Most adapters extend the `CliAdapter` base class, which handles process execution, timeout enforcement, and error handling. The Ollama adapter is the exception -- it uses direct HTTP calls instead of spawning a CLI process.

## Built-in Adapters

### Claude Code (`claude-code`)

Wraps the [Claude Code CLI](https://claude.ai/code) using `--print` mode for non-interactive single-prompt execution.

**Prerequisites:** Install Claude Code CLI and authenticate.

**How it runs:**

```bash
claude --print "your prompt here"
# With model selection:
claude --model claude-sonnet-4-6 --print "your prompt here"
```

**Config example:**

```json
{
  "adapter": "claude-code",
  "model": "claude-sonnet-4-6",
  "strengths": ["research", "analysis", "code"],
  "timeout": 900
}
```

**Model selection:** Pass any model name supported by the Claude CLI (e.g., `claude-sonnet-4-6`, `claude-opus-4`). If `model` is omitted, the CLI uses its default model.

**Availability check:** Runs `which claude` to verify the CLI is installed.

### Aider (`aider`)

Wraps the [Aider CLI](https://aider.chat) using `--message` for non-interactive execution with auto-commit disabled.

**Prerequisites:** Install Aider (`pip install aider-chat`) and configure your API key.

**How it runs:**

```bash
aider --no-auto-commits --yes --message "your prompt here"
# With model selection:
aider --model gpt-4o --no-auto-commits --yes --message "your prompt here"
```

**Config example:**

```json
{
  "adapter": "aider",
  "model": "gpt-4o",
  "strengths": ["code", "implementation"],
  "timeout": 900
}
```

**Flags used:**
- `--no-auto-commits` -- Toryo manages git commits via the ratchet system, so Aider's auto-commit is disabled.
- `--yes` -- Auto-confirm prompts for non-interactive execution.

**Availability check:** Runs `which aider`.

### Gemini CLI (`gemini-cli`)

Wraps the [Gemini CLI](https://github.com/google-gemini/gemini-cli) using `--prompt` mode.

**Prerequisites:** Install Gemini CLI and authenticate with Google.

**How it runs:**

```bash
gemini --prompt "your prompt here"
# With model selection:
gemini --model gemini-2.5-pro --prompt "your prompt here"
```

**Config example:**

```json
{
  "adapter": "gemini-cli",
  "model": "gemini-2.5-pro",
  "strengths": ["research", "analysis"],
  "timeout": 900
}
```

**Availability check:** Runs `which gemini`.

### Codex CLI (`codex`)

Wraps the [Codex CLI](https://github.com/openai/codex) using `--prompt` mode.

**Prerequisites:** Install Codex CLI and configure your OpenAI API key.

**How it runs:**

```bash
codex --prompt "your prompt here"
# With model selection:
codex --model o4-mini --prompt "your prompt here"
```

**Config example:**

```json
{
  "adapter": "codex",
  "model": "o4-mini",
  "strengths": ["code", "implementation"],
  "timeout": 900
}
```

**Availability check:** Runs `which codex`.

### Ollama (`ollama`)

Connects directly to [Ollama's](https://ollama.ai) HTTP API. Unlike the other adapters, this does not spawn a CLI process -- it makes HTTP requests to the Ollama server.

**Prerequisites:** Install and run Ollama (`ollama serve`). Pull the model you want to use (`ollama pull qwen3.5:27b`).

**How it works:**

```
POST http://localhost:11434/api/generate
{
  "model": "qwen3.5:27b",
  "prompt": "your prompt here",
  "stream": false
}
```

**Config example:**

```json
{
  "adapter": "ollama",
  "model": "qwen3.5:27b",
  "strengths": ["code", "architecture", "testing"],
  "timeout": 1200
}
```

**Default model:** `qwen3.5:27b` (if `model` is not specified in the agent config).

**Base URL:** Defaults to `http://localhost:11434`. To use a remote Ollama server, pass `baseUrl` when creating the adapter programmatically:

```typescript
import { OllamaAdapter } from '@toryo/adapters';
const adapter = new OllamaAdapter('http://my-gpu-server:11434');
```

When using the CLI, the base URL is currently not configurable via `toryo.config.json` -- the default localhost is always used. For remote servers, use the `custom` adapter or modify the adapter source.

**Availability check:** Sends `GET /api/tags` to the Ollama server and checks for a 200 response.

**Timeout:** Uses `AbortController` to cancel the HTTP request after the configured timeout.

### Custom Adapter (`custom`)

A generic adapter for wrapping any CLI tool. You provide the command and an argument template, and Toryo handles execution and output parsing.

**Usage (programmatic):**

```typescript
import { CustomAdapter } from '@toryo/adapters';

const adapter = new CustomAdapter({
  name: 'my-tool',
  command: 'my-ai-tool',
  args: ['--output-format', 'text', '--prompt', '{{PROMPT}}'],
});
```

The `{{PROMPT}}` placeholder in the args array is replaced with the full prompt (including autonomy prefix) at send time.

**Availability check:** Runs `which <command>`.

**Note:** The custom adapter is not directly accessible from `toryo.config.json` -- you need to use it programmatically via the `@toryo/adapters` package. For CLI usage, consider contributing a first-class adapter for your tool.

## Creating Adapters Programmatically

The `createAdapter` factory function creates adapters by name:

```typescript
import { createAdapter } from '@toryo/adapters';

const claude = createAdapter('claude-code');
const ollama = createAdapter('ollama', { baseUrl: 'http://gpu-server:11434' });
```

Supported names: `claude-code`, `aider`, `gemini-cli`, `codex`, `ollama`.

## Writing Your Own Adapter

To add support for a new tool, you have two options:

### Option 1: Extend CliAdapter (for CLI tools)

If your tool has a CLI that accepts a prompt and returns output on stdout, extend the `CliAdapter` base class:

```typescript
import { CliAdapter } from '@toryo/adapters';
import type { AdapterSendOptions } from '@toryo/core';

export class MyToolAdapter extends CliAdapter {
  name = 'my-tool';

  buildCommand(options: AdapterSendOptions) {
    const args = ['--prompt', '{{PROMPT}}'];

    if (options.model) {
      args.unshift('--model', options.model);
    }

    return { command: 'my-tool', args };
  }

  parseOutput(stdout: string, stderr: string): string {
    // Extract the useful output from stdout
    // Strip any tool-specific metadata, progress bars, etc.
    return stdout.trim();
  }

  async isAvailable(): Promise<boolean> {
    return this.commandExists('my-tool');
  }
}
```

The `CliAdapter` base class provides:

- **`send()`** -- Executes the command via `execFile` with timeout enforcement and a 10 MB output buffer. Automatically replaces `{{PROMPT}}` in args with the full prompt (including autonomy prefix).
- **`commandExists(cmd)`** -- Protected helper that checks `which <cmd>`.
- **Error handling** -- If the process times out, crashes, or exits non-zero, it returns `infraFailure: true` with the error message.

Environment variables can be passed via the `env` field returned from `buildCommand`:

```typescript
buildCommand(options: AdapterSendOptions) {
  return {
    command: 'my-tool',
    args: ['{{PROMPT}}'],
    env: { MY_TOOL_API_KEY: process.env.MY_TOOL_API_KEY ?? '' },
  };
}
```

### Option 2: Implement AgentAdapter Directly (for API-based tools)

If your tool uses an HTTP API (like Ollama), implement `AgentAdapter` directly:

```typescript
import type { AgentAdapter, AdapterSendOptions, AdapterResponse } from '@toryo/core';

export class MyApiAdapter implements AgentAdapter {
  name = 'my-api';

  async send(options: AdapterSendOptions): Promise<AdapterResponse> {
    const fullPrompt = options.autonomyPrefix
      ? `${options.autonomyPrefix}\n\n${options.prompt}`
      : options.prompt;

    const start = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeout * 1000);

    try {
      const response = await fetch('https://api.my-tool.com/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: fullPrompt, model: options.model }),
        signal: controller.signal,
      });

      clearTimeout(timer);
      const data = await response.json();

      return {
        output: data.text.trim(),
        durationMs: Date.now() - start,
        infraFailure: false,
      };
    } catch (error) {
      clearTimeout(timer);
      return {
        output: '',
        durationMs: Date.now() - start,
        infraFailure: true,
        error: error.message,
      };
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch('https://api.my-tool.com/health');
      return response.ok;
    } catch {
      return false;
    }
  }
}
```

### Registering Your Adapter

To use your custom adapter with the CLI, add it to the `createAdapter` factory in `packages/adapters/src/index.ts`:

```typescript
case 'my-tool':
  return new MyToolAdapter();
```

Then reference it in `toryo.config.json`:

```json
{
  "adapter": "my-tool"
}
```
