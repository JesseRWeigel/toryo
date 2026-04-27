# Toryo Roadmap 2026

A working strategy document for the next 90 days, plus the longer arc that follows. Written for future contributors and future-Jesse. The goal is to capture not only what we plan to ship but also why each choice makes sense given where the agent-CLI ecosystem actually is in mid-2026.

---

## 1. Mission and current state

Toryo is a TypeScript orchestrator that wraps coding-agent CLIs (Claude Code, Aider, Gemini, Codex, Ollama, and others) inside a four-phase quality loop: Plan, Research, Execute, Review. It commits work that passes a configurable QA threshold and reverts work that does not, runs Ralph Loop retries on borderline failures, tracks per-agent trust, and streams the whole thing to a Hono plus WebSocket dashboard. The point of the project, distilled: running multiple agents in parallel is easy; composing them into a system that produces work you would actually keep is the hard part.

As of late April 2026 the project is healthy on three signals worth naming. Tests are green at 284 of 284 across the workspaces (the count grew this week as new adapters landed), the build is clean, and the AgentBus pattern (typed in-process pub/sub with task contexts and task groups) just shipped. We picked up our first external pull request, a `codex exec` argument fix, which is a small but genuine signal that someone outside the project found Toryo, used it, hit a bug, and cared enough to send a fix. Eight stars and one fork is not a movement, but it is a foundation. The npm packages are published as `toryo-core`, `toryo-adapters`, and `@jweigel/toryo` (CLI), with `@toryo/dashboard` held private for now. Local versions have advanced to `v0.3.0` for core and `v0.2.0` for cli and adapters, while npm is still serving `v0.1.1`. Closing that drift is the very first item below.

## 2. 2026 priorities (next 90 days)

Three buckets, ordered roughly by leverage. Hygiene is cheap and unblocks everything else. Capability adds keep us current with a fast-moving CLI ecosystem. Strategic work positions Toryo against the protocol layer (MCP, A2A) that is becoming the real conversation in this space.

### 2a. Hygiene

1. **Publish the version drift.** Local is `v0.3.0` core and `v0.2.0` for cli/adapters. npm is on `v0.1.1`. Anyone running `npm install toryo-core` today gets a release that predates AgentBus, the `useStdin` work, and roughly two months of bug fixes. Cut releases, tag in git, and add a release-checklist doc so the next cut is mechanical.
2. **Update the README test count.** It still implies an older count in places. Bump to 264 and add a one-line note about what AgentBus does, since that is the headline architectural change of this quarter.
3. **Reorganize `docs/`.** Today we have `adapters.md`, `bus-pattern.md`, `concepts.md`, `configuration.md`, `contributing.md`, `dashboard.md`, `getting-started.md`, and `specs.md` all flat in one directory. Group them: `docs/guide/` for tutorials, `docs/reference/` for config and adapter API, `docs/design/` for AgentBus, ratcheting, delegation. Add an index page. This costs a half day and pays back every time someone new reads the project.
4. **Wire CI to publish.** Right now releases are manual. A `release-please` style flow keyed off conventional commits would prevent the drift from happening again.

### 2b. Capability adds

