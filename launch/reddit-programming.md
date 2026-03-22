# Reddit r/programming Post

## Title
The Ratchet Pattern: Using git commit/revert as a quality floor for AI coding agents

## Body

I've been experimenting with a pattern for AI-assisted development that I think is underexplored: **quality ratcheting**.

The idea is simple: treat `git commit` as a quality gate and `git revert` as a safety net.

```
Agent produces output → QA scores it (1-10)
Score ≥ threshold → git commit ✓ (keep)
Score < threshold → git revert → retry with feedback
```

Your codebase can only move forward. Bad output is automatically reverted before it accumulates. This is borrowed from Karpathy's autoresearch pattern (results.tsv, NEVER STOP), combined with the Ralph Loop (verify-then-retry).

**Why this matters:** Most AI coding tools have no quality feedback loop. The agent writes code, you review it manually, maybe it's good, maybe it's not. There's no systematic way to say "this didn't meet the bar, try again with this specific feedback."

The ratchet pattern adds three things:
1. **Automated QA scoring** — a reviewer agent scores output
2. **Automatic revert on failure** — bad code never stays
3. **Feedback-driven retry** — QA comments feed back to the agent

I built this into a tool called [Toryo](https://github.com/JesseRWeigel/toryo) that orchestrates multiple AI CLIs (Claude Code, Aider, Ollama, etc.) with this pattern. Over 50+ continuous test cycles, the retry mechanism recovered initially-failing output ~40% of the time (e.g., 2/10 → 8/10 after retry).

The tool also tracks trust scores per agent — agents that consistently score high earn more autonomy. Agents that score low get demoted to supervised mode.

Curious what others think about the ratchet pattern as an approach to AI-assisted development quality control.
