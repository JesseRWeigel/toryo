/**
 * Dispatch a single task on the bus and consume its events.
 *
 * Equivalent of Pipecat Sub-Agents' `async with task(name, payload) as ctx`:
 * - Iterate `for await (const ev of ctx)` to stream non-terminal events.
 * - Await `ctx.result` for the terminal `TaskResponse`.
 * - Call `ctx.cancel()` (or let `result` / the iterator reject) to publish
 *   a `TaskCancel` message and tear down the subscription.
 */

import { randomUUID } from 'node:crypto';
import type { AgentBus } from './bus.js';
import type { BusMessage, TaskResponse } from './messages.js';

export interface TaskContextOptions {
  /** Abort the task after this many milliseconds. */
  timeoutMs?: number;
  /** Override the generated taskId (useful for tests / correlation). */
  taskId?: string;
}

export interface TaskContext extends AsyncIterable<BusMessage> {
  readonly taskId: string;
  readonly taskName: string;
  readonly result: Promise<TaskResponse>;
  /** Publish a TaskCancel and settle result / iterator as cancelled. */
  cancel(reason?: string): void;
}

export function createTaskContext(
  bus: AgentBus,
  taskName: string,
  payload: unknown,
  opts: TaskContextOptions = {}
): TaskContext {
  const taskId = opts.taskId ?? randomUUID();

  // Queue of events buffered for the iterator plus a parallel queue of
  // pending consumer promises (classic async-queue pattern).
  const buffered: BusMessage[] = [];
  const waiters: Array<{
    resolve: (v: IteratorResult<BusMessage>) => void;
    reject: (e: unknown) => void;
  }> = [];
  let iteratorClosed = false;
  let iteratorError: Error | null = null;

  let resolveResult!: (r: TaskResponse) => void;
  let rejectResult!: (e: Error) => void;
  const result = new Promise<TaskResponse>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  // Prevent "unhandled rejection" crashes for callers that only iterate and
  // never await .result — we still surface the error to anyone who does.
  result.catch(() => undefined);

  let settled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const unsubscribe = bus.subscribe(taskId, (msg) => {
    if (iteratorClosed) return;

    // Ignore the outbound request that we published ourselves — the caller
    // is only interested in responses, updates, streaming chunks, and
    // cancels that come back from workers.
    if (msg.type === 'task:request') return;

    if (msg.type === 'task:response') {
      // Terminal — flush to iterator, resolve or reject result.
      deliver(msg);
      closeIterator(null);
      settle(() => {
        if (msg.ok) {
          resolveResult(msg);
        } else {
          rejectResult(new Error(msg.error ?? `task ${taskName} failed`));
        }
      });
      return;
    }

    if (msg.type === 'task:cancel') {
      const err = new Error(msg.reason ?? `task ${taskName} cancelled`);
      closeIterator(err);
      settle(() => rejectResult(err));
      return;
    }

    deliver(msg);
  });

  function deliver(msg: BusMessage) {
    const waiter = waiters.shift();
    if (waiter) {
      waiter.resolve({ value: msg, done: false });
    } else {
      buffered.push(msg);
    }
  }

  function closeIterator(err: Error | null) {
    if (iteratorClosed) return;
    iteratorClosed = true;
    iteratorError = err;
    while (waiters.length > 0) {
      const waiter = waiters.shift();
      if (!waiter) continue;
      if (err) waiter.reject(err);
      else waiter.resolve({ value: undefined, done: true });
    }
  }

  function settle(fn: () => void) {
    if (settled) return;
    settled = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    unsubscribe();
    fn();
  }

  function cancel(reason?: string): void {
    if (settled) return;
    bus.publish({
      type: 'task:cancel',
      taskId,
      taskName,
      reason,
    });
    const err = new Error(reason ?? `task ${taskName} cancelled`);
    closeIterator(err);
    settle(() => rejectResult(err));
  }

  if (opts.timeoutMs !== undefined && opts.timeoutMs > 0) {
    timer = setTimeout(() => {
      cancel(`task ${taskName} timed out after ${opts.timeoutMs}ms`);
    }, opts.timeoutMs);
    // Don't hold the event loop open just for this timer.
    if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
      (timer as { unref: () => void }).unref();
    }
  }

  // Publish the request *after* subscription is wired up so we don't miss
  // a synchronous response from an in-process handler.
  bus.publish({
    type: 'task:request',
    taskId,
    taskName,
    payload,
  });

  const iterator: AsyncIterator<BusMessage> = {
    next(): Promise<IteratorResult<BusMessage>> {
      const next = buffered.shift();
      if (next !== undefined) {
        return Promise.resolve({ value: next, done: false });
      }
      if (iteratorClosed) {
        if (iteratorError) return Promise.reject(iteratorError);
        return Promise.resolve({ value: undefined, done: true });
      }
      return new Promise((resolve, reject) => {
        waiters.push({ resolve, reject });
      });
    },
    return(): Promise<IteratorResult<BusMessage>> {
      // `break` out of the for-await loop — treat as cancellation.
      cancel(`task ${taskName} iterator closed`);
      return Promise.resolve({ value: undefined, done: true });
    },
  };

  return {
    taskId,
    taskName,
    result,
    cancel,
    [Symbol.asyncIterator](): AsyncIterator<BusMessage> {
      return iterator;
    },
  };
}
