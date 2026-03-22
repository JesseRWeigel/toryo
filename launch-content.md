# Toryo Launch Content — Draft 2026-03-22

---

## 1. Hacker News — Show HN

**Title:** Show HN: Toryo – An agent harness that uses git commit/revert as a quality ratchet

**Body text:**

Hi HN. I built Toryo (https://github.com/JesseRWeigel/toryo), an open-source TypeScript orchestrator for AI coding agents.

The core idea: treat agent output like a construction project. Every cycle goes through plan → research → execute → review. If QA scores the result above threshold, it gets `git commit`. Below threshold, it gets `git revert` and the agent gets one retry with structured feedback (we call this the Ralph Loop, after vercel-labs/ralph-loop-agent). The codebase can only move forward. We call this "ratcheting" — borrowed from Karpathy's autoresearch pattern.

What makes it different from other multi-agent tools:

- **Heterogeneous agents** — mix Claude Code, Aider, Gemini CLI, Ollama, or any CLI tool in the same workflow. Each agent is a pluggable adapter.
- **Trust-based delegation** — agents start supervised and earn autonomy through consistent scores. An agent averaging 8+/10 gets creative freedom. An agent dropping below 6 gets demoted to strict instruction-following.
- **Local-first** — native Ollama adapter hits the HTTP API directly. No cloud dependency required.
- **Spec-driven** — tasks are markdown files with YAML frontmatter. The orchestrator rotates through them.

The project grew out of running an autonomous agent team for several weeks (49+ continuous watchdog cycles). The patterns that survived — ratcheting, trust scoring, retry-with-feedback, auto-extraction of code from output — got extracted into this standalone tool.

Architecture: TypeScript monorepo with npm workspaces. `toryo-core` (engine), `toryo-adapters` (6 adapters), `@jweigel/toryo` (CLI). 235 tests. MIT licensed.

```
npx @jweigel/toryo init    # scaffolds config, detects installed tools
npx @jweigel/toryo run     # starts orchestration
```

Anthropic recently published their "Effective Harnesses for Long-Running Agents" post describing a two-agent harness with git-based progress tracking. Toryo is essentially that pattern generalized — N agents, M tools, with delegation and quality gates.

Happy to answer questions about the ratcheting pattern, trust mechanics, or what broke during those 49 cycles.

---

## 2. Reddit r/LocalLLaMA

**Title:** I built an open-source agent orchestrator with a native Ollama adapter — quality ratcheting means only good output survives

**Body:**

I've been running local models (qwen3.5:27b on an RTX 5090) as part of an autonomous agent team for weeks. The biggest problem wasn't generation quality — it was that bad output would accumulate and poison the codebase. One hallucinated import or broken refactor, and everything downstream falls apart.

So I built **Toryo** (https://github.com/JesseRWeigel/toryo) — an orchestrator that treats agent output like construction work that gets inspected before it stays in the building.

**How it works:**

Every cycle runs 4 phases: plan → research → execute → review. The review phase scores output 1-10. Score above threshold → `git commit`. Below → `git revert`, then one retry with structured feedback. The codebase literally cannot regress.

**Why local-first matters here:**

The Ollama adapter hits your local HTTP API directly — no CLI wrapper, no cloud proxy. You configure it like:

```json
{
  "coder": {
    "adapter": "ollama",
    "model": "qwen3.5:27b",
    "strengths": ["code", "architecture"],
    "timeout": 900
  }
}
```

You can mix local and cloud agents in the same workflow. Use Claude Code for planning (it's better at high-level reasoning), Ollama for code generation (free, fast, private), and whatever you want for review. The trust system tracks each agent independently — your local model earns its own trust score based on QA results.

**What's in the box:**
- 6 adapters: Claude Code, Aider, Gemini CLI, Ollama, Codex, Custom (any CLI)
- Trust-based delegation — agents earn autonomy (supervised → guided → autonomous)
- Quality ratcheting — git commit/revert based on scores
- Ralph Loop — retry with QA feedback before discarding
- Real-time dashboard (Hono + WebSocket)
- Results tracking in TSV format
- 235 tests, TypeScript, MIT licensed

```bash
npx @jweigel/toryo init
npx @jweigel/toryo run
```

Running qwen3.5:27b through this loop with a Claude Code reviewer, I've seen the local model consistently score 7-8/10 on code tasks once the trust system warms up — the ratchet discards the 4-5/10 outputs that would otherwise pollute your project.

GitHub: https://github.com/JesseRWeigel/toryo

Interested in hearing what models/hardware combos people would run with this. The adapter system is pluggable so adding new backends is ~50 lines.

---

## 3. Reddit r/programming

**Title:** The ratchet pattern: using git commit/revert as a quality floor for autonomous AI agents

**Body:**

I want to share an engineering pattern I've been using for autonomous agent orchestration that I think is underappreciated: **quality ratcheting via git**.

**The problem:** When you run AI agents autonomously for extended periods (hours, days), output quality varies wildly. A 30% failure rate means your codebase accumulates broken code that subsequent cycles build on top of, compounding failures.

**The ratchet pattern:**

1. Before each agent cycle, note the current git HEAD
2. Agent does its work (writes code, tests, docs)
3. A separate review agent scores the output 1-10
4. Score >= threshold → `git commit` with structured message
5. Score < threshold → `git revert` to the saved HEAD

The codebase can only move forward. Like a ratchet wrench — it turns one way.

**Adding retry (the Ralph Loop):**

Plain ratcheting is wasteful — you throw away partial progress. The Ralph Loop (named after vercel-labs/ralph-loop-agent) adds one step: before reverting, feed the QA feedback back to the agent and let it try once more. In practice this recovers ~30% of failures.

```
Score >= 6.0 → git commit
Score <  6.0 → extract feedback → retry with context
                  ↓
              Retry passes → git commit
              Retry fails  → git revert, move on
```

**Trust-based delegation:**

The other pattern that emerged: not all agents deserve the same level of freedom. New or unreliable agents get verbose, structured prompts ("follow this spec exactly"). Agents that consistently score 8+/10 get shorter prompts with creative latitude ("implement this however you think is best, report when done"). Trust = rolling average of scores. This maps naturally to a supervised → guided → autonomous progression.

**Implementation:**

I extracted these patterns into an open-source tool called [Toryo](https://github.com/JesseRWeigel/toryo). TypeScript, 235 tests, works with any CLI-based AI tool (Claude Code, Aider, Gemini CLI, Ollama, etc.). But the patterns themselves are tool-agnostic — you could implement ratcheting in a bash script with `git rev-parse HEAD` and `git revert`.

The patterns came from Karpathy's autoresearch (ratcheting + results.tsv), Anthropic's harness engineering post (two-agent loops with git-based progress), and the Intelligent AI Delegation paper (trust scoring).

Interested in hearing if anyone else has converged on similar patterns.

---

## 4. Dev.to Article

**Title:** The Ratchet Pattern: How git commit/revert creates a quality floor for AI agents

**Tags:** ai, devops, git, opensource

---

You're running an AI coding agent overnight. You wake up to 47 commits. Some are great. Some introduced subtle bugs. Some broke the build entirely. The good ones built on top of the bad ones, so you can't just revert the failures — everything is entangled.

This is the fundamental problem with autonomous AI agents: **they have no quality floor.**

A human developer has one. It's called "I won't push code I know is broken." Agents don't have that instinct. They produce output and move on.

### The ratchet

A ratchet wrench turns freely in one direction but locks against backward motion. We can give agents the same property using git:

```
1. Save current HEAD
2. Agent works (writes code, tests, docs)
3. Separate reviewer scores the output (1-10)
4. Score >= threshold → git commit (keep)
5. Score <  threshold → git revert to saved HEAD (discard)
```

After this, the codebase can only contain work that passed review. Bad output literally doesn't exist in the git history. The quality floor is enforced mechanically, not by hoping the agent "tries harder."

This pattern comes from [Karpathy's autoresearch](https://github.com/karpathy/autoresearch) project, which uses it for research experiment tracking. Anthropic's engineering team [described a similar approach](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) for long-running agent harnesses.

### The cost of pure ratcheting

Ratcheting alone is wasteful. If an agent writes 200 lines of code and gets one import wrong, you revert all 200 lines. The baby goes out with the bathwater.

### Adding retry: the Ralph Loop

The [Ralph Loop](https://github.com/vercel-labs/ralph-loop-agent) (verify-then-retry) adds a feedback step before giving up:

```
Score >= threshold → git commit ✓

Score <  threshold → extract structured feedback
                     ↓
                   Feed feedback back to the agent
                   "What went wrong: missing import for DateTime"
                   "Key instructions: fix the import, run tests"
                     ↓
                   Agent retries with context
                     ↓
                   Score >= threshold → git commit ✓
                   Score <  threshold → git revert, move on
```

In practice, this recovers roughly 30% of failures. The agent already did 90% of the work correctly — it just needs a nudge.

### Trust as a dial, not a switch

Once you're scoring agent output continuously, you have data. Use it.

Track a rolling average of scores per agent. An agent averaging 8.5/10 over its last 50 tasks has earned trust. An agent averaging 5.2/10 hasn't.

Map trust to autonomy levels:

| Trust Score | Level | Prompt Style |
|-------------|-------|-------------|
| < 0.6 | Supervised | "Follow this spec exactly. Output format: ..." |
| 0.6 - 0.8 | Guided | "Follow the spec. Suggest improvements if you see them." |
| >= 0.8 | Autonomous | "Implement this. Use your judgment. Report when done." |

High-trust agents get shorter prompts and more freedom. Low-trust agents get verbose, structured instructions. Trust adjusts automatically as performance changes.

### Implementation

You can implement basic ratcheting in ~20 lines of bash:

```bash
#!/bin/bash
SAVED_HEAD=$(git rev-parse HEAD)
# ... run agent ...
SCORE=$(run_review)
if (( $(echo "$SCORE >= 6.0" | bc -l) )); then
    git add -A && git commit -m "cycle $CYCLE: score $SCORE"
else
    git checkout -- . && git clean -fd
    echo "Reverted. Score: $SCORE"
fi
```

For the full loop — delegation, retry, extraction, metrics, dashboard — I built [Toryo](https://github.com/JesseRWeigel/toryo), an open-source TypeScript orchestrator. It chains AI coding agents (Claude Code, Aider, Gemini CLI, Ollama) with ratcheting, trust scoring, and the Ralph Loop.

```bash
npx @jweigel/toryo init    # scaffold config
npx @jweigel/toryo run     # start the loop
```

235 tests. MIT licensed. Works with any CLI-based AI tool. The Ollama adapter hits the local API directly — no cloud dependency needed.

### The patterns matter more than the tool

Whether you use Toryo, build your own harness, or just add a `git revert` check to your existing agent script — the ratchet pattern is the single most important guardrail for autonomous agents. It converts "hope the agent does well" into "mechanically guarantee the codebase only moves forward."

The 2026 wave of agent harnesses (Anthropic's, Karpathy's, the various open-source orchestrators) is converging on this: **git is the quality floor.**

---

## 5. Twitter/X Thread

**Tweet 1:**
I've been running AI agents autonomously for weeks. The biggest lesson: without a quality floor, your codebase accumulates garbage.

So I built Toryo — an open-source orchestrator that uses git commit/revert as a mechanical ratchet. The code can only move forward.

🧵

**Tweet 2:**
How it works:

Every cycle: plan → research → execute → review

A reviewer agent scores output 1-10.
- Score >= threshold → git commit (keep)
- Score < threshold → git revert → retry with feedback

Bad output literally cannot persist. Like a ratchet wrench — turns one way only.

**Tweet 3:**
The key patterns:

• Ratcheting (Karpathy's autoresearch) — git as quality gate
• Ralph Loop (Vercel Labs) — retry with structured feedback before discarding
• Trust-based delegation — agents earn autonomy through scores
• Auto-extraction — code blocks saved to disk automatically

**Tweet 4:**
It works with ANY AI CLI tool — not locked to one vendor.

Mix Claude Code for planning, Ollama for local code gen, Gemini CLI for review. 6 adapters built in, or bring your own.

The Ollama adapter hits your local API directly. No cloud required.

**Tweet 5:**
Tested across 49+ continuous monitoring cycles. 235 tests. TypeScript monorepo. MIT licensed.

```
npx @jweigel/toryo init
npx @jweigel/toryo run
```

Real-time dashboard, notifications (ntfy/Slack/Discord), results tracking in TSV.

**Tweet 6:**
This came from actually running autonomous agents in production and watching what breaks.

The patterns that survived weeks of continuous operation got extracted into Toryo. Battle-tested, not theoretical.

github.com/JesseRWeigel/toryo

**Tweet 7:**
If you're running AI agents for more than a few minutes at a time, you need a quality floor.

git commit/revert is the simplest, most reliable one I've found.

Star if useful, PRs welcome. MIT licensed.

github.com/JesseRWeigel/toryo
