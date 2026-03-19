import { CliAdapter } from './base.js';
import type { AdapterSendOptions } from '@toryo/core';

/**
 * Adapter for Codex CLI (codex).
 * Uses --prompt mode for non-interactive single-prompt execution.
 */
export class CodexAdapter extends CliAdapter {
  name = 'codex';

  buildCommand(options: AdapterSendOptions) {
    const args = ['--prompt', '{{PROMPT}}'];

    if (options.model) {
      args.unshift('--model', options.model);
    }

    return { command: 'codex', args };
  }

  parseOutput(stdout: string): string {
    return stdout.trim();
  }

  async isAvailable(): Promise<boolean> {
    return this.commandExists('codex');
  }
}
