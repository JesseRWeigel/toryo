import { describe, it, expect } from 'vitest';
import { truncate, truncateForPhase } from '../truncation.js';

describe('truncate', () => {
  it('returns text unchanged if within maxChars', () => {
    const text = 'Hello world';
    expect(truncate(text, { maxChars: 100 })).toBe('Hello world');
  });

  it('returns text unchanged if exactly maxChars', () => {
    const text = 'abcde';
    expect(truncate(text, { maxChars: 5 })).toBe('abcde');
  });

  it('truncates long text with head/tail split', () => {
    const text = 'a'.repeat(200);
    const result = truncate(text, { maxChars: 100 });
    expect(result).toContain('[... truncated for context ...]');
    expect(result.length).toBeLessThan(200);
  });

  it('uses 60/35 head/tail split by default', () => {
    const text = Array.from({ length: 100 }, (_, i) => String(i)).join(' ');
    const result = truncate(text, { maxChars: 100 });
    const parts = result.split('[... truncated for context ...]');
    expect(parts.length).toBe(2);
    // Head gets \n\n suffix, tail gets \n\n prefix from the marker
    expect(parts[0]).toMatch(/\n\n$/);
    expect(parts[1]).toMatch(/^\n\n/);
  });

  it('respects custom headChars and tailChars', () => {
    const text = 'x'.repeat(200);
    const result = truncate(text, { maxChars: 100, headChars: 30, tailChars: 20 });
    const parts = result.split('[... truncated for context ...]');
    // The marker is '\n\n[... truncated for context ...]\n\n'
    // so head part includes trailing \n\n and tail part includes leading \n\n
    expect(parts[0]).toHaveLength(32); // 30 + '\n\n'
    expect(parts[1]).toHaveLength(22); // '\n\n' + 20
  });

  it('skips header lines when specified', () => {
    // Text must exceed maxChars to trigger the truncation path where skipHeaderLines applies
    const text = 'Header line 1\nHeader line 2\nActual content that is important and long enough' + 'x'.repeat(200);
    const result = truncate(text, { maxChars: 100, skipHeaderLines: 2 });
    expect(result).not.toContain('Header line 1');
    expect(result).not.toContain('Header line 2');
    expect(result).toContain('Actual content');
  });

  it('strips boilerplate lines from the start', () => {
    const text = 'Here is the summary:\nActual useful content follows\n' + 'x'.repeat(200);
    const result = truncate(text, { maxChars: 100 });
    expect(result).not.toContain('Here is the summary');
  });

  it('strips multiple types of boilerplate', () => {
    const text = 'Certainly, here is my response\n## Summary\nAs requested, below is the analysis\nReal content\n' + 'x'.repeat(200);
    const result = truncate(text, { maxChars: 100 });
    expect(result).not.toContain('Certainly');
    expect(result).not.toContain('Summary');
    expect(result).not.toContain('As requested');
  });

  it('strips empty lines at the start', () => {
    const text = '\n\n\nActual content\n' + 'x'.repeat(200);
    const result = truncate(text, { maxChars: 50 });
    expect(result).toContain('Actual content');
  });

  it('strips separator lines (---)', () => {
    const text = '---\nReal content\n' + 'x'.repeat(200);
    const result = truncate(text, { maxChars: 50 });
    expect(result).not.toMatch(/^---/);
  });

  it('handles empty string', () => {
    expect(truncate('', { maxChars: 100 })).toBe('');
  });

  it('returns original text if under maxChars (boilerplate only stripped when text exceeds limit)', () => {
    // When text is under maxChars, it's returned as-is (no boilerplate stripping needed)
    const text = 'Here is the overview:\nShort real content';
    const result = truncate(text, { maxChars: 100 });
    expect(result).toBe(text);
  });

  it('strips boilerplate when text exceeds maxChars and becomes short enough after cleaning', () => {
    // Boilerplate is stripped first, then the cleaned text is checked against maxChars
    const text = 'Here is the summary:\n' + 'x'.repeat(50);
    const result = truncate(text, { maxChars: 60 });
    expect(result).not.toContain('Here is the summary');
    expect(result).toBe('x'.repeat(50));
  });
});

describe('truncateForPhase', () => {
  it('uses default maxChars of 6000', () => {
    const shortText = 'Short text';
    expect(truncateForPhase(shortText)).toBe('Short text');
  });

  it('truncates text exceeding 6000 chars', () => {
    const longText = 'x'.repeat(7000);
    const result = truncateForPhase(longText);
    expect(result).toContain('[... truncated for context ...]');
    expect(result.length).toBeLessThan(7000);
  });

  it('accepts custom maxChars', () => {
    const text = 'x'.repeat(200);
    const result = truncateForPhase(text, 100);
    expect(result).toContain('[... truncated for context ...]');
  });

  it('handles empty string', () => {
    expect(truncateForPhase('')).toBe('');
  });
});
