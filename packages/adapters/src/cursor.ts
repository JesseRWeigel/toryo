import { CliAdapter } from './base.js';
import type { AdapterSendOptions } from 'toryo-core';

/**
 * Adapter for Cursor agent CLI.
 * Uses --print (-p) mode with --force for non-interactive autonomous orchestration.
 * Requires the CURSOR_API_KEY environment variable for authentication.
 */
export class CursorAdapter extends CliAdapter {
  name = 'cursor';

  buildCommand(options: AdapterSendOptions) {
    const args = ['-p', '--force', '--output-format', 'text', '{{PROMPT}}'];

    if (options.model) {
      args.unshift('--model', options.model);
    }

    return { command: 'agent', args };
  }

  parseOutput(stdout: string): string {
    return stdout.trim();
  }

  async isAvailable(): Promise<boolean> {
    return this.commandExists('agent');
  }
}
