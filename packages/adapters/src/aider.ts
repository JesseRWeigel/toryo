import { CliAdapter } from './base.js';
import type { AdapterSendOptions } from '@toryo/core';

/**
 * Adapter for Aider CLI.
 * Uses --message for non-interactive single-prompt execution.
 */
export class AiderAdapter extends CliAdapter {
  name = 'aider';

  buildCommand(options: AdapterSendOptions) {
    const args = [
      '--no-auto-commits',
      '--yes',
      '--message', '{{PROMPT}}',
    ];

    if (options.model) {
      args.unshift('--model', options.model);
    }

    return { command: 'aider', args };
  }

  parseOutput(stdout: string): string {
    return stdout.trim();
  }

  async isAvailable(): Promise<boolean> {
    return this.commandExists('aider');
  }
}
