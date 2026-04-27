import { CliAdapter } from './base.js';
import type { AdapterSendOptions } from 'toryo-core';

/**
 * Optional constructor configuration for ClaudeCodeAdapter.
 * All fields are opt-in. Defaults preserve pre-2026-04 behavior.
 */
export interface ClaudeCodeAdapterOptions {
  /**
   * Skip auto-discovery of hooks, skills, plugins, MCP servers, and CLAUDE.md files.
   * Material latency win when spawning many short-lived agents in orchestration.
   */
  bare?: boolean;
  /**
   * Cap dollar spend per task in print mode. Passed as `--max-budget-usd N`.
   */
  maxBudgetUsd?: number;
  /**
   * Cap turns per task in print mode. Passed as `--max-turns N`.
   */
  maxTurns?: number;
  /**
   * Exclude dynamic system prompt sections to improve prompt-cache reuse
   * across distributed workers running the same agent.
   */
  excludeDynamicSystemPromptSections?: boolean;
  /**
   * JSON schema for output validation in print mode. Pass either an object
   * (will be serialized) or a JSON string. Sent as `--json-schema <value>`.
   */
  jsonSchema?: string | object;
  /**
   * Inline subagent definitions. Will be JSON-serialized and passed as `--agents`.
   */
  agents?: object;
  /**
   * Resume an existing session by name. Passed as `-r <name>`.
   */
  sessionName?: string;
}

/**
 * Adapter for Claude Code CLI (claude).
 * Uses --print mode with stdin for non-interactive single-prompt execution.
 * Stdin avoids OS argument length limits on large prompts.
 *
 * Pass an options object to opt into 2026-era flags such as --bare,
 * --max-budget-usd, --max-turns, --json-schema, etc.
 */
export class ClaudeCodeAdapter extends CliAdapter {
  name = 'claude-code';

  constructor(private adapterOptions: ClaudeCodeAdapterOptions = {}) {
    super();
  }

  buildCommand(options: AdapterSendOptions) {
    const args: string[] = [];

    if (this.adapterOptions.sessionName) {
      args.push('-r', this.adapterOptions.sessionName);
    }
    if (this.adapterOptions.bare) {
      args.push('--bare');
    }
    if (this.adapterOptions.excludeDynamicSystemPromptSections) {
      args.push('--exclude-dynamic-system-prompt-sections');
    }
    if (this.adapterOptions.maxBudgetUsd !== undefined) {
      args.push('--max-budget-usd', String(this.adapterOptions.maxBudgetUsd));
    }
    if (this.adapterOptions.maxTurns !== undefined) {
      args.push('--max-turns', String(this.adapterOptions.maxTurns));
    }
    if (this.adapterOptions.jsonSchema !== undefined) {
      const schema = typeof this.adapterOptions.jsonSchema === 'string'
        ? this.adapterOptions.jsonSchema
        : JSON.stringify(this.adapterOptions.jsonSchema);
      args.push('--json-schema', schema);
    }
    if (this.adapterOptions.agents !== undefined) {
      args.push('--agents', JSON.stringify(this.adapterOptions.agents));
    }
    if (options.model) {
      args.push('--model', options.model);
    }
    args.push('--print', '-');

    return { command: 'claude', args, useStdin: true };
  }

  parseOutput(stdout: string): string {
    return stdout.trim();
  }

  async isAvailable(): Promise<boolean> {
    return this.commandExists('claude');
  }
}
