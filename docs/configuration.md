# Configuration Reference

Toryo is configured via a `toryo.config.json` file in your project root. This document covers every field in the configuration schema.

## Full Schema

```json
{
  "name": "my-project",
  "agents": { ... },
  "tasks": "./specs/",
  "rotation": ["researcher", "coder"],
  "ratchet": { ... },
  "delegation": { ... },
  "outputDir": ".toryo",
  "notifications": { ... },
  "phases": ["plan", "research", "execute", "review"]
}
```

## Top-Level Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | `string` | -- | Project name. Used in notifications and dashboard display. |
| `agents` | `Record<string, AgentProfile>` | *required* | Agent definitions keyed by agent ID. |
| `tasks` | `string \| TaskSpec[]` | *required* | Path to specs directory (e.g., `"./specs/"`) or an inline array of task objects. |
| `rotation` | `string[]` | -- | Task rotation order. Agent IDs or `"all"`. If omitted, tasks are rotated round-robin by cycle number. |
| `ratchet` | `RatchetConfig` | See below | Quality gate settings. |
| `delegation` | `DelegationConfig` | See below | Trust-based delegation settings. |
| `outputDir` | `string` | `".toryo"` | Directory for results, metrics, artifacts, and extracted code. |
| `notifications` | `NotificationConfig` | `none` | Push notification settings. |
| `phases` | `string[]` | `["plan", "research", "execute", "review"]` | Which phases to run per cycle. You can remove phases (e.g., skip `research`) or define custom phase names. |

## Agent Configuration

Each entry in the `agents` record defines an agent that Toryo can delegate work to.

```json
{
  "agents": {
    "researcher": {
      "adapter": "claude-code",
      "model": "claude-sonnet-4-6",
      "strengths": ["research", "analysis", "summarization", "finding"],
      "weaknesses": ["code_writing"],
      "timeout": 900,
      "tools": ["web_search", "file_read"]
    }
  }
}
```

### AgentProfile Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `adapter` | `string` | Yes | Adapter name: `claude-code`, `aider`, `gemini-cli`, `codex`, `ollama`, or `custom`. |
| `model` | `string` | No | Model identifier passed to the adapter. Examples: `claude-sonnet-4-6`, `qwen3.5:27b`, `gpt-4o`. If omitted, the adapter uses its default. |
| `strengths` | `string[]` | Yes | Keywords the delegation system uses to match this agent to tasks. Common values: `research`, `analysis`, `code`, `architecture`, `testing`, `review`, `scoring`, `quality`, `security`, `design`. |
| `weaknesses` | `string[]` | No | Keywords for what the agent is not suited for. Currently informational. |
| `timeout` | `number` | Yes | Maximum seconds before the agent process is killed. Typical values: 300-900 for cloud models, 600-1800 for local models. |
| `tools` | `string[]` | No | List of tools/capabilities available to this agent. Currently informational. |

### Strengths and Delegation

The delegation system profiles each incoming task by scanning its description and acceptance criteria for keywords in these categories:

- **plan**: `plan`, `planning`, `architect`, `design`, `strategy`
- **research**: `research`, `analysis`, `search`, `investigate`, `find`
- **code**: `code`, `coding`, `implement`, `build`, `develop`, `test`
- **review**: `review`, `score`, `quality`, `audit`, `check`, `qa`

It then matches the dominant task dimension to agents whose `strengths` array contains overlapping terms.

## Ratchet Configuration

Controls the quality gate that decides whether to keep or revert each cycle's output.

