import { CliAdapter } from './base.js';
import type { AdapterSendOptions } from 'toryo-core';

/**
 * Adapter for Codex CLI (codex).
 * Uses `codex exec` with stdin for non-interactive single-prompt execution.
 */
export class CodexAdapter extends CliAdapter {
  name = 'codex';

  buildCommand(options: AdapterSendOptions) {
    const args = ['exec'];

    if (options.model) {
      args.push('--model', options.model);
    }

    args.push('-');

    return { command: 'codex', args, useStdin: true };
  }

  parseOutput(stdout: string): string {
    return stdout.trim();
  }

  async isAvailable(): Promise<boolean> {
    return this.commandExists('codex');
  }
}
