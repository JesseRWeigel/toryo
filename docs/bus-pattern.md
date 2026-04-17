# Bus Pattern

`toryo-core` ships an opt-in message bus for fine-grained agent-to-agent coordination, alongside the existing `ToryoEvent` callback. It is inspired by [pipecat-ai/pipecat-subagents](https://github.com/pipecat-ai/pipecat) (BSD-2) and adds no new runtime dependencies.

## What the AgentBus is

The bus is a typed pub/sub channel keyed by `taskId`. Messages are a discriminated union covering the full lifecycle of an agent task:

- `task:request` — dispatch
- `task:update` — progress / log lines
- `task:stream:start` / `task:stream:data` / `task:stream:end` — streaming output
- `task:response` — terminal success or failure
- `task:cancel` — abort

`InMemoryBus` is the default in-process implementation. The `AgentBus` interface is minimal (`publish`, `subscribe`), so cross-process transports like NATS or Redis can satisfy it without any code changes to callers.

## When to use it

Use the `ToryoEvent` callback (passed to `runCycle` / the orchestrator) when you just want a single event stream for logging or a dashboard. That path stays the default and is unchanged.

Reach for the bus when you need:

- **Per-agent event attribution** when fanning out work in parallel — `taskGroup` tags every event with its originating agent name.
- **Clean cancellation** — `ctx.cancel()` publishes a `task:cancel` and tears down the subscription; siblings in a group can be cancelled together via `failFast`.
- **Streaming tokens** between agents without threading extra callbacks through the orchestrator.
- **Custom transports** — swap `InMemoryBus` for a network-backed implementation of `AgentBus` without touching the rest of your code.

## Single task: `createTaskContext`

```typescript
import { InMemoryBus, createTaskContext } from 'toryo-core';

const bus = new InMemoryBus();

// Somewhere else — a worker subscribed on the same bus handles `task:request`
// messages for "research" and publishes back a `task:response`.

const ctx = createTaskContext(bus, 'research', { topic: 'quality gates' }, {
  timeoutMs: 30_000,
});

for await (const event of ctx) {
  if (event.type === 'task:update') console.log(event.message);
}

const response = await ctx.result; // terminal TaskResponse
```

Call `ctx.cancel('user aborted')` at any time to publish a cancel message and reject both the iterator and the `result` promise.

## Parallel fanout: `taskGroup`

```typescript
import { InMemoryBus, taskGroup } from 'toryo-core';

const bus = new InMemoryBus();

const group = taskGroup(bus, [
  { name: 'researcher', payload: { topic: 'failure modes' } },
  { name: 'coder',      payload: { spec: './spec.md' } },
  { name: 'reviewer',   payload: { threshold: 7 } },
], { timeoutMs: 60_000 });

for await (const { agentName, event } of group) {
  if (event.type === 'task:stream:data') {
    process.stdout.write(`[${agentName}] ${event.chunk}`);
  }
}

const results = await group.results; // Map<agentName, TaskResponse>
```

By default `taskGroup` is fail-fast: the first failing child rejects `results` and cancels its siblings. Pass `{ failFast: false }` to collect per-agent outcomes instead.

## Migration is opt-in

The existing adapters, orchestrator, ratchet, delegation, and metrics modules are unchanged. Code using `ToryoEvent` callbacks keeps working exactly as before. The bus is additive — adopt it where you want per-agent attribution or streaming, and leave the rest of your pipeline alone.
