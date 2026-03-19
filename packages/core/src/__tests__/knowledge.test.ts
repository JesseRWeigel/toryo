import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createKnowledgeStore } from '../knowledge.js';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'toryo-knowledge-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('createKnowledgeStore', () => {
  describe('get/set', () => {
    it('returns null for missing key', async () => {
      const store = createKnowledgeStore(tempDir);
      expect(await store.get('nonexistent')).toBeNull();
    });

    it('stores and retrieves an entry', async () => {
      const store = createKnowledgeStore(tempDir);
      await store.set('test-key', 'test-value', 'agent-1', ['tag1']);
      const entry = await store.get('test-key');
      expect(entry).not.toBeNull();
      expect(entry!.key).toBe('test-key');
      expect(entry!.value).toBe('test-value');
      expect(entry!.source).toBe('agent-1');
      expect(entry!.tags).toEqual(['tag1']);
      expect(entry!.timestamp).toBeTruthy();
    });

    it('upserts existing key', async () => {
      const store = createKnowledgeStore(tempDir);
      await store.set('key', 'old-value', 'agent-1', []);
      await store.set('key', 'new-value', 'agent-2', ['updated']);
      const entry = await store.get('key');
      expect(entry!.value).toBe('new-value');
      expect(entry!.source).toBe('agent-2');
      expect(entry!.tags).toEqual(['updated']);
    });

    it('persists to disk as JSON', async () => {
      const store = createKnowledgeStore(tempDir);
      await store.set('disk-key', 'disk-value', 'src', []);
      const raw = await readFile(join(tempDir, 'knowledge.json'), 'utf-8');
      const data = JSON.parse(raw);
      expect(data.entries).toHaveLength(1);
      expect(data.entries[0].key).toBe('disk-key');
    });

    it('creates output directory if it does not exist', async () => {
      const nestedDir = join(tempDir, 'deep', 'nested');
      const store = createKnowledgeStore(nestedDir);
      await store.set('key', 'value', 'src', []);
      const raw = await readFile(join(nestedDir, 'knowledge.json'), 'utf-8');
      expect(JSON.parse(raw).entries).toHaveLength(1);
    });
  });

  describe('search', () => {
    it('returns empty array when no matches', async () => {
      const store = createKnowledgeStore(tempDir);
      await store.set('alpha', 'beta', 'src', []);
      expect(await store.search('zzz')).toEqual([]);
    });

    it('matches on key substring', async () => {
      const store = createKnowledgeStore(tempDir);
      await store.set('cycle-1-build', 'output', 'src', []);
      await store.set('cycle-2-test', 'output', 'src', []);
      const results = await store.search('build');
      expect(results).toHaveLength(1);
      expect(results[0].key).toBe('cycle-1-build');
    });

    it('matches on value substring', async () => {
      const store = createKnowledgeStore(tempDir);
      await store.set('key1', 'implemented feature X', 'src', []);
      await store.set('key2', 'fixed bug Y', 'src', []);
      const results = await store.search('feature');
      expect(results).toHaveLength(1);
      expect(results[0].key).toBe('key1');
    });

    it('is case-insensitive', async () => {
      const store = createKnowledgeStore(tempDir);
      await store.set('MyKey', 'MyValue', 'src', []);
      expect(await store.search('mykey')).toHaveLength(1);
      expect(await store.search('MYVALUE')).toHaveLength(1);
    });
  });

  describe('getByTag', () => {
    it('returns entries matching tag', async () => {
      const store = createKnowledgeStore(tempDir);
      await store.set('a', 'v1', 'src', ['build', 'keep']);
      await store.set('b', 'v2', 'src', ['test', 'discard']);
      await store.set('c', 'v3', 'src', ['build', 'discard']);
      const results = await store.getByTag('build');
      expect(results).toHaveLength(2);
      expect(results.map((e) => e.key).sort()).toEqual(['a', 'c']);
    });

    it('returns empty array when no matches', async () => {
      const store = createKnowledgeStore(tempDir);
      await store.set('a', 'v', 'src', ['x']);
      expect(await store.getByTag('nope')).toEqual([]);
    });
  });

  describe('getRecent', () => {
    it('returns last N entries', async () => {
      const store = createKnowledgeStore(tempDir);
      await store.set('a', '1', 'src', []);
      await store.set('b', '2', 'src', []);
      await store.set('c', '3', 'src', []);
      await store.set('d', '4', 'src', []);
      const recent = await store.getRecent(2);
      expect(recent).toHaveLength(2);
      expect(recent[0].key).toBe('c');
      expect(recent[1].key).toBe('d');
    });

    it('returns all entries if N exceeds count', async () => {
      const store = createKnowledgeStore(tempDir);
      await store.set('a', '1', 'src', []);
      const recent = await store.getRecent(10);
      expect(recent).toHaveLength(1);
    });

    it('returns empty array on empty store', async () => {
      const store = createKnowledgeStore(tempDir);
      expect(await store.getRecent(5)).toEqual([]);
    });
  });

  describe('toContext', () => {
    it('returns empty string for empty store', async () => {
      const store = createKnowledgeStore(tempDir);
      expect(await store.toContext()).toBe('');
    });

    it('formats entries as markdown with header', async () => {
      const store = createKnowledgeStore(tempDir);
      await store.set('cycle-1-build', 'built the thing', 'agent-1', []);
      const ctx = await store.toContext();
      expect(ctx).toContain('## Previous Knowledge');
      expect(ctx).toContain('**cycle-1-build**');
      expect(ctx).toContain('agent-1');
      expect(ctx).toContain('built the thing');
    });

    it('shows newest entries first', async () => {
      const store = createKnowledgeStore(tempDir);
      await store.set('old', 'old-value', 'src', []);
      await store.set('new', 'new-value', 'src', []);
      const ctx = await store.toContext();
      const oldIdx = ctx.indexOf('old-value');
      const newIdx = ctx.indexOf('new-value');
      // Newest should appear first (after header)
      expect(newIdx).toBeLessThan(oldIdx);
    });

    it('respects maxChars limit', async () => {
      const store = createKnowledgeStore(tempDir);
      for (let i = 0; i < 100; i++) {
        await store.set(`key-${i}`, `value-${i}-${'x'.repeat(50)}`, 'src', []);
      }
      const ctx = await store.toContext(200);
      expect(ctx.length).toBeLessThanOrEqual(200);
    });
  });

  describe('clear', () => {
    it('removes all entries', async () => {
      const store = createKnowledgeStore(tempDir);
      await store.set('a', '1', 'src', []);
      await store.set('b', '2', 'src', []);
      await store.clear();
      expect(await store.get('a')).toBeNull();
      expect(await store.get('b')).toBeNull();
      expect(await store.getRecent(10)).toEqual([]);
    });
  });
});
