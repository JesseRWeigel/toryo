# Twitter/X Thread

## Tweet 1
Problem: AI coding agents have no quality floor.

They write code, you review it, maybe it's good. No systematic feedback loop, no automatic rollback, no retry mechanism.

I built something to fix that. 🧵

## Tweet 2
The Ratchet Pattern:
- Agent writes code
- QA agent scores it (1-10)
- Score ≥ 6? → git commit ✓
- Score < 6? → git revert → retry with QA feedback

Your codebase can only improve. Bad output is automatically reverted.

## Tweet 3
The retry mechanism (Ralph Loop) is surprisingly effective:

Initial score 2/10 → retry with feedback → 8/10 ✓
Initial score 3/10 → retry → 7/10 ✓

~40% of initially-failing cycles recover after retry. The structured feedback makes all the difference.

## Tweet 4
Toryo (棟梁) orchestrates this across any AI CLI:
- Claude Code
- Aider
- Gemini CLI
- Ollama (local, no cloud)
- Any custom tool

Mix and match: Ollama for code gen, Claude for review.

## Tweet 5
It also tracks trust per agent:

🔴 Supervised (new, untrusted)
🟡 Guided (earning trust)
🟢 Autonomous (consistently high scores)

Agents earn autonomy through quality. If scores drop, they get demoted back.

## Tweet 6
256 tests. 50+ continuous monitoring cycles. MIT licensed. TypeScript.

Try without installing anything:
npx @jweigel/toryo demo

GitHub: github.com/JesseRWeigel/toryo

## Tweet 7
Built on:
- Karpathy's autoresearch (ratcheting + results.tsv)
- Ralph Loop (verify-then-retry)
- Intelligent AI Delegation paper (trust scoring)

If you're running multiple AI agents, give it a try. Feedback welcome.
