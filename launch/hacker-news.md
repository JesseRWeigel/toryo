# Hacker News — Show HN Post

## Title
Show HN: Toryo – Chain AI coding CLIs with quality ratcheting (git commit/revert)

## URL
https://github.com/JesseRWeigel/toryo

## Comment (post immediately after submission)

Toryo (棟梁, "master builder") is an orchestrator I built to solve a specific problem: I was running multiple AI coding agents (Claude Code, Aider, Ollama) but had no way to ensure quality or coordinate them.

**The core insight is quality ratcheting** — borrowed from Karpathy's autoresearch pattern. Every cycle:

1. Agents work through phases (plan → research → execute → review)
2. A QA agent scores the output 1-10
3. Score ≥ threshold → `git commit` (keep)
4. Score < threshold → `git revert` → Ralph Loop retry with feedback
5. Results logged to TSV for experiment tracking

This means your codebase can only improve — bad output is automatically reverted. Over 50+ continuous test cycles, the Ralph Loop recovered scores from 2/10 to 8/10 about 40% of the time.

Other features:
- **Trust-based delegation**: Agents start supervised, earn autonomy through scores
- **6 adapters**: Claude Code, Aider, Gemini CLI, Codex, Ollama, or any CLI
- **Project context**: Scans your codebase so agents know what they're working on
- **256 tests**, TypeScript, MIT licensed

Try it: `npx @jweigel/toryo demo` (no AI tools needed)

Happy to answer questions about the ratcheting pattern or how delegation scoring works.
