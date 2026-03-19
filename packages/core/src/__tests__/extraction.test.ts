import { describe, it, expect } from 'vitest';
import { findCodeBlocks, isSkillBlock, processOutput } from '../extraction.js';

describe('findCodeBlocks', () => {
  it('finds a single code block', () => {
    const md = '```typescript\nconst x = 1;\n```';
    const blocks = findCodeBlocks(md);
    expect(blocks.length).toBe(1);
    expect(blocks[0].language).toBe('typescript');
    expect(blocks[0].content).toBe('const x = 1;');
    expect(blocks[0].lines).toBe(1);
  });

  it('finds multiple code blocks', () => {
    const md = '```python\nprint("hi")\n```\n\nSome text\n\n```javascript\nconsole.log("hi");\n```';
    const blocks = findCodeBlocks(md);
    expect(blocks.length).toBe(2);
    expect(blocks[0].language).toBe('python');
    expect(blocks[1].language).toBe('javascript');
  });

  it('defaults to "text" when no language specified', () => {
    const md = '```\nhello world\n```';
    const blocks = findCodeBlocks(md);
    expect(blocks.length).toBe(1);
    expect(blocks[0].language).toBe('text');
  });

  it('counts multiline blocks correctly', () => {
    const md = '```python\nline1\nline2\nline3\nline4\n```';
    const blocks = findCodeBlocks(md);
    expect(blocks[0].lines).toBe(4);
  });

  it('returns empty array for no code blocks', () => {
    expect(findCodeBlocks('Just plain text')).toEqual([]);
    expect(findCodeBlocks('')).toEqual([]);
  });

  it('trims content whitespace', () => {
    const md = '```python\n  indented  \n```';
    const blocks = findCodeBlocks(md);
    expect(blocks[0].content).toBe('indented');
  });

  it('handles consecutive code blocks', () => {
    const md = '```js\na\n```\n```py\nb\n```';
    const blocks = findCodeBlocks(md);
    expect(blocks.length).toBe(2);
  });

  it('resets regex state on repeated calls', () => {
    const md = '```js\na\n```';
    findCodeBlocks(md);
    const blocks = findCodeBlocks(md);
    expect(blocks.length).toBe(1);
  });
});

describe('isSkillBlock', () => {
  it('returns true for valid skill blocks', () => {
    const block = {
      language: 'markdown',
      content: '---\nname: my-skill\ndescription: Does something\n---\n\nSome content',
      lines: 5,
    };
    expect(isSkillBlock(block)).toBe(true);
  });

  it('returns false for non-markdown language', () => {
    const block = {
      language: 'python',
      content: '---\nname: my-skill\ndescription: Does something\n---',
      lines: 3,
    };
    expect(isSkillBlock(block)).toBe(false);
  });

  it('returns false when missing frontmatter delimiters', () => {
    const block = {
      language: 'markdown',
      content: 'name: my-skill\ndescription: Does something',
      lines: 2,
    };
    expect(isSkillBlock(block)).toBe(false);
  });

  it('returns false when missing name field', () => {
    const block = {
      language: 'markdown',
      content: '---\ndescription: Does something\n---',
      lines: 3,
    };
    expect(isSkillBlock(block)).toBe(false);
  });

  it('returns false when missing description field', () => {
    const block = {
      language: 'markdown',
      content: '---\nname: my-skill\n---',
      lines: 3,
    };
    expect(isSkillBlock(block)).toBe(false);
  });
});