5. **Cursor adapter.** ✅ Shipped 2026-04-27 (#34, closes #31). The `agent -p --force` non-interactive mode is wrapped, with `CURSOR_API_KEY` passed through from the parent env.
6. **Cline adapter.** ✅ Shipped 2026-04-27 (#35, closes #32). `cline --yolo` invocation; auth handled by `cline auth`.
7. **claude-code drift update.** ✅ Constructor-options surface shipped 2026-04-27 (#36, closes #33). Exposed: `bare`, `maxBudgetUsd`, `maxTurns`, `excludeDynamicSystemPromptSections`, `jsonSchema`, `agents`, `sessionName`. OTEL `TRACEPARENT` / `TRACESTATE` propagation is deferred to a separate issue and remains open work for this quarter.
8. **`useStdin` migration for aider, gemini-cli, codex.** Issue #30. Long prompts crash these adapters because we pass them as command args rather than piping to stdin. The claude-code adapter already uses the `useStdin: true` pattern. This is mechanical work and should be one PR.
9. **OpenCode adapter.** `opencode run` plus the `opencode serve` HTTP daemon. 140k stars is the largest community in the wrap-a-CLI space and ignoring it would be a mistake. The HTTP daemon is interesting on its own (see Section 6 on server-mode adapters).
10. **Continue (`cn`) adapter.** Designed for CI and git hooks, which is exactly the surface area where Toryo is weakest right now. Lower priority than Cursor/Cline because the Continue audience overlaps with our existing aider/codex users, but worth doing this quarter.
11. **codex `--json` NDJSON parsing.** Codex shipped streaming NDJSON output. Update `parseOutput` to read it instead of one-shot stdout when available. This is also relevant to the dashboard, which can show events live instead of one block at the end.
12. **gemini `--policy` and MCP slash commands.** Gemini added a policy flag and made MCP slash commands work non-interactively. Both should be options on the gemini adapter.
13. **Ollama streaming tool calls plus structured outputs.** Ollama's HTTP API now supports streaming tool calls and JSON-schema structured outputs, plus a web search API. Our current adapter uses simple completion. Upgrading unlocks the same structured-output path that `--json-schema` gives the Claude adapter.

### 2c. Strategic

14. **MCP as a first-class field on agent task spec.** Right now MCP server config is per-adapter and scattered. Promote it to the task spec so a task can declare "I need filesystem MCP and github MCP" once, and Toryo will configure each agent's MCP entry consistently. See Section 6 for the full argument.
15. **AgentBus as MCP server (study, not commit).** Spike: can Toryo's AgentBus expose itself as an MCP server so external agents can subscribe to the same event stream we use internally? If yes, we suddenly have an interop story with anyone building on MCP. If no, document why and move on.
16. **A2A protocol study.** Google's Agent-to-Agent protocol hit v1.0 with 150 plus organizations signed on. This overlaps with what AgentBus does at the in-process layer. We need to read the spec carefully and decide: do we implement A2A as a transport for AgentBus (so cross-process Toryo instances can talk), or do we stay in-process and let the AgentBus stay simple? My current bet is the former, but it is a real decision that wants a written ADR.
17. **Worktree-per-agent evaluation.** Composio Agent Orchestrator and AWS Labs cli-agent-orchestrator both isolate each agent in its own git worktree. This is becoming table stakes for safety, since it lets you run agents in parallel without them stepping on each other's working trees. Toryo currently runs agents sequentially within a cycle, so we have not needed it yet. As soon as we move to parallel-within-cycle (a likely Q3 item), worktree-per-agent becomes mandatory. Spike now, ship later.
18. **CrabTrap-style egress proxy (issue #28).** Architectural. The shape of the problem: when an agent CLI runs with credentials in env, anything it calls out to has access to those credentials. A local egress proxy that mediates outbound traffic and strips or scopes credentials would let users run untrusted prompts without leaking keys. This is hard and probably a Q3 deliverable, not Q2, but the design discussion should start now.

## 3. What we are not doing, and why

Saying no out loud saves contributors from sending PRs we will not merge.

- **Roo Code adapter.** Roo announced a May 15, 2026 shutdown. Building an adapter for a tool with a six-week runway is wasted work.
- **Sourcegraph Cody adapter.** Cody rebranded to Amp and went enterprise-only. Our audience is solo devs and small teams, so an enterprise SSO-gated CLI is the wrong surface.
- **NATS or Redis as the AgentBus backend.** AgentBus is intentionally in-process for now. The complexity budget for a network message broker is large and the use case (cross-process, cross-host coordination) is not yet justified by user demand. If A2A turns out to be the right transport (item 16), we will use that. Either way, we are not bolting on NATS just because it is available.
- **Zed external agents this quarter.** Interesting, but the API surface is still moving and we have higher-leverage work first.
- **A web-hosted dashboard.** The dashboard is a local Hono server on purpose. Hosting it ourselves means auth, multi-tenancy, and billing, all of which are a different project.

## 4. Architecture decisions worth preserving

These are the choices that have earned their place. New contributors should treat them as invariants and only argue against them with strong evidence.

- **AgentBus as the integration seam.** Typed in-process pub/sub with task contexts and task groups gives adapters, the orchestrator, the dashboard, and future MCP/A2A servers a clean way to talk without coupling. Every new feature should ask: can this be an event on the bus rather than a direct call?
- **Ratcheting (commit on pass, revert on fail).** Borrowed from Karpathy's autoresearch. In any system where output quality varies, the only way to get monotone progress is to make "keep" a deliberate gate. Toryo refuses to keep bad work.
- **Trust-based delegation.** Agents start at supervised, earn guided, then autonomous, based on rolling score. This does two jobs at once: it limits blast radius from new or underperforming agents, and it gives the system a self-tuning path so agents that are good at a task get trusted with bigger versions of it. The trust formula is intentionally simple (`min(avg_score / 10, 1.0)`) so that it is easy to reason about. Anyone proposing a more sophisticated model has to show that the existing one fails on a real workload.
- **Rule-based AI plus LLM dialogue split.** The orchestrator loop, the ratchet, the delegation, the Ralph Loop retry policy, and the metrics are all deterministic code. The agents are the LLMs. The split matters because deterministic code is debuggable, testable, and auditable in a way that prompt-based logic is not. When in doubt, the loop is rule-based and the agents do the talking.

## 5. Adapter contract conventions

Documented so future adapters follow the same shape. This is the contract; if your adapter cannot meet it, raise an issue rather than diverging.

- **Prefer `useStdin: true`.** Long prompts blow past argv length limits. The claude-code adapter already pipes prompts on stdin. New adapters should follow that pattern unless the underlying CLI genuinely cannot read from stdin (rare). Issue #30 tracks migrating the existing aider, gemini-cli, and codex adapters.
- **Constructor options for adapter-specific config.** Each adapter takes a typed options object in its constructor when it has adapter-specific knobs. Example: `new ClaudeCodeAdapter({ bare: true, maxBudgetUsd: 5, maxTurns: 8 })`. The factory `createAdapter('claude-code', opts)` passes options through. Do not pile adapter-specific knobs onto the shared `AdapterSendOptions` interface. Keep them local to the adapter so the type system tells you what each adapter actually supports.
- **`parseOutput(stdout, stderr)` is the standard signature.** Adapters return a structured result by parsing the CLI's output. If the CLI offers JSON output, prefer it over scraping prose. NDJSON output (codex) should be parsed line-by-line so the dashboard can stream events.
- **`isAvailable()` via `commandExists`.** Adapters declare whether their backing CLI is on the PATH using a shared `commandExists` helper. Do not invent your own detection logic. This keeps `toryo check` consistent across adapters.
- **Errors are typed, not stringly.** When the underlying CLI fails, surface a typed error (`AdapterTimeoutError`, `AdapterAuthError`, etc.) rather than re-throwing the raw exec error. The orchestrator branches on these types to decide whether to retry, fail the cycle, or skip scoring.
- **No state in the adapter beyond construction.** Adapters are functions, more or less. The orchestrator owns state. If you find yourself wanting to cache something inside an adapter, push it to the orchestrator or AgentBus.

## 6. MCP positioning

Why is Toryo wrapping CLIs at all in the year MCP exists?

The short answer: MCP and CLI wrapping solve different problems. MCP is a tool layer. It lets a single agent reach out to filesystems, databases, or APIs through a standardized protocol. It does not say anything about which agent runs, when, with what trust level, or whether its output gets committed or reverted. CLI wrapping is the agent layer. It lets you choose whose model and harness runs a given step. Toryo lives at the orchestration layer that sits above both.

In practice the two compose. A Toryo task spec can declare "use the claude-code adapter, with filesystem MCP and github MCP enabled" and Toryo passes the MCP config through to the adapter. The agent then gets to use those tools during execution. We think the right move for Q2 is to promote MCP server config from a per-adapter detail to a first-class field on the task spec, so the same MCP setup is reused regardless of which agent CLI is running that phase. That is item 14.

A2A is a different layer again. Where MCP standardizes agent-to-tool, A2A standardizes agent-to-agent. Toryo's AgentBus is doing the same thing in-process that A2A does cross-process. The honest read is that AgentBus and A2A are not competitors so much as they are the same idea at different scopes. The interesting question is whether AgentBus should adopt A2A as its wire format when it needs to go cross-process. That is item 16. The answer is probably yes, but we want to read the v1.0 spec carefully before committing.

The strategic point: Toryo's value is not in any single adapter. It is in the loop. As long as MCP and A2A are layers we compose with rather than layers we compete against, Toryo gets stronger as the ecosystem standardizes, not weaker.

## 7. Open questions

Things contributors are welcome to weigh in on. Each of these has a real decision behind it.

- **CrabTrap design.** The egress-proxy shape (issue #28) is the right one in spirit, but the implementation has options. Local mitmproxy with custom rules? A Node-level fetch interceptor injected per-adapter? A separate sidecar process? Each has tradeoffs around correctness, performance, and debuggability. We do not have a strong opinion yet.
- **AgentBus persistence backend.** The bus is in-memory today. Once you want to crash-recover a long-running cycle, or replay a cycle for debugging, you need persistence. SQLite would match the overstory pattern (which we already admire). NDJSON append-only files would match results.tsv. A real event store like EventStoreDB is overkill for our scale. Probably SQLite, but worth a real ADR.
- **OTEL propagation strategy.** Claude Code now propagates `TRACEPARENT` and `TRACESTATE`. If Toryo also emits OTEL spans for the orchestrator loop, we get distributed tracing across the whole pipeline. The question is which OTEL exporter to default to and whether to require an OTEL collector or ship in a no-op mode by default. Default-off seems right for v0.4 but we should not build a half-version that locks us in.
- **MCP normalization shape.** When task spec declares MCP servers and the chosen adapter does not natively support MCP (e.g., a custom adapter), what happens? Options include: silently ignore, hard error, warn and continue, run a Toryo-local MCP host that proxies for the adapter. The right answer probably depends on whether the user marked the MCP server as required.
- **Server-mode adapters.** OpenCode's `opencode serve` and Cursor's API both let you talk over HTTP rather than spawning a fresh process per call. This would change our adapter base class. Worth it for the latency win? Maybe, but only if we can keep the contract in Section 5 unchanged.
- **Verifiable artifacts and proof-of-work.** Other orchestrators (Composio, overstory) attach signed proof-of-work artifacts to each agent step. Useful for audit, expensive to implement. Worth doing once we have a real user with a compliance need.

## 8. References

External resources cited above, for the curious or the verifying.

- Cursor agent CLI: <https://docs.cursor.com/cli>
- Cline CLI: <https://github.com/cline/cline>
- OpenCode: <https://github.com/sst/opencode>
- Continue (`cn`): <https://docs.continue.dev/cli>
- Claude Code: <https://docs.claude.com/en/docs/claude-code>
- Codex CLI: <https://github.com/openai/codex>
- Aider: <https://aider.chat>
- Gemini CLI: <https://github.com/google-gemini/gemini-cli>
- Ollama API: <https://github.com/ollama/ollama/blob/main/docs/api.md>
- Model Context Protocol: <https://modelcontextprotocol.io>
- MCP roadmap: <https://modelcontextprotocol.io/development/roadmap>
- A2A protocol: <https://a2a-protocol.org>
- Karpathy autoresearch: <https://github.com/karpathy/autoresearch>
- Ralph Loop: <https://github.com/vercel-labs/ralph-loop-agent>
- Composio Agent Orchestrator: <https://github.com/ComposioHQ/composio>
- AWS Labs cli-agent-orchestrator: <https://github.com/awslabs/cli-agent-orchestrator>
- Rivet sandbox-agent: <https://github.com/rivet-gg/sandbox-agent>
- overstory: <https://github.com/overstory-ai/overstory>
- Intelligent AI Delegation paper: <https://arxiv.org/abs/2602.11865>

---

*Living document. Last revised 2026-04-27. Update freely as priorities shift; this is a working plan, not a contract.*
