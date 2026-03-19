export { CliAdapter } from './base.js';
export { ClaudeCodeAdapter } from './claude-code.js';
export { CodexAdapter } from './codex.js';
export { AiderAdapter } from './aider.js';
export { GeminiCliAdapter } from './gemini-cli.js';
export { OllamaAdapter } from './ollama.js';
export { CustomAdapter } from './custom.js';

import type { AgentAdapter } from '@toryo/core';
import { ClaudeCodeAdapter } from './claude-code.js';
import { CodexAdapter } from './codex.js';
import { AiderAdapter } from './aider.js';
import { GeminiCliAdapter } from './gemini-cli.js';
import { OllamaAdapter } from './ollama.js';

/** Create an adapter by name */
export function createAdapter(name: string, options?: Record<string, unknown>): AgentAdapter {
  switch (name) {
    case 'claude-code':
      return new ClaudeCodeAdapter();
    case 'codex':
      return new CodexAdapter();
    case 'aider':
      return new AiderAdapter();
    case 'gemini-cli':
      return new GeminiCliAdapter();
    case 'ollama':
      return new OllamaAdapter(options?.baseUrl as string | undefined);
    default:
      throw new Error(`Unknown adapter: ${name}. Use CustomAdapter for custom CLI tools.`);
  }
}
