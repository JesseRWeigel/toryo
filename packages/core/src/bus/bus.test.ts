import { describe, it, expect, vi } from 'vitest';
import { InMemoryBus } from './bus.js';
import type { BusMessage } from './messages.js';

describe('InMemoryBus', () => {
  it('routes messages to handlers subscribed by taskId', () => {
    const bus = new InMemoryBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe('t1', a);
    bus.subscribe('t2', b);

    const msg: BusMessage = {
      type: 'task:update',
      taskId: 't1',
      taskName: 'plan',
      update: { progress: 0.5 },
    };
    bus.publish(msg);

    expect(a).toHaveBeenCalledWith(msg);
    expect(b).not.toHaveBeenCalled();
  });

  it('unsubscribe detaches the handler and is idempotent', () => {
    const bus = new InMemoryBus();
    const handler = vi.fn();
    const off = bus.subscribe('t1', handler);

    off();
    off(); // second call must be a no-op, not a throw

    bus.publish({
      type: 'task:cancel',
      taskId: 't1',
      taskName: 'plan',
      reason: 'post-unsub',
    });
    expect(handler).not.toHaveBeenCalled();
  });
});
