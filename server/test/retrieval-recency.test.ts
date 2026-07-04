import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProjectIndex } from '../src/intelligence/projectIndex.js';
import { selectContext, setRetriever, getRetriever, HeuristicRetriever, type Retriever } from '../src/intelligence/retrieval.js';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-recency-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); setRetriever(new HeuristicRetriever()); });

describe('recency signal', () => {
  it('boosts a recently touched file into context for a vague query', async () => {
    fs.writeFileSync(path.join(dir, 'unrelated_name.ts'), 'export const nothing = 1;');
    fs.writeFileSync(path.join(dir, 'other.ts'), 'export const alsoNothing = 2;');
    const idx = new ProjectIndex(dir);
    await idx.build();

    idx.touch('unrelated_name.ts');
    const ctx = await selectContext(idx, 'what does this do');
    expect(ctx.some(c => c.path === 'unrelated_name.ts')).toBe(true);
    expect(ctx.find(c => c.path === 'unrelated_name.ts')?.reason).toBe('recent');
  });

  it('forgets a file once it is removed from the index', async () => {
    fs.writeFileSync(path.join(dir, 'gone.ts'), 'export const x = 1;');
    const idx = new ProjectIndex(dir);
    await idx.build();
    idx.touch('gone.ts');
    expect(idx.recentFiles()).toContain('gone.ts');
    idx.removeFile('gone.ts');
    expect(idx.recentFiles()).not.toContain('gone.ts');
  });
});

describe('swappable Retriever interface', () => {
  it('setRetriever() replaces the strategy used by selectContext()', async () => {
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1;');
    const idx = new ProjectIndex(dir);
    await idx.build();

    const custom: Retriever = {
      async selectContext() { return [{ path: 'a.ts', content: 'CUSTOM RESULT', reason: 'path' }]; },
    };
    setRetriever(custom);
    expect(getRetriever()).toBe(custom);

    const ctx = await selectContext(idx, 'anything');
    expect(ctx).toEqual([{ path: 'a.ts', content: 'CUSTOM RESULT', reason: 'path' }]);
  });
});
