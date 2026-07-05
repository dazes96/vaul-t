import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { isTextFile } from './textfiles.js';
import { renderOutline } from './symbols.js';
import { searchAsync } from './search.js';
import type { ProjectIndex } from './projectIndex.js';

export interface ContextFile {
  path: string;
  content: string;
  reason: 'symbol' | 'path' | 'content' | 'related' | 'recent';
}

/**
 * Swappable context-selection strategy. The default (`HeuristicRetriever`)
 * combines symbols, paths, content search, the import graph, and recent-edit
 * signal — no embeddings, no vector database, everything derived from the
 * index that's already being built for free.
 *
 * This interface is the seam for real semantic retrieval later (an
 * embeddings-backed implementation, or a plugin-provided one via
 * `setRetriever()`) without touching any caller — chat and the agent only
 * ever call the module-level `selectContext()` function below.
 */
export interface Retriever {
  selectContext(index: ProjectIndex, query: string, budgetBytes?: number): Promise<ContextFile[]>;
}

const PER_FILE_MAX = 14_000;

export interface RankedFile { path: string; score: number; reason: ContextFile['reason'] }

/**
 * Rank the workspace's files by relevance to a natural-language query, using
 * every signal the index carries: defined symbols (strongest), recent-edit
 * memory, path/filename terms, a content-search fallback for string literals,
 * and import-graph proximity. Shared by both AI context selection and the
 * natural-language codebase search so they stay consistent.
 */
export async function rankFiles(index: ProjectIndex, query: string): Promise<RankedFile[]> {
  const tokens = tokenize(query);
  const scores = new Map<string, { score: number; reason: ContextFile['reason'] }>();

  const bump = (p: string, by: number, reason: ContextFile['reason']) => {
    const cur = scores.get(p);
    if (!cur) scores.set(p, { score: by, reason });
    else cur.score += by;
  };

  // 1. Symbol matches — the strongest signal: finds the file that DEFINES
  //    something the query names, regardless of what the file is called.
  for (const t of tokens) {
    for (const p of index.symbolLookup(t)) bump(p, 15, 'symbol');
    for (const e of index.allFiles()) {
      if (e.symbols.some(s => s.name.toLowerCase().includes(t) && s.name.toLowerCase() !== t)) bump(e.path, 6, 'symbol');
    }
  }

  // 2. Recent-edit / recently-opened memory: files you're actively working on
  //    right now are disproportionately likely to be what an underspecified
  //    question is about. Scored before the path pass so recency wins the
  //    displayed "reason" over the path pass's weak universal depth bonus.
  const recent = index.recentFiles(15);
  recent.forEach((p, i) => bump(p, Math.max(1, 5 - Math.floor(i / 3)), 'recent'));

  // 3. Path / filename term matches (query-driven — these can introduce files).
  for (const e of index.allFiles()) {
    const p = e.path.toLowerCase();
    const base = p.slice(p.lastIndexOf('/') + 1);
    for (const t of tokens) {
      if (base.includes(t)) bump(e.path, 8, 'path');
      else if (p.includes(t)) bump(e.path, 5, 'path');
    }
  }

  // 3b. Structural bonuses are TIE-BREAKERS only: applied to files that already
  //     have a query signal, never to introduce an unmatched file. Without this
  //     guard the shallow-depth bonus would surface random top-level files for
  //     a query that matches nothing.
  for (const [p, v] of scores) {
    if (/(^|\/)(readme|index|main|app|package\.json|composer\.json)/.test(p)) v.score += 2;
    v.score += Math.max(0, 3 - p.split('/').length);
  }

  let ranked = [...scores.entries()]
    .filter(([, v]) => v.score > 0)
    .sort((a, b) => b[1].score - a[1].score)
    .map(([p, v]) => ({ path: p, ...v }));

  // 4. Content-search fallback when symbol/path/recency signals are weak
  //    (e.g. the query is a string literal or comment, not an identifier).
  //    Search per-token, not the joined string — an identifier like
  //    EMERALD_SPECIAL_FLAG tokenizes to "emerald"/"special"/"flag" and would
  //    never match the space-joined phrase, only the individual pieces.
  if (ranked.filter(r => r.score >= 8).length < 3 && tokens.length) {
    const seen = new Set(ranked.map(r => r.path));
    for (const t of tokens.slice(0, 4)) {
      const hits = await searchAsync(index, t, 20);
      for (const h of hits) {
        if (seen.has(h.path)) continue;
        seen.add(h.path);
        ranked.push({ path: h.path, score: 4, reason: 'content' });
      }
    }
  }

  // 5. Graph expansion: bring in files directly related to the top hits.
  const top = ranked.slice(0, 6).map(r => r.path);
  const present = new Set(ranked.map(r => r.path));
  for (const p of top) {
    for (const nb of index.neighbours(p)) {
      if (!present.has(nb)) { ranked.push({ path: nb, score: 3, reason: 'related' }); present.add(nb); }
    }
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

export class HeuristicRetriever implements Retriever {
  async selectContext(index: ProjectIndex, query: string, budgetBytes = 64_000): Promise<ContextFile[]> {
    const ranked = await rankFiles(index, query);

    // Read contents within budget; big files -> outline instead of full text.
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
}

let activeRetriever: Retriever = new HeuristicRetriever();

/** Swap the retrieval strategy (e.g. a plugin registering an embeddings-backed retriever). */
export function setRetriever(r: Retriever): void { activeRetriever = r; }
export function getRetriever(): Retriever { return activeRetriever; }

/** Entry point every caller uses — delegates to whichever retriever is currently active. */
export function selectContext(index: ProjectIndex, query: string, budgetBytes?: number): Promise<ContextFile[]> {
  return activeRetriever.selectContext(index, query, budgetBytes);
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
