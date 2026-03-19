import { CliAdapter } from './base.js';
import type { AdapterSendOptions } from '@toryo/core';

/**
 * Adapter for Gemini CLI.
 * Uses --prompt for non-interactive execution.
 */
export class GeminiCliAdapter extends CliAdapter {
  name = 'gemini-cli';

  buildCommand(options: AdapterSendOptions) {
    const args = ['--prompt', '{{PROMPT}}'];

    if (options.model) {
      args.unshift('--model', options.model);
    }

    return { command: 'gemini', args };
  }

  parseOutput(stdout: string): string {
    return stdout.trim();
  }

  async isAvailable(): Promise<boolean> {
    return this.commandExists('gemini');
  }
}
