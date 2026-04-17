/**
 * Typed message bus messages (Pipecat Sub-Agents inspired).
 *
 * These types are the only coupling between agents on the bus. Every message
 * carries a `type` discriminator and a `taskId` so a subscriber can filter
 * traffic for a single task without racing against others.
 *
 * See `./bus.ts` for the transport and `./task-context.ts` / `./task-group.ts`
 * for the two dispatch helpers built on top of these messages.
 */

/** Request to start a task on the bus. */
export interface TaskRequest {
  readonly type: 'task:request';
  readonly taskId: string;
  readonly taskName: string;
  readonly payload: unknown;
}

/** Terminal response for a task. Exactly one of these is emitted per task. */
export interface TaskResponse {
  readonly type: 'task:response';
  readonly taskId: string;
  readonly taskName: string;
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: string;
}

/** Non-terminal progress update. Zero or more may be emitted per task. */
export interface TaskUpdate {
  readonly type: 'task:update';
  readonly taskId: string;
  readonly taskName: string;
  readonly update: unknown;
}

/** Signal that a streaming channel has opened for this task. */
export interface TaskStreamStart {
  readonly type: 'task:stream:start';
  readonly taskId: string;
  readonly taskName: string;
  readonly contentType?: string;
}

/** A single chunk within an open streaming channel. */
export interface TaskStreamData {
  readonly type: 'task:stream:data';
  readonly taskId: string;
  readonly taskName: string;
  readonly chunk: unknown;
}

/** Signal that the streaming channel has closed. A TaskResponse may still follow. */
export interface TaskStreamEnd {
  readonly type: 'task:stream:end';
  readonly taskId: string;
  readonly taskName: string;
}

/** Request to cancel an in-flight task. Consumers should stop emitting for this taskId. */
export interface TaskCancel {
  readonly type: 'task:cancel';
  readonly taskId: string;
  readonly taskName: string;
  readonly reason?: string;
}

/** Discriminated union of every message that may flow on the bus. */
export type BusMessage =
  | TaskRequest
  | TaskResponse
  | TaskUpdate
  | TaskStreamStart
  | TaskStreamData
  | TaskStreamEnd
  | TaskCancel;
