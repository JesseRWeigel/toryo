# Reddit r/LocalLLaMA Post

## Title
I built an orchestrator that chains Ollama + Claude Code with quality ratcheting — bad output gets git-reverted automatically

## Body

I've been running qwen3.5:9b and qwen3.5:27b on my RTX 5090 with Ollama, and wanted a way to have multiple agents collaborate on coding tasks with automatic quality control.

**Toryo** (棟梁) is an intelligent agent orchestrator that:
- Uses **Ollama natively** (direct HTTP API, no CLI wrapper) — zero cloud dependency
- Runs 4-phase cycles: plan → research → execute → review
- **Quality ratcheting**: git commit when QA passes, git revert when it fails
- **Ralph Loop**: feeds QA feedback back to the agent for a retry
- **Trust-based delegation**: agents earn autonomy through consistent scores

The Ollama adapter connects directly to `localhost:11434` — no API keys, no cloud, runs entirely on your hardware.

I've been testing it with qwen3.5:9b for planning/review (fast, cheap) and qwen3.5:27b for code generation (better quality). The key finding: the small model works great as reviewer, and the Ralph Loop retry recovers ~40% of initially-failing cycles.

**Try it without any AI tools**: `npx @jweigel/toryo demo`

**Quick start with Ollama**:
```bash
npx @jweigel/toryo init    # auto-detects Ollama
npx @jweigel/toryo check   # validates setup
npx @jweigel/toryo run -n 5  # run 5 cycles
```

GitHub: https://github.com/JesseRWeigel/toryo

256 tests, TypeScript, MIT. Would love feedback from the local LLM community — especially on model selection for the reviewer role.
