import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { Extraction } from './types.js';

interface CodeBlock {
  language: string;
  content: string;
  lines: number;
}

const CODE_BLOCK_RE = /```([^\n]*?)\n([\s\S]*?)```/g;
const SKILL_FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;

export function findCodeBlocks(markdown: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  let match: RegExpExecArray | null;

  // Reset regex state
  CODE_BLOCK_RE.lastIndex = 0;

  while ((match = CODE_BLOCK_RE.exec(markdown)) !== null) {
    const language = match[1]?.trim() || 'text';
    const content = match[2].trim();
    const lines = content.split('\n').length;
    blocks.push({ language, content, lines });
  }

  return blocks;
}

export function isSkillBlock(block: CodeBlock): boolean {
  return (
    block.language === 'markdown' &&
    SKILL_FRONTMATTER_RE.test(block.content) &&
    block.content.includes('name:') &&
    block.content.includes('description:')
  );
}

export async function saveToFile(
  item: Extraction,
): Promise<void> {
  await mkdir(dirname(item.path), { recursive: true });
  await writeFile(item.path, item.content, 'utf-8');
}

export function processOutput(
  output: string,
  taskId: string,
  outputDir: string,
  options: {
    /** Minimum lines for a code block to be saved */
    minCodeLines?: number;
    /** Save SKILL.md blocks */
    saveSkills?: boolean;
    /** Save large outputs as artifacts */
    artifactThreshold?: number;
  } = {},
): Extraction[] {
  const {
    minCodeLines = 20,
    saveSkills = true,
    artifactThreshold = 3000,
  } = options;

  const items: Extraction[] = [];
  const blocks = findCodeBlocks(output);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  let codeIndex = 0;

  for (const block of blocks) {
    // Skills (SKILL.md blocks)
    if (saveSkills && isSkillBlock(block)) {
      const nameMatch = block.content.match(/name:\s*(.+)/);
      const rawName = nameMatch?.[1]?.trim() ?? `skill-${timestamp}`;
      // Sanitize skill name to prevent path traversal
      const skillName = rawName.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
      const path = join(outputDir, 'skills', skillName, 'SKILL.md');

      items.push({
        type: 'skill',
        path,
        content: block.content,
        lines: block.lines,
      });
      continue;
    }

    // Substantial code blocks
    if (block.lines >= minCodeLines && block.language !== 'text') {
      const ext = languageToExt(block.language);
      const path = join(
        outputDir,
        'output',
        `${taskId}_${codeIndex}.${ext}`,
      );

      items.push({
        type: 'code',
        language: block.language,
        path,
        content: block.content,
        lines: block.lines,
      });
      codeIndex++;
    }
  }

  // Full output as artifact if large enough
  if (output.length >= artifactThreshold) {
    const path = join(
      outputDir,
      'artifacts',
      `${taskId}-${timestamp}.md`,
    );
    items.push({
      type: 'artifact',
      path,
      content: output,
      lines: output.split('\n').length,
    });
  }

  return items;
}

function languageToExt(language: string): string {
  const map: Record<string, string> = {
    typescript: 'ts',
    javascript: 'js',
    python: 'py',
    rust: 'rs',
    go: 'go',
    java: 'java',
    ruby: 'rb',
    bash: 'sh',
    shell: 'sh',
    sql: 'sql',
    yaml: 'yaml',
    json: 'json',
    toml: 'toml',
    css: 'css',
    html: 'html',
  };
  return map[language.toLowerCase()] ?? language;
}
