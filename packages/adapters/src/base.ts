import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentAdapter, AdapterSendOptions, AdapterResponse } from 'toryo-core';

const execFileAsync = promisify(execFile);

/**
 * Base class for CLI-based adapters. Subclasses provide the command + args.
 *
 * Prompts are passed via stdin by default to avoid OS argument length limits.
 * Use {{PROMPT}} in args if the CLI tool requires the prompt as an argument
 * instead of stdin (not recommended for large prompts).
 */
export abstract class CliAdapter implements AgentAdapter {
  abstract name: string;

  abstract buildCommand(options: AdapterSendOptions): {
    command: string;
    args: string[];
    env?: Record<string, string>;
    /** If true, pipe prompt via stdin instead of {{PROMPT}} arg */
    useStdin?: boolean;
  };

  abstract parseOutput(stdout: string, stderr: string): string;

  abstract isAvailable(): Promise<boolean>;

  async send(options: AdapterSendOptions): Promise<AdapterResponse> {
    const { command, args, env, useStdin } = this.buildCommand(options);
    const fullPrompt = options.autonomyPrefix
      ? `${options.autonomyPrefix}\n\n${options.prompt}`
      : options.prompt;

    // Replace prompt placeholder in args (for tools that need it as an arg)
    const resolvedArgs = args.map((a) =>
      a === '{{PROMPT}}' ? fullPrompt : a,
    );

    const start = Date.now();

    if (useStdin) {
      return this.sendViaStdin(command, resolvedArgs, fullPrompt, options, env, start);
    }

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

  /** Spawn a process and pipe the prompt via stdin */
  private sendViaStdin(
    command: string,
    args: string[],
    prompt: string,
    options: AdapterSendOptions,
    env?: Record<string, string>,
    start = Date.now(),
  ): Promise<AdapterResponse> {
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: { ...process.env, ...env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let killed = false;

      const timer = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
      }, options.timeout * 1000);

      child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (killed) {
          resolve({
            output: stdout,
            durationMs: Date.now() - start,
            infraFailure: true,
            error: 'Timeout exceeded',
          });
        } else if (code !== 0 && !stdout) {
          resolve({
            output: '',
            durationMs: Date.now() - start,
            infraFailure: true,
            error: stderr || `Process exited with code ${code}`,
          });
        } else {
          resolve({
            output: this.parseOutput(stdout, stderr),
            durationMs: Date.now() - start,
            infraFailure: false,
          });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          output: '',
          durationMs: Date.now() - start,
          infraFailure: true,
          error: err.message,
        });
      });

      // Write prompt to stdin and close
      child.stdin.write(prompt);
      child.stdin.end();
    });
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
