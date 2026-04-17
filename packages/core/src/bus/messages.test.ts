import { describe, it, expect } from 'vitest';
import type { BusMessage, TaskRequest, TaskResponse } from './messages.js';

describe('BusMessage discriminated union', () => {
  it('narrows by type tag', () => {
    const req: TaskRequest = {
      type: 'task:request',
      taskId: 't1',
      taskName: 'plan',
      payload: { spec: 'do the thing' },
    };
    const resp: TaskResponse = {
      type: 'task:response',
      taskId: 't1',
      taskName: 'plan',
      ok: true,
      result: { brief: 'ok' },
    };
    const msgs: BusMessage[] = [req, resp];

    const seen: string[] = [];
    for (const m of msgs) {
      if (m.type === 'task:request') seen.push('req:' + m.taskName);
      else if (m.type === 'task:response') seen.push('resp:' + String(m.ok));
    }
    expect(seen).toEqual(['req:plan', 'resp:true']);
  });

  it('every message carries taskId', () => {
    const failure: TaskResponse = {
      type: 'task:response',
      taskId: 'abc',
      taskName: 'plan',
      ok: false,
      error: 'boom',
    };
    expect(failure.taskId).toBe('abc');
    expect(failure.ok).toBe(false);
    expect(failure.error).toBe('boom');
  });
});
