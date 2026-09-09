import type {ReviewEvidence} from '../types.js';
export function structuredReview(prompt: string, score: number): string {
  const marker = '## Captured review evidence (JSON)\n';
  const evidence: ReviewEvidence = JSON.parse(prompt.slice(prompt.lastIndexOf(marker) + marker.length));
  return JSON.stringify({score, verdict: score >= 6 ? 'pass' : 'fail', feedback:'Fixture independently assessed captured evidence',
    evidenceRefs:[evidence.patch.id, ...evidence.checks.map((c) => c.id)]});
}
