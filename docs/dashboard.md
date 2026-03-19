# Dashboard Guide

Toryo includes a real-time web dashboard for monitoring your orchestration cycles, agent performance, and live events.

## Starting the Dashboard

```bash
npx toryo dashboard
```

Or with a specific config file:

```bash
npx toryo dashboard --config ./my-config.json
```

The dashboard starts at `http://localhost:3100` by default.

## Customizing the Port

Set the `TORYO_DASH_PORT` environment variable:

```bash
TORYO_DASH_PORT=8080 npx toryo dashboard
```

## Architecture

The dashboard is a single-page application served by a Hono HTTP server with WebSocket support:

- **HTTP server** -- serves the dashboard HTML and REST API endpoints
- **WebSocket** -- pushes real-time updates to connected clients
- **File watcher** -- uses chokidar to watch `metrics.json` and `results.tsv` in your output directory for changes

When the orchestrator writes new data to the output directory, the file watcher detects the change and broadcasts a full state update to all connected WebSocket clients.

## What Each Panel Shows

### Metrics Row

Four summary cards across the top:

| Card | Source | Description |
|------|--------|-------------|
| **Cycles Completed** | `metrics.json` | Total number of completed cycles |
| **Total Tasks** | `metrics.json` | Number of task executions (cycles that ran) |
| **Success Rate** | `metrics.json` | Percentage of cycles that resulted in `keep` |
| **Avg Score** | Computed | Weighted average score across all agents (weighted by tasks completed) |

### Agent Status

A grid of cards, one per agent. Each card shows:

- **Agent name** (the ID from your config)
- **Adapter** name
- **Autonomy badge** -- color-coded level indicator:
  - Red: Supervised
  - Yellow: Guided
  - Green: Autonomous
- **Trust** -- current trust score (0.00 to 1.00)
- **Tasks** -- number of completed tasks
- **Avg Score** -- rolling average score, color-coded (green >= 7, yellow >= 5, red < 5)
- **Success** -- success rate percentage

The top border of each agent card is colored by autonomy level for quick visual scanning.

### Results Table

A sortable table of all cycle results from `results.tsv`:

| Column | Description |
|--------|-------------|
| Cycle | Cycle number |
| Task | Task ID |
| Agent | Which agent executed |
| Score | QA score (color-coded) |
| Status | `keep`, `discard`, `crash`, or `skip` (color-coded) |
| Description | Human-readable result summary |

Click any column header to sort. Click again to reverse the sort direction. Rows have a colored left border indicating status (green for keep, red for discard, gray for crash, yellow for skip).

### Live Event Feed

A scrolling feed of real-time events (most recent at top, capped at 200 entries). Events include:

| Event Type | Color | Description |
|------------|-------|-------------|
| `cycle:start` | Cyan | A new cycle has begun |
| `phase:start` | Blue | A phase is starting (includes agent name) |
| `phase:complete` | Blue | A phase finished (includes duration) |
| `review:complete` | Yellow | QA review completed (includes score and verdict) |
| `ratchet:keep` | Green | Output accepted and committed |
| `ratchet:revert` | Red | Output rejected and reverted |
| `ralph:retry` | Yellow | Ralph Loop retry initiated |
| `cycle:complete` | Cyan | Full cycle completed (includes final verdict) |
| `metrics:update` | Gray | Metrics file refreshed |
| `state:full` | Gray | Full state refresh from file watcher |

## WebSocket Real-Time Updates

The dashboard connects to the server via WebSocket at `/ws`. The connection flow:

1. On page load, the client fetches initial data via REST (`GET /api/metrics` and `GET /api/results`).
2. A WebSocket connection is established to `/ws`.
3. When files change in the output directory, the server broadcasts a `state:full` message containing the latest metrics and results.
4. A heartbeat ping is sent every 30 seconds to keep the connection alive.

If the WebSocket disconnects, the client automatically reconnects after 2 seconds. The connection status indicator in the top-right corner shows:

- Green dot + "Connected" -- WebSocket is active
- Red dot + "Disconnected" -- WebSocket is down, reconnecting

## REST API

The dashboard server exposes two REST endpoints that you can query independently:

```bash
# Get current metrics
curl http://localhost:3100/api/metrics

# Get all results
curl http://localhost:3100/api/results
```

## Running Alongside the Orchestrator

The dashboard and orchestrator run as separate processes. Start them in different terminals:

```bash
# Terminal 1: Run the orchestrator
npx toryo run

# Terminal 2: Run the dashboard
npx toryo dashboard
```

Both processes read from and write to the same output directory. The dashboard's file watcher picks up changes as the orchestrator writes them.

## Output Directory

The dashboard watches the configured `outputDir` (from your `toryo.config.json`). Specifically, it monitors:

- `<outputDir>/metrics.json` -- for metric updates
- `<outputDir>/results.tsv` -- for new cycle results

If the output directory does not exist yet (e.g., before the first cycle runs), the dashboard starts without file watching and logs a message. Once the orchestrator creates the directory and files, the dashboard picks them up on the next change.
