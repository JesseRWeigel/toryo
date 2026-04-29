# Changelog

All notable changes to Toryo are documented here.

## [Unreleased]

### Fixed
- **`parseSpec` no-frontmatter path now parses acceptance criteria from the markdown body.** Previously, specs without a YAML frontmatter block always returned `acceptanceCriteria: []`, silently ignoring any `## Acceptance Criteria` / `## Criteria` / `### Done When` section in the body. The fix calls `parseAcceptanceCriteria(content)` in the no-frontmatter branch, matching the behaviour of the frontmatter path. A regression test covering all three bullet styles and checkbox stripping is added.

### Added
- **Cursor CLI adapter (`cursor`)** — wraps the `agent -p --force` non-interactive mode for the Cursor coding CLI. Requires `CURSOR_API_KEY`. Closes #31.
- **Cline CLI adapter (`cline`)** — wraps `cline --yolo` for non-interactive orchestrator usage. Authenticates via `cline auth`. Closes #32.
- **`ClaudeCodeAdapter` constructor options** — opt-in support for 2026-era flags: `bare`, `maxBudgetUsd`, `maxTurns`, `excludeDynamicSystemPromptSections`, `jsonSchema`, `agents`, and `sessionName`. Defaults preserve back-compat behavior. `createAdapter('claude-code', options)` passes the same options through. Closes #33.

## [0.3.0] — 2026-04-17

### Added
- **Message bus module (`toryo-core/bus`)** — Pipecat Sub-Agents inspired primitives for agent coordination. Typed `BusMessage` union (`TaskRequest`, `TaskResponse`, `TaskUpdate`, `TaskStreamStart/Data/End`, `TaskCancel`), zero-dep `InMemoryBus`, `createTaskContext(bus, name, payload)` for single-task dispatch with async iteration + terminal `.result` promise + cancel-on-exception/timeout, and `taskGroup(bus, tasks)` for parallel fanout with per-agent event attribution and a `.results` Map. Additive only — existing orchestrator APIs unchanged.

## [0.2.0] — 2026-03-20

### Added
- **`toryo check`** — Preflight validation: validates config, checks adapter availability, lists specs
- **`toryo history`** — ASCII bar chart showing score trends with color-coded keep/discard bars
- **`--dry-run` flag** — Preview config and task rotation without executing
- **`--task` / `-t` flag** — Run only a specific task instead of full rotation
- **`--verbose` flag** — Show all events including file extraction logs
- **`--quiet` flag** — Minimal output: 3 lines per cycle (start, score, result)
- **Cycle timing** — Cycle complete events show total duration (e.g. "in 1.8m")
- **Colored CLI output** — ANSI colors for scores (green/yellow/red), verdicts, agent names
- **Smart `toryo init`** — Auto-detects installed tools, generates config using best available
- **Project context** — Agents receive file tree and key file contents from the codebase
- **Knowledge store** — Cross-agent context sharing persisted in knowledge.json (capped at 200 entries)
- **Self-improvement analysis** — `shouldSelfImprove()` detects underperforming agents
- **Config validation** — Zod-based schema validation with clear error messages
- **Graceful shutdown** — SIGINT/SIGTERM saves metrics before exit
- **Notification providers** — ntfy, Slack, Discord, webhook with 10s timeouts
- **Parallel agent execution** — Run multiple agents concurrently within a phase
- **Branch-per-task git strategy** — Isolate each cycle on its own branch
- **Custom phases** — PhaseName is now a string; last phase = quality gate
- **Codex CLI adapter** — First-class support for OpenAI Codex
- **Stdin prompt delivery** — Claude Code adapter pipes via stdin to avoid arg length limits
- **Delay between cycles** — `delayBetweenCycles` config option for continuous runs
- **`toryo export`** — Generate markdown report from results (summary, agent performance, full results table)
- **`--verbose` / `--quiet` flags** — Control output verbosity (quiet = 3 lines per cycle)
- **Score color-coding** — ANSI colors in CLI: green (8+), yellow (6-7), red (<6)
- **Adapter unit tests** — 21 tests covering all 6 adapters + factory function

### Fixed
- **Critical: Agent delegation bias** — Scoring-based selection instead of first-match; agents correctly route to specialists (planner→plan, coder→execute, reviewer→review)
- **Critical: Path traversal in dashboard spec editor** — All API endpoints validate resolved paths stay within specs directory
- **Critical: Score/verdict parsing** — Verdict now derived from score threshold, not unreliable LLM text matching
- **Path traversal in skill extraction** — Skill names sanitized to prevent directory escape
- **Knowledge store saves work output** — Stores execute phase output, not review feedback
- **CLI error messages** — User-friendly errors instead of raw stack traces
- **Glob matching** — `**/` now correctly matches zero directories (root-level files like package.json)
- **Infra failure detection** — Adapter timeouts and crashes properly logged to results.tsv
- **Floating-point drift in successRate** — Integer successCount tracked alongside float rate
- **TSV tab injection** — Tabs/newlines stripped from descriptions
- **Notification timeout** — All fetch calls have 10s AbortSignal timeout
- **Code block regex** — Handles c++, c#, objective-c language tags
- **Ratchet revert safety** — Warns when uncommitted changes exist outside .toryo
- **Ralph Loop retry prompts** — Structured "What went wrong" + "Key instructions" format

### Changed
- `toryo init` now includes `context` config by default (projectDir: ".", maxContextChars: 4000)
- Default CLI output hides extraction saves (use --verbose to see them)
- Phase-aware agent selection uses phase-only keywords, not diluted task description

## [0.1.1] — 2026-03-20

### Fixed
- Package READMEs corrected for unscoped npm names
- Renamed from `@toryo/*` scope to `toryo-core`, `toryo-adapters`, `@jweigel/toryo`

## [0.1.0] — 2026-03-19

### Added
- Initial release
- Core orchestrator engine with 4-phase cycles (plan → research → execute → review)
- Trust-based delegation with 3 autonomy levels
- Quality ratcheting with git commit/revert
- Ralph Loop retry with QA feedback
- Auto-extraction of code blocks and skills from agent output
- Smart truncation for context preservation between phases
- Results.tsv experiment logging (Karpathy autoresearch pattern)
- 6 adapters: Claude Code, Aider, Gemini CLI, Ollama, Custom
- Real-time web dashboard with Hono + WebSocket
- Task spec system with YAML frontmatter + markdown
- 6 example task specs
- CLI: init, run, status, dashboard commands
- GitHub Actions CI for Node 20/22
- MIT license
