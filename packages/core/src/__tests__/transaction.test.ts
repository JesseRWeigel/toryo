import { structuredReview } from './review-fixture.js';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createOrchestrator } from '../orchestrator.js';
import { createRatchet } from '../ratchet.js';
import type { ToryoConfig, AgentAdapter, TaskSpec } from '../types.js';

const exec = promisify(execFile);
let dir: string;
async function git(...args: string[]) {
  return (await exec('git', args, { cwd: dir })).stdout.trim();
}
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'toryo-transaction-'));
  await git('init', '-b', 'main');
  await git('config', 'user.name', 'Fixture');
  await git('config', 'user.email', 'fixture@example.invalid');
  await writeFile(join(dir, '.gitignore'), '.custom-output/\n');
  await writeFile(join(dir, 'source.txt'), 'original');
  await git('add', '.');
  await git('commit', '-m', 'user starting point');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
const task: TaskSpec = {
  id: 'edit',
  name: 'Edit',
  description: 'Edit source',
  acceptanceCriteria: ['works'],
  phases: [
    { phase: 'execute', agent: 'worker' },
    { phase: 'review', agent: 'reviewer' },
  ],
};
async function setup(
  scores: number[],
  edit: (call: number) => Promise<void>,
  strategy: 'commit-revert' | 'branch-per-task' = 'commit-revert',
  retries = 0,
  requiredChecks: NonNullable<ToryoConfig['ratchet']['requiredChecks']> = [],
) {
  let workCalls = 0,
    reviewCalls = 0;
  const worker: AgentAdapter = {
    name: 'worker',
    isAvailable: async () => true,
    send: async () => {
      await edit(++workCalls);
      return { output: 'Edited source', durationMs: 1, infraFailure: false };
    },
  };
  const reviewer: AgentAdapter = {
    name: 'reviewer',
    isAvailable: async () => true,
    send: async (options) => ({
      output: structuredReview(options.prompt, scores[reviewCalls++] ?? 2),
      durationMs: 1,
      infraFailure: false,
    }),
  };
  const config: ToryoConfig = {
    agents: {
      worker: { adapter: 'worker', strengths: ['code'], timeout: 30 },
      reviewer: { adapter: 'reviewer', strengths: ['review'], timeout: 30 },
    },
    tasks: [],
    phases: ['execute', 'review'],
    outputDir: join(dir, '.custom-output'),
    ratchet: { threshold: 6, maxRetries: retries, gitStrategy: strategy, requiredChecks },
    delegation: {
      initialTrust: 0.5,
      scoreWindow: 50,
      levels: {
        supervised: { trustRange: [0, 0.6] },
        guided: { trustRange: [0.6, 0.8] },
        autonomous: { trustRange: [0.8, 1] },
      },
    },
  };
  const orchestrator = await createOrchestrator({
    config,
    adapters: { worker, reviewer },
    cwd: dir,
  });
  return { orchestrator, calls: () => ({ workCalls, reviewCalls }) };
}
describe('real source checkpoint boundaries', () => {
  for (const strategy of ['commit-revert', 'branch-per-task'] as const) {
    it(`preserves accepted source when a later ${strategy} cycle is rejected`, async () => {
      const initial = await git('rev-parse', 'HEAD');
      const { orchestrator } = await setup(
        [8, 2],
        async (n) => writeFile(join(dir, 'source.txt'), n === 1 ? 'accepted' : 'rejected'),
        strategy,
      );
      const result = await orchestrator.runCycle(1, task);
      expect(result.reviews?.[0].evidence?.patch.base).toBe(initial);
      expect(result.reviews?.[0].evidence?.patch.diff).toContain('+accepted');
      const accepted = await git('rev-parse', 'HEAD');
      expect(await git('show', 'HEAD:source.txt')).toBe('accepted');
      await orchestrator.runCycle(2, task);
      expect(await readFile(join(dir, 'source.txt'), 'utf8')).toBe('accepted');
      await git('merge-base', '--is-ancestor', initial, 'HEAD');
      await git('merge-base', '--is-ancestor', accepted, 'HEAD');
      expect(await git('status', '--porcelain')).toBe('');
    });
  }
  it('stops before agents when staged, unstaged and untracked user edits exist', async () => {
    await writeFile(join(dir, 'source.txt'), 'staged');
    await git('add', 'source.txt');
    await writeFile(join(dir, 'source.txt'), 'unstaged');
    await writeFile(join(dir, 'user-note.txt'), 'keep me');
    const status = await git('status', '--porcelain');
    const head = await git('rev-parse', 'HEAD');
    const { orchestrator, calls } = await setup([2], async () =>
      writeFile(join(dir, 'source.txt'), 'agent'),
    );
    await expect(orchestrator.runCycle(1, task)).rejects.toThrow(/clean|dirty|uncommitted/i);
    expect(calls().workCalls).toBe(0);
    expect(await git('status', '--porcelain')).toBe(status);
    expect(await git('rev-parse', 'HEAD')).toBe(head);
    expect(await git('show', ':source.txt')).toBe('staged');
    expect(await readFile(join(dir, 'source.txt'), 'utf8')).toBe('unstaged');
    expect(await readFile(join(dir, 'user-note.txt'), 'utf8')).toBe('keep me');
  });
  it('stops before QA on commit hook failure and preserves source and HEAD', async () => {
    const hook = join(dir, '.git/hooks/pre-commit');
    await writeFile(hook, '#!/bin/sh\nexit 1\n');
    await chmod(hook, 0o755);
    const head = await git('rev-parse', 'HEAD');
    const { orchestrator, calls } = await setup(
      [2],
      async () => writeFile(join(dir, 'source.txt'), 'candidate'),
      'commit-revert',
      1,
    );
    await expect(orchestrator.runCycle(1, task)).rejects.toThrow(/checkpoint|commit/i);
    expect(calls()).toEqual({ workCalls: 1, reviewCalls: 0 });
    expect(await git('rev-parse', 'HEAD')).toBe(head);
    expect(await readFile(join(dir, 'source.txt'), 'utf8')).toBe('candidate');
  });
  it('a no-change rejected attempt never undoes the pre-existing user commit', async () => {
    await writeFile(join(dir, 'second-user-file.txt'), 'keep');
    await git('add', '.');
    await git('commit', '-m', 'second user commit');
    const head = await git('rev-parse', 'HEAD');
    const { orchestrator } = await setup([2], async () => {});
    await orchestrator.runCycle(1, task);
    expect(await git('rev-parse', 'HEAD')).toBe(head);
    expect(await readFile(join(dir, 'source.txt'), 'utf8')).toBe('original');
  });
  it('checkpoints retry source and preserves it after the next rejected cycle', async () => {
    const { orchestrator } = await setup(
      [2, 8, 2, 2],
      async (n) =>
        writeFile(join(dir, 'source.txt'), n === 2 ? 'accepted retry' : `candidate ${n}`),
      'commit-revert',
      1,
    );
    await orchestrator.runCycle(1, task);
    expect(await git('show', 'HEAD:source.txt')).toBe('accepted retry');
    await orchestrator.runCycle(2, task);
    expect(await readFile(join(dir, 'source.txt'), 'utf8')).toBe('accepted retry');
  });
  it('refuses rollback when no checkpoint was created by this ratchet', async () => {
    await writeFile(join(dir, 'user.txt'), 'valuable');
    await git('add', '.');
    await git('commit', '-m', 'user work');
    const head = await git('rev-parse', 'HEAD');
    const r = createRatchet({}, dir);
    expect(await r.revert()).toBe(false);
    expect(await git('rev-parse', 'HEAD')).toBe(head);
  });
  it('preserves edits arriving after a checkpoint instead of hard resetting them', async () => {
    const r = createRatchet({}, dir);
    await r.beginAttempt();
    await writeFile(join(dir, 'source.txt'), 'checkpoint');
    await r.commit('candidate');
    const head = await git('rev-parse', 'HEAD');
    await writeFile(join(dir, 'source.txt'), 'later user edit');
    expect(await r.revert()).toBe(false);
    expect(await git('rev-parse', 'HEAD')).toBe(head);
    expect(await readFile(join(dir, 'source.txt'), 'utf8')).toBe('later user edit');
  });
  it('refuses rollback after an unrelated commit advances HEAD', async () => {
    const r = createRatchet({}, dir);
    await r.beginAttempt();
    await writeFile(join(dir, 'source.txt'), 'candidate');
    await r.commit('candidate');
    await writeFile(join(dir, 'other.txt'), 'user commit');
    await git('add', '.');
    await git('commit', '-m', 'unrelated user commit');
    const head = await git('rev-parse', 'HEAD');
    expect(await r.revert()).toBe(false);
    expect(await git('rev-parse', 'HEAD')).toBe(head);
    expect(await readFile(join(dir, 'other.txt'), 'utf8')).toBe('user commit');
  });
  it('an agent-created commit stops QA without rewriting its history', async () => {
    const { orchestrator, calls } = await setup([2], async () => {
      await writeFile(join(dir, 'source.txt'), 'agent commit');
      await git('add', '.');
      await git('commit', '-m', 'agent committed directly');
    });
    await expect(orchestrator.runCycle(1, task)).rejects.toThrow(/checkpoint/i);
    expect(calls()).toEqual({ workCalls: 1, reviewCalls: 0 });
    expect(await git('show', 'HEAD:source.txt')).toBe('agent commit');
  });
  it('refuses unignored runtime output before the agent starts', async () => {
    await writeFile(join(dir, '.gitignore'), '');
    await git('add', '.');
    await git('commit', '-m', 'unignore output');
    const { orchestrator, calls } = await setup([8], async () => {});
    await expect(orchestrator.runCycle(1, task)).rejects.toThrow(/outputDir.*gitignored/i);
    expect(calls().workCalls).toBe(0);
  });
  it('never repeats an already completed rollback', async () => {
    const r = createRatchet({}, dir);
    await r.beginAttempt();
    await writeFile(join(dir, 'source.txt'), 'candidate');
    await r.commit('candidate');
    expect(await r.revert()).toBe(true);
    const head = await git('rev-parse', 'HEAD');
    expect(await r.revert()).toBe(false);
    expect(await git('rev-parse', 'HEAD')).toBe(head);
  });
  it('does not roll back an earlier checkpoint after a subsequent commit fails', async () => {
    const r = createRatchet({}, dir);
    await r.beginAttempt();
    await writeFile(join(dir, 'source.txt'), 'first');
    await r.commit('first');
    await r.accept();
    await r.beginAttempt();
    const head = await git('rev-parse', 'HEAD');
    const hook = join(dir, '.git/hooks/pre-commit');
    await writeFile(hook, '#!/bin/sh\nexit 1\n');
    await chmod(hook, 0o755);
    await writeFile(join(dir, 'source.txt'), 'second');
    await expect(r.commit('second')).rejects.toThrow(/checkpoint/i);
    expect(await r.revert()).toBe(false);
    expect(await git('rev-parse', 'HEAD')).toBe(head);
    expect(await readFile(join(dir, 'source.txt'), 'utf8')).toBe('second');
  });

  it('requires a clean attempt boundary even through the public commit API', async () => {
    const r = createRatchet({}, dir);
    await writeFile(join(dir, 'source.txt'), 'user work');
    const head = await git('rev-parse', 'HEAD');
    await expect(r.commit('accidental ownership')).rejects.toThrow(/beginAttempt|attempt/i);
    expect(await git('rev-parse', 'HEAD')).toBe(head);
    expect(await git('diff', '--cached')).toBe('');
  });
  it('excludes another ratchet instance until the owner finishes', async () => {
    const first = createRatchet({}, dir),
      second = createRatchet({}, dir);
    await first.beginAttempt();
    await expect(second.beginAttempt()).rejects.toThrow(/lock|active/i);
    await first.commit('no changes');
    await first.accept();
    await second.beginAttempt();
    await second.commit('no changes');
    await second.accept();
  });
  it('retains failed attempt metadata and blocks a fresh instance', async () => {
    const first = createRatchet({}, dir);
    await first.beginAttempt();
    const hook = join(dir, '.git/hooks/pre-commit');
    await writeFile(hook, '#!/bin/sh\nexit 1\n');
    await chmod(hook, 0o755);
    await writeFile(join(dir, 'source.txt'), 'candidate');
    await expect(first.commit('fail')).rejects.toThrow(/checkpoint/i);
    const second = createRatchet({}, dir);
    await expect(second.beginAttempt()).rejects.toThrow(/lock|active/i);
    const state = JSON.parse(await readFile(join(dir, '.git/toryo-ratchet.lock'), 'utf8'));
    expect(state.base).toBe(await git('rev-parse', 'HEAD'));
    expect(state.pid).toBe(process.pid);
  });

  it('retains recovery state when a Git hook modifies the reverted checkout', async () => {
    const r = createRatchet({}, dir);
    await r.beginAttempt();
    await writeFile(join(dir, 'source.txt'), 'candidate');
    await r.commit('candidate');
    const hook = join(dir, '.git/hooks/post-commit');
    await writeFile(hook, '#!/bin/sh\necho hook-write >> source.txt\n');
    await chmod(hook, 0o755);
    expect(await r.revert()).toBe(false);
    expect(await readFile(join(dir, 'source.txt'), 'utf8')).toContain('hook-write');
    expect(
      JSON.parse(await readFile(join(dir, '.git/toryo-ratchet.lock'), 'utf8')).checkpoint,
    ).toBeTruthy();
  });
  it('rechecks the new Git checkpoint after a required check rejects a passing review', async () => {
    const script = `const fs=require('node:fs');fs.mkdirSync('.custom-output',{recursive:true});
      const path='.custom-output/check-count.txt';const n=fs.existsSync(path)?Number(fs.readFileSync(path)):0;
      fs.writeFileSync(path,String(n+1));console.log('check attempt '+(n+1));process.exit(n===0?1:0)`;
    const {orchestrator} = await setup([9,9],
      async (n) => writeFile(join(dir,'source.txt'),`candidate ${n}`), 'commit-revert', 1,
      [{id:'test',command:process.execPath,args:['-e',script]}]);
    const result = await orchestrator.runCycle(1,task);
    expect(result.verdict).toBe('keep');
    expect(result.reviews).toHaveLength(2);
    expect(result.reviews![0].validationError).toBeTruthy();
    expect(result.reviews![0].evidence!.checks[0].exitCode).toBe(1);
    expect(result.reviews![1].evidence!.checks[0].exitCode).toBe(0);
    expect(result.reviews![0].evidence!.patch.head).not.toBe(result.reviews![1].evidence!.patch.head);
    expect(await readFile(join(dir,'source.txt'),'utf8')).toBe('candidate 2');
  });

});
