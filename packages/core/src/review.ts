import { z } from 'zod';
import type { ReviewEvidence, ReviewResult } from './types.js';

const reviewSchema = z.object({
  score: z.number().finite().min(0).max(10),
  verdict: z.enum(['pass', 'fail', 'needs_revision']),
  feedback: z.string().trim().min(1),
  evidenceRefs: z.array(z.string().min(1)).min(1),
}).strict();

class JsonWalker {
  private position = 0;

  constructor(private readonly input: string) {}

  assertUniqueObjectKeys(): void {
    this.skipWhitespace();
    this.readValue();
    this.skipWhitespace();
    if (this.position !== this.input.length) {
      throw new Error('Review JSON contains trailing content');
    }
  }

  private readValue(): void {
    this.skipWhitespace();
    const current = this.input[this.position];
    if (current === '{') {
      this.readObject();
      return;
    }
    if (current === '[') {
      this.readArray();
      return;
    }
    if (current === '"') {
      this.readString();
      return;
    }
    this.readPrimitive();
  }

  private readObject(): void {
    this.position++;
    this.skipWhitespace();
    const keys = new Set<string>();
    if (this.input[this.position] === '}') {
      this.position++;
      return;
    }

    while (this.position < this.input.length) {
      if (this.input[this.position] !== '"') {
        throw new Error('Review JSON object key must be a string');
      }
      const key = this.readString();
      if (keys.has(key)) {
        throw new Error(`Review JSON contains duplicate key "${key}"`);
      }
      keys.add(key);
      this.skipWhitespace();
      if (this.input[this.position] !== ':') {
        throw new Error('Review JSON object key must be followed by a colon');
      }
      this.position++;
      this.readValue();
      this.skipWhitespace();
      const delimiter = this.input[this.position];
      if (delimiter === '}') {
        this.position++;
        return;
      }
      if (delimiter !== ',') {
        throw new Error('Review JSON object entries must be comma-separated');
      }
      this.position++;
      this.skipWhitespace();
    }
    throw new Error('Review JSON object is not closed');
  }

  private readArray(): void {
    this.position++;
    this.skipWhitespace();
    if (this.input[this.position] === ']') {
      this.position++;
      return;
    }

    while (this.position < this.input.length) {
      this.readValue();
      this.skipWhitespace();
      const delimiter = this.input[this.position];
      if (delimiter === ']') {
        this.position++;
        return;
      }
      if (delimiter !== ',') {
        throw new Error('Review JSON array entries must be comma-separated');
      }
      this.position++;
      this.skipWhitespace();
    }
    throw new Error('Review JSON array is not closed');
  }

  private readString(): string {
    const start = this.position;
    this.position++;
    let escaped = false;

    while (this.position < this.input.length) {
      const current = this.input[this.position++];
      if (escaped) {
        escaped = false;
      } else if (current === '\\') {
        escaped = true;
      } else if (current === '"') {
        const encoded = this.input.slice(start, this.position);
        try {
          return JSON.parse(encoded) as string;
        } catch {
          throw new Error('Review JSON contains an invalid string');
        }
      }
    }
    throw new Error('Review JSON contains an unterminated string');
  }

  private readPrimitive(): void {
    const start = this.position;
    while (this.position < this.input.length) {
      const current = this.input[this.position];
      if (current === ',' || current === ']' || current === '}' || /\s/.test(current)) {
        break;
      }
      this.position++;
    }
    if (this.position === start) {
      throw new Error('Review JSON contains an invalid value');
    }
  }

  private skipWhitespace(): void {
    while (this.position < this.input.length && /\s/.test(this.input[this.position])) {
      this.position++;
    }
  }
}

function extractJson(output: string): string {
  const trimmed = output.trim();
  if (trimmed.startsWith('```')) {
    const match = /^```json[\t ]*\r?\n([\s\S]*?)\r?\n```$/.exec(trimmed);
    if (!match) {
      throw new Error('Review output must be one JSON object or one whole ```json fenced block');
    }
    return match[1].trim();
  }
  return trimmed;
}

function capturedEvidenceIds(evidence: ReviewEvidence): string[] {
  const ids = [evidence.patch.id, ...evidence.checks.map(check => check.id)];
  if (ids.some(id => id.length === 0 || id.trim() !== id)) {
    throw new Error('Review evidence IDs must be non-empty strings without surrounding whitespace');
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error('Review evidence IDs must be unique');
  }
  return ids;
}

function validateEvidenceRefs(refs: string[], evidence: ReviewEvidence): void {
  if (refs.some(ref => ref.trim() !== ref)) {
    throw new Error('Review evidenceRefs must not contain blank or padded IDs');
  }
  if (new Set(refs).size !== refs.length) {
    throw new Error('Review evidenceRefs must be unique');
  }

  const ids = capturedEvidenceIds(evidence);
  const expected = new Set(ids);
  const supplied = new Set(refs);
  const unknown = refs.filter(ref => !expected.has(ref));
  const missing = ids.filter(id => !supplied.has(id));
  if (unknown.length > 0 || missing.length > 0) {
    const details = [
      unknown.length > 0 ? `unknown: ${unknown.join(', ')}` : '',
      missing.length > 0 ? `missing: ${missing.join(', ')}` : '',
    ].filter(Boolean).join('; ');
    throw new Error(`Review evidenceRefs must reference every captured evidence ID exactly once (${details})`);
  }
}

/** Parse and validate an evidence-bound reviewer response. */
export function parseReview(
  output: string,
  threshold: number,
  evidence: ReviewEvidence,
): ReviewResult {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 10) {
    throw new Error('Review threshold must be a finite number between 0 and 10');
  }

  const json = extractJson(output);
  try {
    new JsonWalker(json).assertUniqueObjectKeys();
  } catch (error) {
    if (error instanceof Error && /^Review /.test(error.message)) throw error;
    throw new Error(`Review JSON validation failed: ${String(error)}`, { cause: error });
  }

  let unknown: unknown;
  try {
    unknown = JSON.parse(json);
  } catch (error) {
    throw new Error(
      `Review output is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  const parsed = reviewSchema.safeParse(unknown);
  if (!parsed.success) {
    throw new Error(`Review JSON does not match the required schema: ${parsed.error.issues
      .map(issue => `${issue.path.join('.') || 'root'}: ${issue.message}`)
      .join('; ')}`);
  }

  validateEvidenceRefs(parsed.data.evidenceRefs, evidence);

  const scorePasses = parsed.data.score >= threshold;
  const verdictPasses = parsed.data.verdict === 'pass';
  if (scorePasses !== verdictPasses) {
    throw new Error(
      `Review score and verdict conflict: score ${parsed.data.score} with threshold ${threshold} requires verdict ${scorePasses ? 'pass' : 'fail or needs_revision'}`,
    );
  }

  const checksPassed = evidence.checks.every(
    check => check.exitCode === 0 && !(typeof check.error === 'string' && check.error.trim().length > 0),
  );
  if (verdictPasses && !checksPassed) {
    throw new Error('Review cannot pass because one or more required checks failed or did not complete');
  }

  return {
    ...parsed.data,
    evidence,
    checksPassed,
  };
}
