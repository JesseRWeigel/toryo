/**
 * In-process message bus. No external deps, no EventEmitter — just a Map
 * keyed by taskId holding a Set of handlers. Each `publish` synchronously
 * fans out to every handler subscribed to that taskId.
 *
 * This is deliberately tiny. Cross-process transports (NATS, Redis, etc.)
 * can satisfy the same `AgentBus` interface.
 */

import type { BusMessage } from './messages.js';

export type BusHandler = (msg: BusMessage) => void;

export interface AgentBus {
  /** Deliver a message to every handler subscribed to `msg.taskId`. */
  publish(msg: BusMessage): void;
  /**
   * Subscribe `handler` to messages for `taskId`. Returns an unsubscribe
   * function — call it (exactly once) to detach.
   */
  subscribe(taskId: string, handler: BusHandler): () => void;
}

export class InMemoryBus implements AgentBus {
  private readonly handlers = new Map<string, Set<BusHandler>>();

  publish(msg: BusMessage): void {
    const set = this.handlers.get(msg.taskId);
    if (!set || set.size === 0) return;
    // Snapshot so handlers that unsubscribe during dispatch don't mutate
    // the iteration order of the Set we're currently walking.
    const snapshot = Array.from(set);
    for (const handler of snapshot) {
      handler(msg);
    }
  }

  subscribe(taskId: string, handler: BusHandler): () => void {
    let set = this.handlers.get(taskId);
    if (!set) {
      set = new Set();
      this.handlers.set(taskId, set);
    }
    set.add(handler);

    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      const current = this.handlers.get(taskId);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) {
        this.handlers.delete(taskId);
      }
    };
  }
}
