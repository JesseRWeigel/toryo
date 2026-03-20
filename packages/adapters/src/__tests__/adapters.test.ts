import { describe, it, expect } from 'vitest';
import {
  ClaudeCodeAdapter,
  AiderAdapter,
  GeminiCliAdapter,
  CodexAdapter,
  OllamaAdapter,
  CustomAdapter,
  createAdapter,
} from '../index.js';

describe('ClaudeCodeAdapter', () => {
  const adapter = new ClaudeCodeAdapter();

  it('has correct name', () => {
    expect(adapter.name).toBe('claude-code');
  });

  it('builds command with --print and prompt placeholder', () => {
    const { command, args } = adapter.buildCommand({
      agentId: 'test',
      prompt: 'test prompt',
      timeout: 60,
    });
    expect(command).toBe('claude');
    expect(args).toContain('--print');
    expect(args).toContain('{{PROMPT}}');
  });

  it('includes --model when model is specified', () => {
    const { args } = adapter.buildCommand({
      agentId: 'test',
      prompt: 'test',
      timeout: 60,
      model: 'claude-sonnet-4-6',
    });
    expect(args).toContain('--model');
    expect(args).toContain('claude-sonnet-4-6');
  });

  it('parseOutput trims whitespace', () => {
    expect(adapter.parseOutput('  hello world  \n', '')).toBe('hello world');
  });
});

describe('AiderAdapter', () => {
  const adapter = new AiderAdapter();

  it('has correct name', () => {
    expect(adapter.name).toBe('aider');
  });

  it('builds command with --message and --no-auto-commits', () => {
    const { command, args } = adapter.buildCommand({
      agentId: 'test',
      prompt: 'test',
      timeout: 60,
    });
    expect(command).toBe('aider');
    expect(args).toContain('--no-auto-commits');
    expect(args).toContain('--yes');
    expect(args).toContain('--message');
    expect(args).toContain('{{PROMPT}}');
  });
});

describe('GeminiCliAdapter', () => {
  const adapter = new GeminiCliAdapter();

  it('has correct name', () => {
    expect(adapter.name).toBe('gemini-cli');
  });

  it('builds command with --prompt', () => {
    const { command, args } = adapter.buildCommand({
      agentId: 'test',
      prompt: 'test',
      timeout: 60,
    });
    expect(command).toBe('gemini');
    expect(args).toContain('--prompt');
    expect(args).toContain('{{PROMPT}}');
  });
});

describe('CodexAdapter', () => {
  const adapter = new CodexAdapter();

  it('has correct name', () => {
    expect(adapter.name).toBe('codex');
  });

  it('builds command with --prompt', () => {
    const { command, args } = adapter.buildCommand({
      agentId: 'test',
      prompt: 'test',
      timeout: 60,
    });
    expect(command).toBe('codex');
    expect(args).toContain('--prompt');
  });
});

describe('OllamaAdapter', () => {
  it('has correct name', () => {
    const adapter = new OllamaAdapter();
    expect(adapter.name).toBe('ollama');
  });

  it('uses default base URL', () => {
    const adapter = new OllamaAdapter();
    // Can't directly inspect private field, but isAvailable will use it
    expect(adapter.name).toBe('ollama');
  });

  it('accepts custom base URL', () => {
    const adapter = new OllamaAdapter('http://custom:1234');
    expect(adapter.name).toBe('ollama');
  });
});

describe('CustomAdapter', () => {
  it('uses provided name and command', () => {
    const adapter = new CustomAdapter({
      name: 'my-tool',
      command: 'my-cli',
      args: ['run', '{{PROMPT}}'],
    });
    expect(adapter.name).toBe('my-tool');

    const { command, args } = adapter.buildCommand({
      agentId: 'test',
      prompt: 'test',
      timeout: 60,
    });
    expect(command).toBe('my-cli');
    expect(args).toContain('run');
    expect(args).toContain('{{PROMPT}}');
  });
});

describe('createAdapter', () => {
  it('creates claude-code adapter', () => {
    const adapter = createAdapter('claude-code');
    expect(adapter.name).toBe('claude-code');
  });

  it('creates aider adapter', () => {
    const adapter = createAdapter('aider');
    expect(adapter.name).toBe('aider');
  });

  it('creates gemini-cli adapter', () => {
    const adapter = createAdapter('gemini-cli');
    expect(adapter.name).toBe('gemini-cli');
  });

  it('creates codex adapter', () => {
    const adapter = createAdapter('codex');
    expect(adapter.name).toBe('codex');
  });

  it('creates ollama adapter', () => {
    const adapter = createAdapter('ollama');
    expect(adapter.name).toBe('ollama');
  });

  it('creates ollama adapter with custom baseUrl', () => {
    const adapter = createAdapter('ollama', { baseUrl: 'http://custom:1234' });
    expect(adapter.name).toBe('ollama');
  });

  it('throws for unknown adapter', () => {
    expect(() => createAdapter('nonexistent')).toThrow('Unknown adapter');
  });
});
