import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentAdapter, AdapterSendOptions, AdapterResponse } from 'toryo-core';

const execFileAsync = promisify(execFile);

/**
 * Base class for CLI-based adapters. Subclasses provide the command + args.
 */
export abstract class CliAdapter implements AgentAdapter {
  abstract name: string;

  abstract buildCommand(options: AdapterSendOptions): {
    command: string;
    args: string[];
    env?: Record<string, string>;
  };

  abstract parseOutput(stdout: string, stderr: string): string;

  abstract isAvailable(): Promise<boolean>;

  async send(options: AdapterSendOptions): Promise<AdapterResponse> {
    const { command, args, env } = this.buildCommand(options);
    const fullPrompt = options.autonomyPrefix
      ? `${options.autonomyPrefix}\n\n${options.prompt}`
      : options.prompt;

    // Replace prompt placeholder in args
    const resolvedArgs = args.map((a) =>
      a === '{{PROMPT}}' ? fullPrompt : a,
    );

    const start = Date.now();

    try {
      const { stdout, stderr } = await execFileAsync(command, resolvedArgs, {
        cwd: options.cwd,
        timeout: options.timeout * 1000,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        env: { ...process.env, ...env },
      });

      return {
        output: this.parseOutput(stdout, stderr),
        durationMs: Date.now() - start,
        infraFailure: false,
      };
    } catch (error) {
      const err = error as Error & { stdout?: string; stderr?: string; killed?: boolean };
      return {
        output: err.stdout ?? '',
        durationMs: Date.now() - start,
        infraFailure: true,
        error: err.killed ? 'Timeout exceeded' : err.message,
      };
    }
  }

  protected async commandExists(cmd: string): Promise<boolean> {
    try {
      await execFileAsync('which', [cmd]);
      return true;
    } catch {
      return false;
    }
  }
}