describe('processOutput', () => {
  const outputDir = '/tmp/toryo-test';
  const taskId = 'test-task';

  it('returns empty array for output with no code blocks', () => {
    const items = processOutput('Just plain text', taskId, outputDir);
    expect(items).toEqual([]);
  });

  it('extracts large code blocks', () => {
    const longCode = Array.from({ length: 25 }, (_, i) => `line ${i}`).join('\n');
    const md = `Here is the code:\n\n\`\`\`typescript\n${longCode}\n\`\`\``;
    const items = processOutput(md, taskId, outputDir);
    const codeItems = items.filter((i) => i.type === 'code');
    expect(codeItems.length).toBe(1);
    expect(codeItems[0].language).toBe('typescript');
    expect(codeItems[0].path).toContain('test-task_0.ts');
  });

  it('ignores small code blocks below minCodeLines', () => {
    const md = '```typescript\nconst x = 1;\n```';
    const items = processOutput(md, taskId, outputDir);
    const codeItems = items.filter((i) => i.type === 'code');
    expect(codeItems.length).toBe(0);
  });

  it('respects custom minCodeLines', () => {
    const code = 'line1\nline2\nline3';
    const md = `\`\`\`python\n${code}\n\`\`\``;
    const items = processOutput(md, taskId, outputDir, { minCodeLines: 3 });
    const codeItems = items.filter((i) => i.type === 'code');
    expect(codeItems.length).toBe(1);
  });

  it('ignores text language blocks even if large', () => {
    const longText = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
    const md = `\`\`\`\n${longText}\n\`\`\``;
    const items = processOutput(md, taskId, outputDir);
    const codeItems = items.filter((i) => i.type === 'code');
    expect(codeItems.length).toBe(0);
  });

  it('extracts skill blocks', () => {
    const skill = '---\nname: test-skill\ndescription: A test skill\n---\n\nSkill content here\nline2\nline3';
    const md = `\`\`\`markdown\n${skill}\n\`\`\``;
    const items = processOutput(md, taskId, outputDir);
    const skillItems = items.filter((i) => i.type === 'skill');
    expect(skillItems.length).toBe(1);
    expect(skillItems[0].path).toContain('skills/test-skill/SKILL.md');
  });

  it('does not extract skills when saveSkills is false', () => {
    const skill = '---\nname: test-skill\ndescription: A test skill\n---\n\nSkill content';
    const md = `\`\`\`markdown\n${skill}\n\`\`\``;
    const items = processOutput(md, taskId, outputDir, { saveSkills: false });
    const skillItems = items.filter((i) => i.type === 'skill');
    expect(skillItems.length).toBe(0);
  });

  it('creates artifact for large outputs', () => {
    const largeOutput = 'x'.repeat(3000);
    const items = processOutput(largeOutput, taskId, outputDir);
    const artifacts = items.filter((i) => i.type === 'artifact');
    expect(artifacts.length).toBe(1);
    expect(artifacts[0].path).toContain('artifacts/');
  });

  it('does not create artifact for small outputs', () => {
    const items = processOutput('Small output', taskId, outputDir);
    const artifacts = items.filter((i) => i.type === 'artifact');
    expect(artifacts.length).toBe(0);
  });

  it('respects custom artifactThreshold', () => {
    const items = processOutput('short', taskId, outputDir, { artifactThreshold: 3 });
    const artifacts = items.filter((i) => i.type === 'artifact');
    expect(artifacts.length).toBe(1);
  });

  it('maps language extensions correctly', () => {
    const longCode = Array.from({ length: 25 }, (_, i) => `line ${i}`).join('\n');
    for (const [lang, ext] of [
      ['python', 'py'],
      ['javascript', 'js'],
      ['rust', 'rs'],
      ['bash', 'sh'],
    ] as const) {
      const md = `\`\`\`${lang}\n${longCode}\n\`\`\``;
      const items = processOutput(md, `task-${lang}`, outputDir);
      const codeItems = items.filter((i) => i.type === 'code');
      expect(codeItems[0].path).toContain(`.${ext}`);
    }
  });

  it('increments code index for multiple blocks', () => {
    const longCode = Array.from({ length: 25 }, (_, i) => `line ${i}`).join('\n');
    const md = `\`\`\`python\n${longCode}\n\`\`\`\n\n\`\`\`javascript\n${longCode}\n\`\`\``;
    const items = processOutput(md, taskId, outputDir);
    const codeItems = items.filter((i) => i.type === 'code');
    expect(codeItems.length).toBe(2);
    expect(codeItems[0].path).toContain('test-task_0.py');
    expect(codeItems[1].path).toContain('test-task_1.js');
  });
});
