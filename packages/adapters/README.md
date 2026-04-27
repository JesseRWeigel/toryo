# toryo-adapters

Agent adapters for [Toryo](https://github.com/JesseRWeigel/toryo) — Claude Code, Aider, Gemini CLI, Ollama, Codex, and more.

Each adapter wraps a CLI tool or API behind a common interface so the Toryo orchestrator can delegate tasks to any supported agent.

## Installation

```bash
npm install toryo-adapters
```

## Usage

```ts
import { createAdapter, ClaudeCodeAdapter, OllamaAdapter } from 'toryo-adapters';

// Factory function
const adapter = createAdapter('ollama');

// Or instantiate directly
const claude = new ClaudeCodeAdapter();
const ollama = new OllamaAdapter('http://localhost:11434');
```

## Supported Adapters

| Adapter | Tool | Method |
|---------|------|--------|
| `claude-code` | Claude Code | `claude --print` |
| `aider` | Aider | `aider --message` |
| `gemini-cli` | Gemini CLI | `gemini --prompt` |
| `codex` | Codex CLI | `codex exec` |
| `ollama` | Ollama | Direct HTTP API |
| `custom` | Any CLI | Configurable command + args |

See the [main Toryo README](https://github.com/JesseRWeigel/toryo#readme) for full documentation.

## License

MIT
