import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { isTextFile } from './textfiles.js';
import { mapPool } from './walk.js';
import type { ProjectIndex } from './projectIndex.js';

export interface SearchHit { path: string; line: number; text: string }

/**
 * Non-blocking content search. Reads candidate files from the index with
 * bounded concurrency using fs/promises, so a search across a large repo no
 * longer freezes the event loop (the old searchWorkspace walked and read every
 * file synchronously). Candidate set comes from the already-built index, so we
 * don't re-walk the tree either.
 */
export async function searchAsync(index: ProjectIndex, query: string, maxResults = 200): Promise<SearchHit[]> {
  const q = query.toLowerCase();
  if (!q.trim()) return [];
  const candidates = index.allFiles().filter(e => e.size > 0 && e.size < 500_000 && isTextFile(e.path));
  const hits: SearchHit[] = [];

  await mapPool(candidates, 24, async (e) => {
    if (hits.length >= maxResults) return;
    let content: string;
    try { content = await fsp.readFile(path.join(index.root, e.path), 'utf8'); }
    catch { return; }
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (hits.length >= maxResults) return;
      if (lines[i].toLowerCase().includes(q)) {
        hits.push({ path: e.path, line: i + 1, text: lines[i].trim().slice(0, 200) });
      }
    }
  });

  return hits.slice(0, maxResults);
}
