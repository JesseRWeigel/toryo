import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { gatherProjectContext } from '../context.js';

const TEST_DIR = join(import.meta.dirname ?? __dirname, '../../.test-context');

beforeEach(async () => {
  await mkdir(join(TEST_DIR, 'src'), { recursive: true });
  await mkdir(join(TEST_DIR, 'node_modules', 'dep'), { recursive: true });
  await writeFile(join(TEST_DIR, 'package.json'), '{"name":"test"}');
  await writeFile(join(TEST_DIR, 'src', 'index.ts'), 'export function main() {\n  return 42;\n}\n');
  await writeFile(join(TEST_DIR, 'src', 'utils.ts'), 'export const add = (a: number, b: number) => a + b;\n');
  await writeFile(join(TEST_DIR, 'node_modules', 'dep', 'index.js'), 'module.exports = {};\n');
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe('gatherProjectContext', () => {
  it('returns file structure for a project directory', async () => {
    const result = await gatherProjectContext({}, TEST_DIR);
    expect(result).toContain('## Project Context');
    expect(result).toContain('### File Structure');
    expect(result).toContain('index.ts');
    expect(result).toContain('utils.ts');
    expect(result).toContain('package.json');
  });

  it('excludes node_modules by default', async () => {
    const result = await gatherProjectContext({}, TEST_DIR);
    expect(result).not.toContain('node_modules');
    expect(result).not.toContain('dep');
  });

  it('includes file contents under Key Files', async () => {
    const result = await gatherProjectContext({}, TEST_DIR);
    expect(result).toContain('### Key Files');
    expect(result).toContain('export function main()');
    expect(result).toContain('export const add');
  });

  it('respects maxContextChars limit', async () => {
    // Set a very small limit — should only include smallest files
    const result = await gatherProjectContext({ maxContextChars: 30 }, TEST_DIR);
    expect(result).toContain('### File Structure');
    // Should have file tree but limited key file content
    const keyFilesSection = result.split('### Key Files')[1] ?? '';
    expect(keyFilesSection.length).toBeLessThan(200);
  });

  it('returns empty string for nonexistent directory', async () => {
    const result = await gatherProjectContext({}, '/nonexistent/path/that/doesnt/exist');
    expect(result).toBe('');
  });

  it('respects custom include patterns', async () => {
    const result = await gatherProjectContext({ include: ['**/*.json'] }, TEST_DIR);
    expect(result).toContain('package.json');
    expect(result).not.toContain('index.ts');
  });

  it('respects custom exclude patterns', async () => {
    const result = await gatherProjectContext({ exclude: ['src'] }, TEST_DIR);
    expect(result).not.toContain('index.ts');
    expect(result).toContain('package.json');
  });

  it('shows line counts in file tree', async () => {
    const result = await gatherProjectContext({}, TEST_DIR);
    expect(result).toMatch(/index\.ts \(\d+ lines\)/);
  });

  it('handles projectDir relative to cwd', async () => {
    const result = await gatherProjectContext({ projectDir: 'src' }, TEST_DIR);
    // When projectDir=src, only files inside src/ are scanned
    expect(result).toContain('index.ts');
    expect(result).toContain('utils.ts');
  });

  it('returns empty string for empty directory', async () => {
    const emptyDir = join(TEST_DIR, 'empty');
    await mkdir(emptyDir, { recursive: true });
    const result = await gatherProjectContext({ include: ['**/*.xyz'] }, emptyDir);
    expect(result).toBe('');
  });
});
