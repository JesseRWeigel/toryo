import { describe, it, expect } from 'vitest';
import { validateConfig } from '../config.js';

const VALID_CONFIG = {
  agents: {
    coder: {
      adapter: 'ollama',
      model: 'qwen3.5:27b',
      strengths: ['code', 'testing'],
      timeout: 900,
    },
  },
  tasks: './specs/',
};

describe('validateConfig', () => {
  it('accepts a minimal valid config', () => {
    const result = validateConfig(VALID_CONFIG);
    expect(result.success).toBe(true);
    expect(result.config).toBeDefined();
  });

  it('fills in defaults for optional fields', () => {
    const result = validateConfig(VALID_CONFIG);
    expect(result.config!.outputDir).toBe('.toryo');
    expect(result.config!.ratchet.threshold).toBe(6.0);
    expect(result.config!.ratchet.maxRetries).toBe(1);
    expect(result.config!.ratchet.gitStrategy).toBe('commit-revert');
    expect(result.config!.delegation.initialTrust).toBe(0.5);
    expect(result.config!.delegation.scoreWindow).toBe(50);
  });

  it('rejects empty agents', () => {
    const result = validateConfig({ agents: {}, tasks: './specs/' });
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.some((e) => e.includes('agent'))).toBe(true);
  });

  it('rejects missing agents field', () => {
    const result = validateConfig({ tasks: './specs/' });
    expect(result.success).toBe(false);
  });

  it('rejects missing tasks field', () => {
    const result = validateConfig({
      agents: { a: { adapter: 'ollama', strengths: ['code'], timeout: 60 } },
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown adapter', () => {
    const result = validateConfig({
      agents: { a: { adapter: 'nonexistent', strengths: ['code'], timeout: 60 } },
      tasks: './specs/',
    });
    expect(result.success).toBe(false);
    expect(result.errors!.some((e) => e.includes('nonexistent'))).toBe(true);
  });

  it('accepts all known adapters', () => {
    for (const adapter of ['claude-code', 'aider', 'gemini-cli', 'codex', 'cursor', 'cline', 'ollama', 'custom']) {
      const result = validateConfig({
        agents: { a: { adapter, strengths: ['code'], timeout: 60 } },
        tasks: './specs/',
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects empty strengths array', () => {
    const result = validateConfig({
      agents: { a: { adapter: 'ollama', strengths: [], timeout: 60 } },
      tasks: './specs/',
    });
    expect(result.success).toBe(false);
    expect(result.errors!.some((e) => e.includes('strength'))).toBe(true);
  });

  it('rejects negative timeout', () => {
    const result = validateConfig({
      agents: { a: { adapter: 'ollama', strengths: ['code'], timeout: -1 } },
      tasks: './specs/',
    });
    expect(result.success).toBe(false);
  });

  it('rejects ratchet threshold outside 0-10', () => {
    const result = validateConfig({
      ...VALID_CONFIG,
      ratchet: { threshold: 15 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid git strategy', () => {
    const result = validateConfig({
      ...VALID_CONFIG,
      ratchet: { gitStrategy: 'invalid' },
    });
    expect(result.success).toBe(false);
  });

  it('accepts inline task array', () => {
    const result = validateConfig({
      ...VALID_CONFIG,
      tasks: [{ id: 'test', name: 'test', description: 'test' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown notification provider', () => {
    const result = validateConfig({
      ...VALID_CONFIG,
      notifications: { provider: 'carrier-pigeon', target: '', events: [] },
    });
    expect(result.success).toBe(false);
    expect(result.errors!.some((e) => e.includes('carrier-pigeon'))).toBe(true);
  });

  it('provides multiple error messages for multiple issues', () => {
    const result = validateConfig({});
    expect(result.success).toBe(false);
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it('accepts non-string input gracefully', () => {
    const result = validateConfig(null);
    expect(result.success).toBe(false);
  });

  it('defaults timeout when not provided', () => {
    const result = validateConfig({
      agents: { a: { adapter: 'ollama', strengths: ['code'] } },
      tasks: './specs/',
    });
    expect(result.success).toBe(true);
    expect(result.config!.agents.a.timeout).toBe(900);
  });
});
