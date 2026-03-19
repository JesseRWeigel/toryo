# Core Concepts

This document explains the key ideas behind Toryo's architecture: the cycle model, quality ratcheting, the Ralph Loop, trust-based delegation, auto-extraction, smart truncation, and results tracking.

## The 4-Phase Cycle

Every Toryo cycle follows a pipeline of phases:

```
Plan --> Research --> Execute --> Review
```

Each phase is assigned to an agent (either explicitly in the spec or automatically by the delegation system) and produces output that feeds into the next phase.

### Plan

The planning agent reads the task spec and creates an approach. This phase is about strategy, not execution. The output typically includes:

- What to do and in what order
- Which files or modules to focus on
- Potential challenges and how to handle them

### Research

The research agent gathers context and information needed for execution. Output includes:

- Relevant code snippets and file contents
- API documentation or patterns
- Prior art or existing implementations

### Execute

The execution agent does the actual work: writing code, tests, documentation, or whatever the spec calls for. This is the phase whose output gets committed (or reverted) by the ratchet system.

### Review

The review agent scores the execution output on a 1-10 scale and provides feedback. The review prompt includes:

- The original task description and acceptance criteria
- The execution output (truncated for context)
- A scoring rubric:
  - **9-10:** Exceptional. Exceeds all criteria. Production-ready.
  - **7-8:** Good. Meets criteria with minor issues.
  - **5-6:** Acceptable. Meets basic criteria but needs improvement.
  - **3-4:** Below standard. Missing key criteria.
  - **1-2:** Poor. Fundamentally flawed.

The review agent must respond with a score as `X/10`, a verdict (`PASS`, `NEEDS_REVISION`, or `FAIL`), and specific feedback.

### Phase Flow

Output from each phase is passed to the next as context, under a "Context from previous phase" heading. This chaining ensures each agent builds on the previous work rather than starting from scratch.

You can customize which phases run via the top-level `phases` config:

```json
{
  "phases": ["plan", "execute", "review"]
}
```

This skips the research phase entirely. You can also define custom phase names beyond the four built-ins.

## Quality Ratcheting

