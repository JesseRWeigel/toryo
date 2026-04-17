import { describe, it, expect } from 'vitest';
import { InMemoryBus } from './bus.js';
import { taskGroup } from './task-group.js';
import type { BusMessage } from './messages.js';

/**
 * Wraps bus.publish so that every task:request for `name` is answered by `reply`.
 * The workers can't subscribe up-front because taskGroup generates fresh UUIDs;
 * intercepting at publish time lets us wire a generic responder by task name.
 */
function respondByName(
  bus: InMemoryBus,
  name: string,
  reply: (taskId: string) => BusMessage[]
): void {
  const original = bus.publish.bind(bus);
  bus.publish = (msg: BusMessage) => {
    original(msg);
    if (msg.type === 'task:request' && msg.taskName === name) {
      queueMicrotask(() => {
        for (const out of reply(msg.taskId)) original(out);
      });
    }
  };
}

describe('taskGroup', () => {
  it('fans out in parallel and resolves a results Map with per-agent attribution', async () => {
    const bus = new InMemoryBus();
    respondByName(bus, 'planner', (taskId) => [
      { type: 'task:update', taskId, taskName: 'planner', update: 'tick' },
      { type: 'task:response', taskId, taskName: 'planner', ok: true, result: 'A' },
    ]);
    respondByName(bus, 'coder', (taskId) => [
      { type: 'task:response', taskId, taskName: 'coder', ok: true, result: 'B' },
    ]);

    const group = taskGroup(bus, [
      { name: 'planner', payload: null },
      { name: 'coder', payload: null },
    ]);

    const seen: Array<[string, string]> = [];
    for await (const { agentName, event } of group) {
      seen.push([agentName, event.type]);
    }

    const results = await group.results;
    expect(results.get('planner')?.result).toBe('A');
    expect(results.get('coder')?.result).toBe('B');
    expect(seen.some(([n, t]) => n === 'planner' && t === 'task:update')).toBe(true);
    expect(seen.some(([n, t]) => n === 'coder' && t === 'task:response')).toBe(true);
  });

  it('failFast cancels siblings when one child fails', async () => {
    const bus = new InMemoryBus();
    const cancelledNames = new Set<string>();

    // Record every task:cancel we see so we can assert siblings got aborted.
    const originalPublish = bus.publish.bind(bus);
    bus.publish = (msg: BusMessage) => {
      if (msg.type === 'task:cancel') cancelledNames.add(msg.taskName);
      originalPublish(msg);
    };

    respondByName(bus, 'fails', (taskId) => [
      {
        type: 'task:response',
        taskId,
        taskName: 'fails',
        ok: false,
        error: 'intentional',
      },
    ]);
    // 'idle' has no responder — it hangs until cancelled.

    const group = taskGroup(
      bus,
      [
        { name: 'fails', payload: null },
        { name: 'idle', payload: null },
      ],
      { failFast: true }
    );

    // Drain the iterator so the child pumps advance.
    const drain = (async () => {
      for await (const _ev of group) {
        // no-op
      }
    })();

    await expect(group.results).rejects.toThrow(/intentional/);
    await drain;
    expect(cancelledNames.has('idle')).toBe(true);
  });
});
