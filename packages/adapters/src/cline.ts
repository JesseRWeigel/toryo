import { CliAdapter } from './base.js';
import type { AdapterSendOptions } from 'toryo-core';

/**
 * Adapter for Cline CLI 2.0 (cline).
 * Uses --yolo for auto-approval in non-interactive orchestrator usage.
 */
export class ClineAdapter extends CliAdapter {
  name = 'cline';

  buildCommand(options: AdapterSendOptions) {
    const args = ['--yolo', '{{PROMPT}}'];

    if (options.model) {
      args.unshift('--model', options.model);
    }

    return { command: 'cline', args };
  }

  parseOutput(stdout: string): string {
    return stdout.trim();
  }

  async isAvailable(): Promise<boolean> {
    return this.commandExists('cline');
  }
}
