import { describe, it, expect } from 'vitest';
import { InMemoryBus } from './bus.js';
import { createTaskContext } from './task-context.js';
import type { BusMessage } from './messages.js';

describe('createTaskContext', () => {
  it('streams updates then resolves result on task:response', async () => {
    const bus = new InMemoryBus();

    // Stand-in worker: when it sees a request, emit an update then a response.
    bus.subscribe('fixed-id', (msg: BusMessage) => {
      if (msg.type !== 'task:request') return;
      queueMicrotask(() => {
        bus.publish({
          type: 'task:update',
          taskId: msg.taskId,
          taskName: msg.taskName,
          update: { step: 1 },
        });
        bus.publish({
          type: 'task:response',
          taskId: msg.taskId,
          taskName: msg.taskName,
          ok: true,
          result: { answer: 42 },
        });
      });
    });

    const ctx = createTaskContext(bus, 'plan', { q: 'hi' }, { taskId: 'fixed-id' });
    const events: string[] = [];
    for await (const ev of ctx) events.push(ev.type);

    expect(events).toEqual(['task:update', 'task:response']);
    const result = await ctx.result;
    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ answer: 42 });
  });

  it('rejects result and iterator when timeoutMs elapses without a response', async () => {
    const bus = new InMemoryBus();
    // Silent worker — never responds.
    bus.subscribe('t-timeout', () => {});

    const ctx = createTaskContext(
      bus,
      'plan',
      null,
      { taskId: 't-timeout', timeoutMs: 20 }
    );

    await expect(ctx.result).rejects.toThrow(/timed out/);
    // Iterator should also surface the rejection when drained after timeout.
    const iter = ctx[Symbol.asyncIterator]();
    await expect(iter.next()).rejects.toThrow(/timed out/);
  });
});
