/**
 * Smart truncation for agent outputs — preserves the most useful content
 * while staying within token/char budgets.
 *
 * Ported from OpenClaw orchestrator.py's smart_truncate logic.
 */

interface TruncateOptions {
  /** Maximum characters to keep */
  maxChars: number;
  /** Lines to skip from the start (boilerplate headers) */
  skipHeaderLines?: number;
  /** Preserve this many chars from the start */
  headChars?: number;
  /** Preserve this many chars from the end */
  tailChars?: number;
}

const BOILERPLATE_PATTERNS = [
  /^#{1,3}\s*(summary|overview|introduction|table of contents)/i,
  /^(here is|here's|below is|the following)/i,
  /^(as requested|as you asked|certainly|sure|of course)/i,
  /^[-=]{3,}/,
];

export function truncate(
  text: string,
  options: TruncateOptions,
): string {
  const {
    maxChars,
    skipHeaderLines = 0,
    headChars,
    tailChars,
  } = options;

  if (text.length <= maxChars) return text;

  // Skip boilerplate header lines
  let lines = text.split('\n');
  if (skipHeaderLines > 0) {
    lines = lines.slice(skipHeaderLines);
  }

  // Also skip common LLM boilerplate from the start
  while (lines.length > 0 && isBoilerplate(lines[0])) {
    lines.shift();
  }

  const cleaned = lines.join('\n');

  if (cleaned.length <= maxChars) return cleaned;

  // Split into head + tail, with a marker in between
  const head = headChars ?? Math.floor(maxChars * 0.6);
  const tail = tailChars ?? Math.floor(maxChars * 0.35);
  const marker = '\n\n[... truncated for context ...]\n\n';

  return (
    cleaned.slice(0, head) +
    marker +
    cleaned.slice(-tail)
  );
}

function isBoilerplate(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true; // skip empty lines at start
  return BOILERPLATE_PATTERNS.some((p) => p.test(trimmed));
}

/**
 * Truncate for feeding to the next phase.
 * Default: 6000 chars, 60/35 head/tail split.
 */
export function truncateForPhase(text: string, maxChars = 6000): string {
  return truncate(text, { maxChars });
}
