import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseSpec, loadSpecs } from '../specs.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('parseSpec', () => {
  it('parses content without frontmatter', () => {
    const spec = parseSpec('This is a task description', 'my-task');
    expect(spec).not.toBeNull();
    expect(spec!.id).toBe('my-task');
    expect(spec!.name).toBe('my task');
    expect(spec!.description).toBe('This is a task description');
    expect(spec!.acceptanceCriteria).toEqual([]);
    expect(spec!.phases.length).toBe(4);
  });

  it('parses acceptance criteria from body when no frontmatter', () => {
    const content = `This is a task description.

## Acceptance Criteria
- Item one
- [ ] Item two
* Item three`;

    const spec = parseSpec(content, 'my-task');
    expect(spec!.acceptanceCriteria).toEqual(['Item one', 'Item two', 'Item three']);
  });

  it('generates default phases with auto agent', () => {
    const spec = parseSpec('desc', 'task-1');
    expect(spec!.phases).toEqual([
      { phase: 'plan', agent: 'auto' },
      { phase: 'research', agent: 'auto' },
      { phase: 'execute', agent: 'auto' },
      { phase: 'review', agent: 'auto' },
    ]);
  });

  it('parses frontmatter with name and difficulty', () => {
    const content = `---
name: Build Feature X
difficulty: 0.8
tags:
  - frontend
  - urgent
---
Implement the new feature X with full test coverage.`;

    const spec = parseSpec(content, 'build-feature-x');
    expect(spec!.name).toBe('Build Feature X');
    expect(spec!.difficulty).toBe(0.8);
    expect(spec!.tags).toEqual(['frontend', 'urgent']);
    expect(spec!.description).toBe('Implement the new feature X with full test coverage.');
  });

  it('parses frontmatter phases with specific agents', () => {
    const content = `---
name: Test Task
phases:
  plan: senku
  execute: bulma
  review: vegeta
---
Description here.`;

    const spec = parseSpec(content, 'test-task');
    expect(spec!.phases).toEqual([
      { phase: 'plan', agent: 'senku' },
      { phase: 'execute', agent: 'bulma' },
      { phase: 'review', agent: 'vegeta' },
    ]);
  });

  it('parses acceptance criteria from frontmatter', () => {
    const content = `---
name: Task
acceptance_criteria:
  - All tests pass
  - Code coverage > 80%
---
Do the thing.`;

    const spec = parseSpec(content, 'task');
    expect(spec!.acceptanceCriteria).toEqual([
      'All tests pass',
      'Code coverage > 80%',
    ]);
  });

  it('parses acceptance criteria from body markdown', () => {
    const content = `---
name: Task
---
Do the thing.

## Acceptance Criteria
- All tests pass
- [ ] Code coverage > 80%
* Third item`;

    const spec = parseSpec(content, 'task');
    expect(spec!.acceptanceCriteria).toEqual([
      'All tests pass',
      'Code coverage > 80%',
      'Third item',
    ]);
  });

  it('stops parsing criteria at next heading', () => {
    const content = `---
name: Task
---
## Acceptance Criteria
- Item 1
- Item 2

## Notes
- Not a criterion`;

    const spec = parseSpec(content, 'task');
    expect(spec!.acceptanceCriteria).toEqual(['Item 1', 'Item 2']);
  });

  it('recognizes "Done When" as criteria heading', () => {
    const content = `---
name: Task
---
### Done When
- Feature works
- Tests pass`;

    const spec = parseSpec(content, 'task');
    expect(spec!.acceptanceCriteria).toEqual(['Feature works', 'Tests pass']);
  });

  it('recognizes "Criteria" as criteria heading', () => {
    const content = `---
name: Task
---
## Criteria
- Criterion A`;

    const spec = parseSpec(content, 'task');
    expect(spec!.acceptanceCriteria).toEqual(['Criterion A']);
  });

  it('returns null for invalid YAML frontmatter', () => {
    const content = `---
: invalid: yaml: [[[
---
Body`;

    const spec = parseSpec(content, 'bad-yaml');
    expect(spec).toBeNull();
  });

  it('handles empty frontmatter', () => {
    // Empty frontmatter (--- followed immediately by ---) doesn't match
    // the regex since there's no content between delimiters, so it falls
    // through to the no-frontmatter path
    const content = `---

---
Just a description`;

    const spec = parseSpec(content, 'empty-fm');
    expect(spec).not.toBeNull();
    expect(spec!.name).toBe('empty fm');
    expect(spec!.description).toBe('Just a description');
  });

  it('replaces dashes with spaces in default name', () => {
    const spec = parseSpec('desc', 'write-unit-tests');
    expect(spec!.name).toBe('write unit tests');
  });

  it('prefers frontmatter acceptance_criteria over body parsing', () => {
    const content = `---
acceptance_criteria:
  - From frontmatter
---
## Acceptance Criteria
- From body`;

    const spec = parseSpec(content, 'task');
    expect(spec!.acceptanceCriteria).toEqual(['From frontmatter']);
  });

  it('handles checkbox-style criteria', () => {
    const content = `---
name: Task
---
## Acceptance Criteria
- [x] Completed item
- [ ] Pending item`;

    const spec = parseSpec(content, 'task');
    expect(spec!.acceptanceCriteria).toEqual(['Completed item', 'Pending item']);
  });

  it('handles asterisk bullet style', () => {
    const content = `---
name: Task
---
## Acceptance Criteria
* Item A
* Item B`;

    const spec = parseSpec(content, 'task');
    expect(spec!.acceptanceCriteria).toEqual(['Item A', 'Item B']);
  });
});

describe('loadSpecs', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'toryo-specs-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('loads markdown files from directory', async () => {
    await writeFile(join(tempDir, 'task-a.md'), '---\nname: Task A\n---\nDo A');
    await writeFile(join(tempDir, 'task-b.md'), '---\nname: Task B\n---\nDo B');
    const specs = await loadSpecs(tempDir);
    expect(specs.length).toBe(2);
    expect(specs[0].id).toBe('task-a');
    expect(specs[1].id).toBe('task-b');
  });

  it('ignores non-markdown files', async () => {
    await writeFile(join(tempDir, 'task.md'), 'desc');
    await writeFile(join(tempDir, 'readme.txt'), 'not a spec');
    await writeFile(join(tempDir, 'config.json'), '{}');
    const specs = await loadSpecs(tempDir);
    expect(specs.length).toBe(1);
  });

  it('returns empty array for empty directory', async () => {
    const specs = await loadSpecs(tempDir);
    expect(specs).toEqual([]);
  });

  it('sorts files alphabetically', async () => {
    await writeFile(join(tempDir, 'zzz.md'), 'z');
    await writeFile(join(tempDir, 'aaa.md'), 'a');
    await writeFile(join(tempDir, 'mmm.md'), 'm');
    const specs = await loadSpecs(tempDir);
    expect(specs.map((s) => s.id)).toEqual(['aaa', 'mmm', 'zzz']);
  });

  it('skips specs with invalid YAML', async () => {
    await writeFile(join(tempDir, 'good.md'), '---\nname: Good\n---\nOK');
    await writeFile(join(tempDir, 'bad.md'), '---\n: [[[invalid\n---\nBad');
    const specs = await loadSpecs(tempDir);
    expect(specs.length).toBe(1);
    expect(specs[0].name).toBe('Good');
  });

  it('uses filename as id without .md extension', async () => {
    await writeFile(join(tempDir, 'my-cool-task.md'), 'desc');
    const specs = await loadSpecs(tempDir);
    expect(specs[0].id).toBe('my-cool-task');
  });
});
