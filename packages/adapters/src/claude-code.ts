import { CliAdapter } from './base.js';
import type { AdapterSendOptions } from 'toryo-core';

/**
 * Adapter for Claude Code CLI (claude).
 * Uses --print mode for non-interactive single-prompt execution.
 */
export class ClaudeCodeAdapter extends CliAdapter {
  name = 'claude-code';

  buildCommand(options: AdapterSendOptions) {
    const args = ['--print', '{{PROMPT}}'];

    if (options.model) {
      args.unshift('--model', options.model);
    }

    return { command: 'claude', args };
  }

  parseOutput(stdout: string): string {
    return stdout.trim();
  }

  async isAvailable(): Promise<boolean> {
    return this.commandExists('claude');
  }
}