Inspired by [Karpathy's autoresearch](https://github.com/karpathy/autoresearch) pattern: **only forward progress gets committed. Bad results are automatically reverted.**

### The Flow

```
Execute phase complete
        |
        v
  git commit (pre-QA snapshot)
        |
        v
  Review phase scores the output
        |
        +---> Score >= threshold ---> KEEP (commit stays)
        |
        +---> Score < threshold ---> git reset --hard HEAD~1
                                           |
                                           v
                                     Ralph Loop retry
                                           |
                                     +---> Retry passes ---> git commit + KEEP
                                     |
                                     +---> Retry fails  ---> DISCARD
```

### How It Works

1. After the plan/research/execute phases complete, Toryo creates a git commit with the message `toryo cycle-N: task-id`.
2. The review agent scores the output.
3. If the score meets or exceeds the threshold (default 6.0), the commit is kept.
4. If the score is below the threshold, Toryo runs `git reset HEAD~1 --hard` to revert the commit, then enters the Ralph Loop.
5. After all retries are exhausted, the cycle is marked as `discard` if it never passed.

### Git Strategies

| Strategy | On Keep | On Revert |
|----------|---------|-----------|
| `commit-revert` | Commit stays on current branch | `git reset HEAD~1 --hard` |
| `branch-per-task` | Branch `toryo/<task-slug>` stays for manual merge | Branch is deleted with `git branch -D` |
| `none` | No git operations | No git operations |

### Infrastructure Failures

If the underlying process crashes, times out, or hits a connection error, the cycle is marked as `crash` instead of being scored. Infrastructure failure patterns detected include:

- Session lock conflicts
- Gateway closed errors
- `ETIMEDOUT` / `ECONNREFUSED`
- Context window exceeded

Crashes are logged to `results.tsv` but do not affect agent trust scores.

## Ralph Loop

The Ralph Loop is a **verify-then-retry** pattern inspired by [vercel-labs/ralph-loop-agent](https://github.com/vercel-labs/ralph-loop-agent). When a cycle's output fails QA, the agent gets another chance -- but this time with the reviewer's feedback.

### How It Works

1. The review phase returns a score below the threshold and feedback about what went wrong.
2. Toryo builds a **retry prompt** that includes:
   - "Your previous attempt was reviewed and needs revision."
   - The QA feedback from the reviewer
   - The original task description
   - The instruction: "Address the feedback above and produce an improved version."
3. The execute agent runs again with this enriched prompt.
4. After the retry, a new commit is created and the review phase runs again.
5. If the retry passes, the cycle is marked `keep`. If it fails, the commit is reverted.

### Retry Limits

The `maxRetries` config (default: 1) controls how many retry attempts are allowed. After all retries are exhausted without passing, the cycle is discarded.

Setting `maxRetries: 0` disables the Ralph Loop entirely -- failed cycles are immediately discarded.

## Trust-Based Delegation

Toryo's delegation system assigns tasks to agents based on capability matching and earned trust. This is inspired by the [Intelligent AI Delegation](https://arxiv.org/abs/2602.11865) framework.

### Trust Score

Trust is a value from 0.0 to 1.0, computed from the agent's rolling average QA score:

```
trust = min(avg_score / 10.0, 1.0)
```

For agents with fewer than 3 completed tasks, trust falls back to the `initialTrust` config value (default: 0.5).

The rolling average uses a configurable window (default: 50 scores). Only the most recent N scores are kept, so an agent's trust reflects recent performance, not lifetime history.

### Autonomy Levels

Based on their trust score and number of completed tasks, agents are assigned one of three autonomy levels:

| Level | Default Trust Range | Default Min Tasks | Prompt Prefix |
|-------|-------------------|-------------------|---------------|
| **Supervised** | 0.0 -- 0.6 | 0 | "Follow instructions precisely. Do not deviate from the task description. Use exact formats specified. Flag any uncertain decisions." |
| **Guided** | 0.6 -- 0.8 | 5 | "Follow the spec but suggest improvements. You may propose alternatives if you see a better approach. Flag decisions that deviate from the original plan." |
| **Autonomous** | 0.8 -- 1.0 | 10 | "Take initiative and be creative. You have earned trust through consistent high-quality work. Make decisions independently. Report results after action." |

Both conditions (trust range AND minimum tasks) must be met for promotion. An agent with trust 0.9 but only 3 completed tasks stays at `guided` (or `supervised` if it has fewer than 5 tasks).

### Task Profiling

When a task comes in, the delegation system profiles it by scanning the task name, description, and acceptance criteria for keyword patterns:

| Dimension | Keywords |
|-----------|----------|
| **Research needed** | research, find, search, analyze, investigate, survey, compare |
| **Code needed** | implement, code, build, write, create, function, class, test |
| **Review needed** | review, audit, check, verify, validate, assess, score |
| **Creativity** | design, creative, novel, explore, brainstorm, innovate |
| **Risk** | refactor, migrate, delete, remove, replace, breaking |
| **Verifiability** | test, verify, benchmark, measure, assert, expect |

The profile produces a score (0.0 to 1.0) for each dimension. The dominant dimension determines which type of agent to select.

### Agent Selection

The delegation system:

1. Profiles the task and ranks dimensions by score.
2. For each dimension (highest first), looks for an agent whose `strengths` array contains synonyms for that dimension.
3. Skips agents with very low trust (< 0.4) if they have completed 5+ tasks.
4. Returns the first matching agent, or falls back to the first agent in the config.

For phase-aware selection (when a phase is set to `auto`), the system adds a phase hint to the task description before profiling:

- **plan**: "plan and design the approach"
- **research**: "research and analyze information"
- **execute**: "implement and write code"
- **review**: "review and score output quality"

This biases the selection toward agents with matching strengths for each phase.

### State Updates

After each cycle, the executing agent's state is updated:

1. The new score is appended to the rolling window (capped at `scoreWindow` size).
2. The average score is recalculated.
3. The trust score is recomputed.
4. The autonomy level is re-evaluated.

An agent that consistently scores 8+/10 earns autonomous mode. An agent that drops below threshold gets demoted back to supervised.

## Auto-Extraction

Toryo automatically extracts useful content from agent outputs and saves it to disk.

### What Gets Extracted

| Type | Detection | Where Saved |
|------|-----------|-------------|
| **Code blocks** | Fenced code blocks (` ``` `) with 20+ lines and a language identifier | `<outputDir>/output/<taskId>_<index>.<ext>` |
| **Skills** | Markdown code blocks with YAML frontmatter containing `name:` and `description:` | `<outputDir>/skills/<skill-name>/SKILL.md` |
| **Artifacts** | Full agent output >= 3000 characters | `<outputDir>/artifacts/<taskId>-<timestamp>.md` |

### Code Block Processing

- Only code blocks with a recognized language (not `text`) and at least 20 lines are saved (configurable via `minCodeLines`).
- Language detection maps to file extensions: `typescript` -> `.ts`, `python` -> `.py`, `rust` -> `.rs`, etc.
- Multiple code blocks from the same phase are numbered sequentially: `task_0.ts`, `task_1.ts`, etc.

### Skill Detection

A code block is detected as a skill if it:
1. Has the language identifier `markdown`
2. Contains YAML frontmatter (`---` delimiters)
3. Contains both `name:` and `description:` fields

Skills are saved under `<outputDir>/skills/<skill-name>/SKILL.md`.

### Extraction Events

Each saved extraction emits an `extraction:saved` event, visible in the CLI output and dashboard.

## Smart Truncation

When output from one phase is fed into the next, it goes through smart truncation to stay within context budgets.

### How It Works

The `truncateForPhase` function (default limit: 6000 characters):

1. **Strips boilerplate** -- removes common LLM opening lines like "Here is the...", "As requested...", "Certainly...", and empty leading lines.
2. **Head/tail split** -- if the content still exceeds the limit, it keeps 60% from the start and 35% from the end, with a `[... truncated for context ...]` marker in between.

This preserves:
- The beginning (context, setup, key decisions)
- The end (conclusions, final output, recent work)

While dropping the middle (often repetitive or less critical).

### When Truncation Happens

- **Between phases**: The previous phase's output is truncated before being appended to the next phase's prompt.
- **Review prompt**: The execute output is truncated before being included in the review prompt.

## Results.tsv Format

Every cycle result is logged to `<outputDir>/results.tsv` in tab-separated format, following the [Karpathy autoresearch](https://github.com/karpathy/autoresearch) pattern.

### Columns

| Column | Type | Description |
|--------|------|-------------|
| `timestamp` | ISO 8601 string | When the cycle completed |
| `cycle` | integer | Cycle number |
| `task` | string | Task ID from the spec |
| `agent` | string | Agent ID that executed the task (or `system` for crashes) |
| `score` | float | QA score (0.0 for crashes) |
| `status` | string | `keep`, `discard`, `crash`, or `skip` |
| `description` | string | Human-readable summary of the result |

### Example

```
timestamp	cycle	task	agent	score	status	description
2026-03-19T10:15:00Z	1	write-tests	coder	8.2	keep	QA approved: PASS
2026-03-19T10:45:00Z	2	code-review	coder	4.1	discard	QA rejected: FAIL
2026-03-19T11:15:00Z	3	refactor	coder	7.5	keep	QA approved after retry 1: PASS
2026-03-19T11:30:00Z	4	write-tests	coder	0.0	crash	Infrastructure failure: ETIMEDOUT
```

### Metrics File

In addition to `results.tsv`, Toryo maintains `<outputDir>/metrics.json` with aggregated statistics:

```json
{
  "cyclesCompleted": 42,
  "totalTasks": 42,
  "successRate": 0.76,
  "agents": {
    "coder": {
      "agentId": "coder",
      "tasksCompleted": 42,
      "avgScore": 7.2,
      "scores": [8.2, 4.1, 7.5, ...],
      "successRate": 0.76
    }
  }
}
```

This file is updated after every cycle and used by the `toryo status` command and the dashboard.
