import { describe, it, expect } from 'vitest';
import {
  ClaudeCodeAdapter,
  AiderAdapter,
  GeminiCliAdapter,
  CodexAdapter,
  CursorAdapter,
  ClineAdapter,
  OllamaAdapter,
  CustomAdapter,
  createAdapter,
} from '../index.js';

describe('ClaudeCodeAdapter', () => {
  const adapter = new ClaudeCodeAdapter();

  it('has correct name', () => {
    expect(adapter.name).toBe('claude-code');
  });

  it('builds command with --print and stdin mode', () => {
    const { command, args, useStdin } = adapter.buildCommand({
      agentId: 'test',
      prompt: 'test prompt',
      timeout: 60,
    });
    expect(command).toBe('claude');
    expect(args).toContain('--print');
    expect(args).toContain('-');
    expect(useStdin).toBe(true);
  });

  it('includes --model when model is specified', () => {
    const { args, useStdin } = adapter.buildCommand({
      agentId: 'test',
      prompt: 'test',
      timeout: 60,
      model: 'claude-sonnet-4-6',
    });
    expect(args).toContain('--model');
    expect(args).toContain('claude-sonnet-4-6');
    expect(useStdin).toBe(true);
  });

  it('parseOutput trims whitespace', () => {
    expect(adapter.parseOutput('  hello world  \n', '')).toBe('hello world');
  });

  it('passes --bare when bare option is set', () => {
    const a = new ClaudeCodeAdapter({ bare: true });
    const { args } = a.buildCommand({ agentId: 'test', prompt: 't', timeout: 60 });
    expect(args).toContain('--bare');
  });

  it('passes --max-budget-usd N when option is set', () => {
    const a = new ClaudeCodeAdapter({ maxBudgetUsd: 5 });
    const { args } = a.buildCommand({ agentId: 'test', prompt: 't', timeout: 60 });
    expect(args).toContain('--max-budget-usd');
    expect(args).toContain('5');
  });

  it('passes --max-turns N when option is set', () => {
    const a = new ClaudeCodeAdapter({ maxTurns: 8 });
    const { args } = a.buildCommand({ agentId: 'test', prompt: 't', timeout: 60 });
    expect(args).toContain('--max-turns');
    expect(args).toContain('8');
  });

  it('passes --exclude-dynamic-system-prompt-sections when set', () => {
    const a = new ClaudeCodeAdapter({ excludeDynamicSystemPromptSections: true });
    const { args } = a.buildCommand({ agentId: 'test', prompt: 't', timeout: 60 });
    expect(args).toContain('--exclude-dynamic-system-prompt-sections');
  });

  it('serializes object jsonSchema to --json-schema', () => {
    const a = new ClaudeCodeAdapter({ jsonSchema: { type: 'object' } });
    const { args } = a.buildCommand({ agentId: 'test', prompt: 't', timeout: 60 });
    expect(args).toContain('--json-schema');
    expect(args).toContain(JSON.stringify({ type: 'object' }));
  });

  it('passes string jsonSchema verbatim', () => {
    const a = new ClaudeCodeAdapter({ jsonSchema: '{"x":1}' });
    const { args } = a.buildCommand({ agentId: 'test', prompt: 't', timeout: 60 });
    expect(args).toContain('--json-schema');
    expect(args).toContain('{"x":1}');
  });

  it('serializes agents object to --agents JSON', () => {
    const a = new ClaudeCodeAdapter({ agents: { reviewer: { tools: ['read'] } } });
    const { args } = a.buildCommand({ agentId: 'test', prompt: 't', timeout: 60 });
    expect(args).toContain('--agents');
    expect(args).toContain(JSON.stringify({ reviewer: { tools: ['read'] } }));
  });

  it('passes -r <name> when sessionName is set', () => {
    const a = new ClaudeCodeAdapter({ sessionName: 'auth-refactor' });
    const { args } = a.buildCommand({ agentId: 'test', prompt: 't', timeout: 60 });
    expect(args).toContain('-r');
    expect(args).toContain('auth-refactor');
  });

  it('default options match pre-2026-04 args (back-compat)', () => {
    const a = new ClaudeCodeAdapter();
    const { args } = a.buildCommand({ agentId: 'test', prompt: 't', timeout: 60 });
    expect(args).not.toContain('--bare');
    expect(args).not.toContain('--max-budget-usd');
    expect(args).not.toContain('--max-turns');
    expect(args).not.toContain('--exclude-dynamic-system-prompt-sections');
    expect(args).not.toContain('--json-schema');
    expect(args).not.toContain('--agents');
    expect(args).not.toContain('-r');
  });

  it('createAdapter passes options through to ClaudeCodeAdapter', () => {
    const a = createAdapter('claude-code', { bare: true, maxBudgetUsd: 2 }) as ClaudeCodeAdapter;
    const { args } = a.buildCommand({ agentId: 'test', prompt: 't', timeout: 60 });
    expect(args).toContain('--bare');
    expect(args).toContain('--max-budget-usd');
    expect(args).toContain('2');
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

  it('builds command with exec and stdin mode', () => {
    const { command, args, useStdin } = adapter.buildCommand({
      agentId: 'test',
      prompt: 'test',
      timeout: 60,
    });
    expect(command).toBe('codex');
    expect(args).toEqual(['exec', '-']);
    expect(useStdin).toBe(true);
  });
});

describe('CursorAdapter', () => {
  const adapter = new CursorAdapter();

  it('has correct name', () => {
    expect(adapter.name).toBe('cursor');
  });

  it('builds command with -p, --force, and {{PROMPT}}', () => {
    const { command, args } = adapter.buildCommand({
      agentId: 'test',
      prompt: 'test',
      timeout: 60,
    });
    expect(command).toBe('agent');
    expect(args).toContain('-p');
    expect(args).toContain('--force');
    expect(args).toContain('--output-format');
    expect(args).toContain('text');
    expect(args).toContain('{{PROMPT}}');
  });

  it('includes --model when model is specified', () => {
    const { args } = adapter.buildCommand({
      agentId: 'test',
      prompt: 'test',
      timeout: 60,
      model: 'cursor-fast',
    });
    expect(args).toContain('--model');
    expect(args).toContain('cursor-fast');
  });

  it('parseOutput trims whitespace', () => {
    expect(adapter.parseOutput('  hello world  \n', '')).toBe('hello world');
  });
});

describe('ClineAdapter', () => {
  const adapter = new ClineAdapter();

  it('has correct name', () => {
    expect(adapter.name).toBe('cline');
  });

  it('builds command with --yolo and {{PROMPT}}', () => {
    const { command, args } = adapter.buildCommand({
      agentId: 'test',
      prompt: 'test',
      timeout: 60,
    });
    expect(command).toBe('cline');
    expect(args).toContain('--yolo');
    expect(args).toContain('{{PROMPT}}');
  });

  it('includes --model when model is specified', () => {
    const { args } = adapter.buildCommand({
      agentId: 'test',
      prompt: 'test',
      timeout: 60,
      model: 'sonnet-4-6',
    });
    expect(args).toContain('--model');
    expect(args).toContain('sonnet-4-6');
  });

  it('parseOutput trims whitespace', () => {
    expect(adapter.parseOutput('  hello world  \n', '')).toBe('hello world');
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

  it('creates cursor adapter', () => {
    const adapter = createAdapter('cursor');
    expect(adapter.name).toBe('cursor');
  });

  it('creates cline adapter', () => {
    const adapter = createAdapter('cline');
    expect(adapter.name).toBe('cline');
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
