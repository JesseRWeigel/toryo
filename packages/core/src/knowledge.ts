/**
 * Simple JSON-based knowledge store for cross-agent context sharing.
 * NOT a graph database — just a persistent key-value store that agents
 * can read from and that the orchestrator updates with cycle results.
 *
 * @see https://github.com/JesseRWeigel/toryo/issues/1
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface KnowledgeEntry {
  key: string;
  value: string;
  source: string;
  timestamp: string;
  tags: string[];
}

interface KnowledgeData {
  entries: KnowledgeEntry[];
}

const KNOWLEDGE_FILE = 'knowledge.json';

export function createKnowledgeStore(outputDir: string) {
  const filePath = join(outputDir, KNOWLEDGE_FILE);

  async function load(): Promise<KnowledgeData> {
    try {
      const raw = await readFile(filePath, 'utf-8');
      return JSON.parse(raw) as KnowledgeData;
    } catch {
      return { entries: [] };
    }
  }

  async function save(data: KnowledgeData): Promise<void> {
    await mkdir(outputDir, { recursive: true });
    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async function get(key: string): Promise<KnowledgeEntry | null> {
    const data = await load();
    return data.entries.find((e) => e.key === key) ?? null;
  }

  async function set(
    key: string,
    value: string,
    source: string,
    tags: string[] = [],
  ): Promise<void> {
    const data = await load();
    const entry: KnowledgeEntry = {
      key,
      value,
      source,
      timestamp: new Date().toISOString(),
      tags,
    };

    // Upsert: replace existing entry with same key, or append
    const idx = data.entries.findIndex((e) => e.key === key);
    if (idx >= 0) {
      data.entries[idx] = entry;
    } else {
      data.entries.push(entry);
    }

    await save(data);
  }

  async function search(query: string): Promise<KnowledgeEntry[]> {
    const data = await load();
    const lower = query.toLowerCase();
    return data.entries.filter(
      (e) =>
        e.key.toLowerCase().includes(lower) ||
        e.value.toLowerCase().includes(lower),
    );
  }

  async function getByTag(tag: string): Promise<KnowledgeEntry[]> {
    const data = await load();
    return data.entries.filter((e) => e.tags.includes(tag));
  }

  async function getRecent(n: number): Promise<KnowledgeEntry[]> {
    const data = await load();
    // Entries are in insertion order; return last N
    return data.entries.slice(-n);
  }

  async function toContext(maxChars = 4000): Promise<string> {
    const data = await load();
    if (data.entries.length === 0) return '';

    const lines: string[] = ['## Previous Knowledge'];
    let charCount = lines[0].length;

    // Walk entries from newest to oldest so most recent context comes first
    for (let i = data.entries.length - 1; i >= 0; i--) {
      const e = data.entries[i];
      const line = `- **${e.key}** (${e.source}): ${e.value}`;
      if (charCount + line.length + 1 > maxChars) break;
      lines.push(line);
      charCount += line.length + 1; // +1 for newline
    }

    return lines.join('\n');
  }

  async function clear(): Promise<void> {
    await save({ entries: [] });
  }

  return { get, set, search, getByTag, getRecent, toContext, clear };
}
