import { CliAdapter } from './base.js';
import type { AdapterSendOptions } from 'toryo-core';

/**
 * Adapter for Claude Code CLI (claude).
 * Uses --print mode with stdin for non-interactive single-prompt execution.
 * Stdin avoids OS argument length limits on large prompts.
 */
export class ClaudeCodeAdapter extends CliAdapter {
  name = 'claude-code';

  buildCommand(options: AdapterSendOptions) {
    const args = ['--print', '-'];

    if (options.model) {
      args.unshift('--model', options.model);
    }

    return { command: 'claude', args, useStdin: true };
  }

  parseOutput(stdout: string): string {
    return stdout.trim();
  }

  async isAvailable(): Promise<boolean> {
    return this.commandExists('claude');
  }
}
