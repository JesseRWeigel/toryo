import { CliAdapter } from './base.js';
import type { AdapterSendOptions } from 'toryo-core';

/**
 * Generic adapter for any CLI command.
 * The prompt is passed via stdin or as a CLI argument.
 */
export class CustomAdapter extends CliAdapter {
  name: string;

  private command: string;
  private argTemplate: string[];

  constructor(options: {
    name: string;
    command: string;
    /** Args template. Use {{PROMPT}} where the prompt should be inserted. */
    args: string[];
  }) {
    super();
    this.name = options.name;
    this.command = options.command;
    this.argTemplate = options.args;
  }

  buildCommand(_options: AdapterSendOptions) {
    return {
      command: this.command,
      args: [...this.argTemplate],
    };
  }

  parseOutput(stdout: string): string {
    return stdout.trim();
  }

  async isAvailable(): Promise<boolean> {
    return this.commandExists(this.command);
  }
}
