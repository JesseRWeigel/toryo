import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { ProjectContext } from './types.js';

const DEFAULT_INCLUDE = ['**/*.ts', '**/*.js', '**/*.tsx', '**/*.jsx', '**/*.json', '**/*.py', '**/*.md'];

const DEFAULT_EXCLUDE = [
  'node_modules',
  'dist',
  '.git',
  '.next',
  'coverage',
  'build',
  '__pycache__',
  '.cache',
  '.turbo',
];

/** Max file size in bytes to read content from (64KB) */
const MAX_FILE_SIZE = 64 * 1024;

/** Default max characters for all file content combined */
const DEFAULT_MAX_CONTEXT_CHARS = 8000;

interface FileEntry {
  relativePath: string;
  lines: number;
  size: number;
  content?: string;
}

function matchesGlob(filePath: string, pattern: string): boolean {
  // Simple glob matching: supports *, **, and file extensions
  // **/ should match zero or more directories (including root level)
  const regexStr = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*\//g, '{{GLOBSTAR_SLASH}}')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\{\{GLOBSTAR_SLASH\}\}/g, '(.*/)?')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*');
  return new RegExp(`^${regexStr}$`).test(filePath);
}

function shouldExclude(filePath: string, excludePatterns: string[]): boolean {
  const parts = filePath.split('/');
  for (const pattern of excludePatterns) {
    // Check if any path segment matches the exclude pattern
    if (parts.some((part) => part === pattern)) return true;
    // Also check full-path glob match
    if (matchesGlob(filePath, pattern)) return true;
  }
  return false;
}

function shouldInclude(filePath: string, includePatterns: string[]): boolean {
  return includePatterns.some((pattern) => matchesGlob(filePath, pattern));
}

async function walkDir(
  dir: string,
  rootDir: string,
  includePatterns: string[],
  excludePatterns: string[],
): Promise<FileEntry[]> {
  const entries: FileEntry[] = [];

  let dirEntries;
  try {
    dirEntries = await readdir(dir, { withFileTypes: true });
  } catch {
    return entries;
  }

  for (const entry of dirEntries) {
    const fullPath = join(dir, entry.name);
    const relPath = relative(rootDir, fullPath);

    if (shouldExclude(relPath, excludePatterns)) continue;

    if (entry.isDirectory()) {
      const subEntries = await walkDir(fullPath, rootDir, includePatterns, excludePatterns);
      entries.push(...subEntries);
    } else if (entry.isFile() && shouldInclude(relPath, includePatterns)) {
      try {
        const fileStat = await stat(fullPath);
        if (fileStat.size > MAX_FILE_SIZE) continue;

        const content = await readFile(fullPath, 'utf-8');
        const lines = content.split('\n').length;
        entries.push({ relativePath: relPath, lines, size: fileStat.size, content });
      } catch {
        // Skip files we can't read
      }
    }
  }

  return entries;
}

function buildFileTree(files: FileEntry[]): string {
  const lines: string[] = [];
  const dirs = new Map<string, FileEntry[]>();

  for (const file of files) {
    const parts = file.relativePath.split('/');
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
    if (!dirs.has(dir)) dirs.set(dir, []);
    dirs.get(dir)!.push(file);
  }

  const sortedDirs = [...dirs.keys()].sort();
  for (const dir of sortedDirs) {
    if (dir !== '.') {
      const depth = dir.split('/').length - 1;
      const indent = '  '.repeat(depth);
      const dirName = dir.split('/').pop()!;
      lines.push(`${indent}${dirName}/`);
    }
    const dirFiles = dirs.get(dir)!.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    for (const file of dirFiles) {
      const parts = file.relativePath.split('/');
      const depth = parts.length - 1;
      const indent = '  '.repeat(depth);
      lines.push(`${indent}${parts[parts.length - 1]} (${file.lines} lines)`);
    }
  }

  return lines.join('\n');
}

/**
 * Gather project context by scanning files in the project directory.
 * Returns a formatted string with file structure and key file contents.
 */
export async function gatherProjectContext(
  config: ProjectContext,
  cwd: string,
): Promise<string> {
  const projectDir = config.projectDir ? join(cwd, config.projectDir) : cwd;
  const includePatterns = config.include ?? DEFAULT_INCLUDE;
  const excludePatterns = config.exclude ?? DEFAULT_EXCLUDE;
  const maxChars = config.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS;

  const files = await walkDir(projectDir, projectDir, includePatterns, excludePatterns);

  if (files.length === 0) {
    return '';
  }

  // Sort by size (smaller files first - they're more likely to be key config/entry files)
  files.sort((a, b) => a.size - b.size);

  const sections: string[] = ['## Project Context'];

  // File tree
  sections.push('### File Structure');
  sections.push(buildFileTree(files));

  // Key file contents (up to maxChars total)
  let charsUsed = 0;
  const keyFiles: string[] = [];

  for (const file of files) {
    if (!file.content) continue;
    if (charsUsed + file.content.length > maxChars) continue;

    keyFiles.push(`// ${file.relativePath}\n${file.content}`);
    charsUsed += file.content.length;
  }

  if (keyFiles.length > 0) {
    sections.push('### Key Files');
    sections.push(keyFiles.join('\n\n'));
  }

  return sections.join('\n');
}
