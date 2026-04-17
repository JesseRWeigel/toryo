/**
 * Parallel fanout over multiple tasks. Events from every child task stream
 * through a single async iterable tagged with the originating task name.
 * A `.results` promise resolves to a Map<agentName, TaskResponse> when all
 * children finish (or rejects on first failure when `failFast` is left on).
 *
 * Equivalent of Pipecat Sub-Agents' `taskGroup(...names)`.
 */

import { createTaskContext, type TaskContext } from './task-context.js';
import type { AgentBus } from './bus.js';
import type { BusMessage, TaskResponse } from './messages.js';

export interface TaskGroupEntry {
  name: string;
  payload: unknown;
}

export interface TaskGroupOptions {
  /** Abort every in-flight child after this many milliseconds. */
  timeoutMs?: number;
  /** When true (default), reject `.results` on first child failure and cancel siblings. */
  failFast?: boolean;
}

export interface TaskGroupEvent {
  agentName: string;
  event: BusMessage;
}

export interface TaskGroup extends AsyncIterable<TaskGroupEvent> {
  readonly results: Promise<Map<string, TaskResponse>>;
  /** Cancel every child task still in flight. */
  cancel(reason?: string): void;
}

export function taskGroup(
  bus: AgentBus,
  tasks: ReadonlyArray<TaskGroupEntry>,
  opts: TaskGroupOptions = {}
): TaskGroup {
  const failFast = opts.failFast !== false;

  const contexts: Array<{ name: string; ctx: TaskContext }> = tasks.map((t) => ({
    name: t.name,
    ctx: createTaskContext(bus, t.name, t.payload, { timeoutMs: opts.timeoutMs }),
  }));

  // Merge channel — every child pushes into this shared queue.
  const buffered: TaskGroupEvent[] = [];
  const waiters: Array<{
    resolve: (v: IteratorResult<TaskGroupEvent>) => void;
    reject: (e: unknown) => void;
  }> = [];
  let liveChildren = contexts.length;
  let iteratorClosed = false;

  function pushEvent(ev: TaskGroupEvent) {
    if (iteratorClosed) return;
    const waiter = waiters.shift();
    if (waiter) {
      waiter.resolve({ value: ev, done: false });
    } else {
      buffered.push(ev);
    }
  }

  function closeIterator() {
    if (iteratorClosed) return;
    iteratorClosed = true;
    while (waiters.length > 0) {
      const waiter = waiters.shift();
      if (waiter) waiter.resolve({ value: undefined, done: true });
    }
  }

  // Per-child: spawn an async pump that copies every event into the merge
  // channel, then decrement liveChildren when the source iterator ends.
  for (const { name, ctx } of contexts) {
    (async () => {
      try {
        for await (const event of ctx) {
          pushEvent({ agentName: name, event });
        }
      } catch {
        // Cancellation / failure surfaces via results; don't throw up here.
      } finally {
        liveChildren -= 1;
        if (liveChildren <= 0) closeIterator();
      }
    })();
  }

  // Collect results. On first failure in failFast mode, cancel siblings.
  const resultEntries: Array<Promise<[string, TaskResponse]>> = contexts.map(
    ({ name, ctx }) =>
      ctx.result.then(
        (res): [string, TaskResponse] => [name, res],
        (err: unknown): [string, TaskResponse] => {
          if (failFast) {
            for (const other of contexts) {
              if (other.name !== name) {
                other.ctx.cancel(`sibling ${name} failed, cancelling group`);
              }
            }
            throw err;
          }
          // Non-fail-fast: synthesize a failed TaskResponse so the caller
          // can still inspect per-agent outcomes via the Map.
          const message = err instanceof Error ? err.message : String(err);
          const fallback: TaskResponse = {
            type: 'task:response',
            taskId: ctx.taskId,
            taskName: name,
            ok: false,
            error: message,
          };
          return [name, fallback];
        }
      )
  );

  const results: Promise<Map<string, TaskResponse>> = Promise.all(resultEntries).then(
    (entries) => new Map(entries)
  );
  // Same reason as in task-context: don't let a caller-only-iterates pattern
  // crash with an unhandled rejection.
  results.catch(() => undefined);

  function cancel(reason?: string): void {
    for (const { ctx } of contexts) ctx.cancel(reason);
  }

  const iterator: AsyncIterator<TaskGroupEvent> = {
    next(): Promise<IteratorResult<TaskGroupEvent>> {
      const next = buffered.shift();
      if (next !== undefined) {
        return Promise.resolve({ value: next, done: false });
      }
      if (iteratorClosed) {
        return Promise.resolve({ value: undefined, done: true });
      }
      return new Promise((resolve, reject) => {
        waiters.push({ resolve, reject });
      });
    },
    return(): Promise<IteratorResult<TaskGroupEvent>> {
      cancel('task group iterator closed');
      closeIterator();
      return Promise.resolve({ value: undefined, done: true });
    },
  };

  return {
    results,
    cancel,
    [Symbol.asyncIterator](): AsyncIterator<TaskGroupEvent> {
      return iterator;
    },
  };
}
