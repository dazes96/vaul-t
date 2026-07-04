import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { isTextFile } from './textfiles.js';
import { renderOutline } from './symbols.js';
import { searchAsync } from './search.js';
import type { ProjectIndex } from './projectIndex.js';

export interface ContextFile {
  path: string;
  content: string;
  reason: 'symbol' | 'path' | 'content' | 'related';
}

const PER_FILE_MAX = 14_000;

/**
 * Choose the files most relevant to a query and return their contents for the
 * model. Unlike the old filename-substring approach, this scores on:
 *   - defined symbols (a query mentioning `parseActions` finds the file that
 *     defines it, even if the filename is unrelated)
 *   - path and filename terms
 *   - import-graph proximity (pull in directly-related files)
 *   - a content-search fallback so string literals are still findable
 * Large files are included as a symbol outline instead of full text, so the
 * model still sees their shape without blowing the byte budget.
 */
export async function selectContext(index: ProjectIndex, query: string, budgetBytes = 64_000): Promise<ContextFile[]> {
  const tokens = tokenize(query);
  const scores = new Map<string, { score: number; reason: ContextFile['reason'] }>();

  const bump = (p: string, by: number, reason: ContextFile['reason']) => {
    const cur = scores.get(p);
    if (!cur || by > cur.score) scores.set(p, { score: (cur?.score ?? 0) + by, reason: cur ? cur.reason : reason });
    else cur.score += by;
  };

  // 1. Symbol matches — the strongest signal.
  for (const t of tokens) {
    for (const p of index.symbolLookup(t)) bump(p, 15, 'symbol');
    // partial symbol name matches
    for (const e of index.allFiles()) {
      if (e.symbols.some(s => s.name.toLowerCase().includes(t) && s.name.toLowerCase() !== t)) bump(e.path, 6, 'symbol');
    }
  }

  // 2. Path / filename terms + structural bonuses.
  for (const e of index.allFiles()) {
    const p = e.path.toLowerCase();
    const base = p.slice(p.lastIndexOf('/') + 1);
    for (const t of tokens) {
      if (base.includes(t)) bump(e.path, 8, 'path');
      else if (p.includes(t)) bump(e.path, 5, 'path');
    }
    if (/(^|\/)(readme|index|main|app|package\.json|composer\.json)/.test(p)) bump(e.path, 2, 'path');
    bump(e.path, Math.max(0, 3 - e.path.split('/').length), 'path');
  }

  let ranked = [...scores.entries()]
    .filter(([, v]) => v.score > 0)
    .sort((a, b) => b[1].score - a[1].score)
    .map(([p, v]) => ({ path: p, ...v }));

  // 3. Content-search fallback when symbol/path signals are weak (e.g. the
  //    query is a string literal or comment, not an identifier).
  if (ranked.filter(r => r.score >= 8).length < 3 && tokens.length) {
    const hits = await searchAsync(index, tokens.join(' '), 40);
    const seen = new Set(ranked.map(r => r.path));
    for (const h of hits) if (!seen.has(h.path)) { ranked.push({ path: h.path, score: 4, reason: 'content' }); seen.add(h.path); }
  }

  // 4. Graph expansion: bring in files directly related to the top hits.
  const top = ranked.slice(0, 6).map(r => r.path);
  const present = new Set(ranked.map(r => r.path));
  for (const p of top) {
    for (const nb of index.neighbours(p)) {
      if (!present.has(nb)) { ranked.push({ path: nb, score: 3, reason: 'related' }); present.add(nb); }
    }
  }

  ranked.sort((a, b) => b.score - a.score);

  // 5. Read contents within budget; big files -> outline.
  const out: ContextFile[] = [];
  let used = 0;
  for (const r of ranked) {
    if (out.length >= 14) break;
    const entry = index.getFile(r.path);
    if (!entry || !isTextFile(r.path)) continue;
    try {
      if (entry.size > PER_FILE_MAX && entry.symbols.length) {
        const head = (await fsp.readFile(path.join(index.root, r.path), 'utf8')).slice(0, 2000);
        const body = `// (large file — showing outline + head)\n// symbols:\n${renderOutline(entry.symbols)}\n\n${head}`;
        if (used + body.length > budgetBytes) continue;
        out.push({ path: r.path, content: body, reason: r.reason });
        used += body.length;
      } else {
        if (used + entry.size > budgetBytes) continue;
        const content = await fsp.readFile(path.join(index.root, r.path), 'utf8');
        out.push({ path: r.path, content, reason: r.reason });
        used += content.length;
      }
    } catch { /* skip unreadable */ }
  }
  return out;
}

function tokenize(query: string): string[] {
  const raw = query.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2);
  // Also split camelCase/identifiers so "parseActions" matches "parse"/"actions".
  const extra: string[] = [];
  for (const t of query.split(/[^A-Za-z0-9]+/)) {
    for (const part of t.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(' ')) {
      if (part.length > 2) extra.push(part);
    }
  }
  return [...new Set([...raw, ...extra])];
}