```json
{
  "ratchet": {
    "threshold": 6.0,
    "maxRetries": 1,
    "gitStrategy": "commit-revert"
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `threshold` | `number` | `6.0` | Minimum QA score (out of 10) to keep the cycle's output. Scores below this trigger a revert. |
| `maxRetries` | `number` | `1` | Maximum number of Ralph Loop retries before discarding. Set to `0` to disable retries. |
| `gitStrategy` | `string` | `"commit-revert"` | How git is used for quality gating. |

### Git Strategies

| Strategy | Behavior |
|----------|----------|
| `commit-revert` | Commits before QA review. If QA fails, runs `git reset HEAD~1 --hard` to revert. If QA passes, the commit stays. |
| `branch-per-task` | Creates a branch named `toryo/<task-slug>` for each task. If QA passes, you can merge manually. If QA fails, the branch is deleted (`git branch -D`). |
| `none` | No git operations. Output is still saved to `outputDir` but nothing is committed or reverted. |

## Delegation Configuration

Controls how agents earn trust and autonomy over time.

```json
{
  "delegation": {
    "initialTrust": 0.5,
    "scoreWindow": 50,
    "levels": {
      "supervised": { "trustRange": [0, 0.6], "minTasks": 0 },
      "guided": { "trustRange": [0.6, 0.8], "minTasks": 5 },
      "autonomous": { "trustRange": [0.8, 1.0], "minTasks": 10 }
    }
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `initialTrust` | `number` | `0.5` | Starting trust score for new agents (0.0 to 1.0). Used until the agent has completed at least 3 tasks. |
| `scoreWindow` | `number` | `50` | Number of most recent scores to keep in the rolling window for computing average score and trust. |
| `levels` | `object` | See below | Defines the trust ranges and minimum task counts for each autonomy level. |

### Autonomy Level Configuration

Each level has:

| Field | Type | Description |
|-------|------|-------------|
| `trustRange` | `[number, number]` | Minimum and maximum trust score for this level. |
| `minTasks` | `number` | Minimum number of completed tasks before an agent can reach this level. |

Default levels:

| Level | Trust Range | Min Tasks | Behavior |
|-------|------------|-----------|----------|
| `supervised` | 0.0 -- 0.6 | 0 | Agent follows instructions precisely. No deviation from the task description. |
| `guided` | 0.6 -- 0.8 | 5 | Agent follows the spec but may suggest improvements and propose alternatives. |
| `autonomous` | 0.8 -- 1.0 | 10 | Agent takes initiative, makes decisions independently, reports results after. |

Trust is computed as `min(avg_score / 10, 1.0)` once the agent has completed at least 3 tasks. Before that, `initialTrust` is used.

## Notification Configuration

```json
{
  "notifications": {
    "provider": "ntfy",
    "target": "my-toryo-project",
    "events": ["breakthrough", "failure", "status"]
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `provider` | `string` | `"none"` | Notification provider. One of: `ntfy`, `slack`, `discord`, `webhook`, `none`. |
| `target` | `string` | `""` | Provider-specific target. See table below. |
| `events` | `string[]` | `[]` | Which events trigger notifications. |

### Provider Targets

| Provider | Target Value | Notes |
|----------|-------------|-------|
| `ntfy` | Topic name (e.g., `my-toryo-project`) or full URL (e.g., `https://ntfy.sh/my-topic`) | Uses ntfy.sh by default. Install the ntfy app on your phone to receive push notifications. |
| `slack` | Slack incoming webhook URL | Posts messages as `*title*\nbody`. |
| `discord` | Discord webhook URL | Posts messages as `**title**\nbody`. |
| `webhook` | Any HTTP endpoint URL | POSTs JSON `{ title, body, priority }`. |
| `none` | -- | Notifications disabled. |

### Notification Events

| Event | Triggers When |
|-------|--------------|
| `breakthrough` | A review score is >= 9.0. Sent with high priority. |
| `failure` | A review score is below the ratchet threshold. |
| `crash` | An infrastructure failure occurs (timeout, connection refused, etc.). Sent with high priority. |
| `status` | Every 5th cycle (periodic summary). |
| `cycle_complete` | Every cycle completes. |

## Output Directory

The `outputDir` (default: `.toryo`) stores all persistent data:

```
.toryo/
  metrics.json      # Global metrics (cycles, success rate, per-agent stats)
  results.tsv       # Tab-separated log of every cycle result
  output/           # Extracted code blocks from agent output
  artifacts/        # Full agent outputs saved as markdown
  skills/           # Extracted SKILL.md files
```

## CLI Flags Reference

| Command | Flag | Description |
|---------|------|-------------|
| `toryo run` | `--config, -c <path>` | Path to config file (default: `./toryo.config.json`) |
| `toryo run` | `--cycles, -n <N>` | Max cycles to run (default: unlimited) |
| `toryo run` | `--task, -t <id>` | Run only the task matching this ID (substring match) |
| `toryo run` | `--dry-run` | Preview config and task rotation without executing |
| `toryo check` | `--config, -c <path>` | Validate config, check tools installed, list specs |
| `toryo status` | `--config, -c <path>` | Show metrics, agent trust levels, recent results |
| `toryo dashboard` | `--config, -c <path>` | Open real-time web dashboard at http://localhost:3100 |
| `toryo init` | — | Auto-detect tools and generate config + example spec |

## Example Configurations

### All-Claude Setup

Every agent uses Claude Code with different models:

```json
{
  "name": "my-project",
  "agents": {
    "planner": {
      "adapter": "claude-code",
      "model": "claude-sonnet-4-6",
      "strengths": ["planning", "design", "architecture"],
      "timeout": 600
    },
    "coder": {
      "adapter": "claude-code",
      "model": "claude-sonnet-4-6",
      "strengths": ["code", "implementation", "testing"],
      "timeout": 900
    },
    "reviewer": {
      "adapter": "claude-code",
      "model": "claude-sonnet-4-6",
      "strengths": ["review", "quality", "scoring"],
      "timeout": 600
    }
  },
  "tasks": "./specs/",
  "ratchet": { "threshold": 7.0, "maxRetries": 1, "gitStrategy": "commit-revert" },
  "delegation": { "initialTrust": 0.5, "scoreWindow": 50, "levels": {
    "supervised": { "trustRange": [0, 0.6], "minTasks": 0 },
    "guided": { "trustRange": [0.6, 0.8], "minTasks": 5 },
    "autonomous": { "trustRange": [0.8, 1.0], "minTasks": 10 }
  }},
  "outputDir": ".toryo"
}
```

### All-Local Setup (Ollama)

Everything runs locally on your GPU, zero API costs:

```json
{
  "name": "local-project",
  "agents": {
    "researcher": {
      "adapter": "ollama",
      "model": "qwen3.5:27b",
      "strengths": ["research", "analysis"],
      "timeout": 1200
    },
    "coder": {
      "adapter": "ollama",
      "model": "qwen3-coder:30b",
      "strengths": ["code", "implementation", "testing"],
      "timeout": 1800
    },
    "reviewer": {
      "adapter": "ollama",
      "model": "qwen3.5:27b",
      "strengths": ["review", "scoring", "quality"],
      "timeout": 900
    }
  },
  "tasks": "./specs/",
  "ratchet": { "threshold": 5.0, "maxRetries": 2, "gitStrategy": "commit-revert" },
  "delegation": { "initialTrust": 0.5, "scoreWindow": 50, "levels": {
    "supervised": { "trustRange": [0, 0.6], "minTasks": 0 },
    "guided": { "trustRange": [0.6, 0.8], "minTasks": 5 },
    "autonomous": { "trustRange": [0.8, 1.0], "minTasks": 10 }
  }},
  "outputDir": ".toryo"
}
```

Note: local models may need lower `threshold` values and higher `timeout` values than cloud models.

### Hybrid Setup (Cloud + Local)

Use cloud models for tasks needing broad knowledge, local models for code generation:

```json
{
  "name": "hybrid-project",
  "agents": {
    "researcher": {
      "adapter": "claude-code",
      "model": "claude-sonnet-4-6",
      "strengths": ["research", "analysis", "summarization"],
      "weaknesses": ["code_writing"],
      "timeout": 900
    },
    "coder": {
      "adapter": "ollama",
      "model": "qwen3.5:27b",
      "strengths": ["code", "architecture", "testing", "implementation"],
      "weaknesses": ["web_search"],
      "timeout": 900
    },
    "reviewer": {
      "adapter": "claude-code",
      "model": "claude-sonnet-4-6",
      "strengths": ["review", "scoring", "quality", "security"],
      "timeout": 600
    }
  },
  "tasks": "./specs/",
  "ratchet": { "threshold": 6.0, "maxRetries": 1, "gitStrategy": "commit-revert" },
  "delegation": { "initialTrust": 0.5, "scoreWindow": 50, "levels": {
    "supervised": { "trustRange": [0, 0.6], "minTasks": 0 },
    "guided": { "trustRange": [0.6, 0.8], "minTasks": 5 },
    "autonomous": { "trustRange": [0.8, 1.0], "minTasks": 10 }
  }},
  "outputDir": ".toryo",
  "notifications": {
    "provider": "ntfy",
    "target": "my-toryo-project",
    "events": ["breakthrough", "failure", "status"]
  }
}
```
