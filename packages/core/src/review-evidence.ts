import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import type {RequiredCheck, ReviewEvidence} from './types.js';

const exec = promisify(execFile);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/** Capture evidence ourselves, never from worker claims. Commands come from trusted config. */
export async function captureReviewEvidence(cwd: string, base: string | null, output: string,
  checks: RequiredCheck[]): Promise<ReviewEvidence> {
  checks = structuredClone(checks);
  let head: string | null = null;
  let diff = output;
  if (base !== null) {
    head = (await exec('git', ['rev-parse', 'HEAD'], {cwd})).stdout.trim();
    diff = (await exec('git', ['diff', '--no-ext-diff', '--no-textconv', '--binary', base, head, '--'],
      {cwd, maxBuffer: 1024 * 1024, timeout: 30000})).stdout;
  }
  const patch = {id: `patch:${digest(JSON.stringify({base,head,diff}))}`, base, head, diff};
  const results: ReviewEvidence['checks'] = [];
  for (const check of checks) {
    const args = [...(check.args ?? [])];
    let exitCode: number | null = null, stdout = '', stderr = '', error: string | undefined;
    try {
      const result = await exec(check.command, args,
        {cwd, timeout: check.timeoutMs ?? 60000, maxBuffer: 256 * 1024, killSignal: 'SIGKILL'});
      stdout = result.stdout; stderr = result.stderr; exitCode = 0;
    } catch (cause) {
      const failure = cause as Error & {code?: number | string; stdout?: string; stderr?: string; killed?: boolean};
      stdout = String(failure.stdout ?? ''); stderr = String(failure.stderr ?? '');
      exitCode = typeof failure.code === 'number' ? failure.code : null;
      error = failure.killed ? 'Required check timed out or exceeded its output limit' :
        `Required check failed (${typeof failure.code === 'string' ? failure.code : exitCode ?? 'unknown error'})`;
    }
    const result = {command: check.command, args, exitCode, stdout, stderr, ...(error ? {error} : {})};
    results.push({id: `check:${check.id}:${digest(JSON.stringify(result))}`, ...result});
  }
  return {patch, checks: results};
}
