import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProjectIndex } from '../src/intelligence/projectIndex.js';
import { rankFiles } from '../src/intelligence/retrieval.js';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-smart-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

async function indexOf(files: Record<string, string>): Promise<ProjectIndex> {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  const idx = new ProjectIndex(dir);
  await idx.build();
  return idx;
}

describe('rankFiles (smart search)', () => {
  it('ranks the file that defines a queried symbol first, by symbol reason', async () => {
    const idx = await indexOf({
      'random_name.ts': 'export function calculateTax(amount: number) { return amount * 0.2; }',
      'noise.ts': 'export const unrelated = 1;',
    });
    const ranked = await rankFiles(idx, 'where is tax calculated');
    expect(ranked[0].path).toBe('random_name.ts');
    expect(ranked[0].reason).toBe('symbol');
  });

  it('finds files by natural-language description without a filename', async () => {
    const idx = await indexOf({
      'billing/invoice.ts': 'export function renderInvoice() {}\nexport function invoiceTotal() {}',
      'ui/button.tsx': 'export const Button = () => <button/>;',
    });
    const ranked = await rankFiles(idx, 'invoice total');
    expect(ranked[0].path).toBe('billing/invoice.ts');
  });

  it('pulls in graph-related files as a "related" reason', async () => {
    const idx = await indexOf({
      'db.ts': 'export function query() {}',
      'users.ts': "import { query } from './db';\nexport function listUsers() { return query(); }",
    });
    const ranked = await rankFiles(idx, 'listUsers');
    const paths = ranked.map(r => r.path);
    expect(paths).toContain('users.ts');
    expect(paths).toContain('db.ts');
  });

  it('falls back to content matches for a string literal', async () => {
    const idx = await indexOf({
      'config.ts': 'export const setting = "EMERALD_SPECIAL_FLAG";',
    });
    const ranked = await rankFiles(idx, 'EMERALD_SPECIAL_FLAG');
    expect(ranked.some(r => r.path === 'config.ts')).toBe(true);
  });

  it('returns nothing for a query that matches nothing', async () => {
    const idx = await indexOf({ 'a.ts': 'export const x = 1;' });
    const ranked = await rankFiles(idx, 'zzqqxx_nonexistent_term');
    expect(ranked).toHaveLength(0);
  });
});
