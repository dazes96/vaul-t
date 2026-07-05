import { Router } from 'express';
import fs from 'node:fs';
import { safeJoin } from '../util/paths.js';
import { writeFileAtomic } from '../util/atomic.js';
import { getProjectIndex } from '../intelligence/manager.js';
import { searchAsync } from '../intelligence/search.js';
import { rankFiles } from '../intelligence/retrieval.js';

const REASON_LABEL: Record<string, string> = {
  symbol: 'defines a matching symbol',
  path: 'file/path name matches',
  content: 'contains matching text',
  related: 'imports/used by a top match',
  recent: 'recently edited',
};

export function searchRoutes(getWorkspace: () => string): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    const query = String(req.query.q ?? '');
    if (!query) return res.json({ results: [] });
    const index = await getProjectIndex(getWorkspace());
    const results = await searchAsync(index, query, 200);
    res.json({ results });
  });

  /**
   * GET /api/search/smart?q= — natural-language, ranked file search. Unlike the
   * exact-text search above, this ranks whole files by relevance across every
   * index signal (symbols, path, content, import graph, recency) and explains
   * WHY each file matched, so you can find "where's the invoice logic" without
   * knowing a filename or exact string.
   */
  r.get('/smart', async (req, res) => {
    const query = String(req.query.q ?? '');
    if (!query.trim()) return res.json({ results: [] });
    const index = await getProjectIndex(getWorkspace());
    const ranked = (await rankFiles(index, query)).slice(0, 40);
    const results = ranked.map(rf => {
      const entry = index.getFile(rf.path);
      const symbols = entry?.symbols.slice(0, 5).map(s => s.name) ?? [];
      return { path: rf.path, reason: REASON_LABEL[rf.reason] ?? rf.reason, score: rf.score, symbols };
    });
    res.json({ results });
  });

  // Replace across files: applies literal find/replace to an explicit file list.
  r.post('/replace', (req, res) => {
    const { find, replace, files } = req.body as { find: string; replace: string; files: string[] };
    let changed = 0;
    for (const rel of files) {
      const abs = safeJoin(getWorkspace(), rel);
      const before = fs.readFileSync(abs, 'utf8');
      const after = before.split(find).join(replace);
      if (after !== before) { writeFileAtomic(abs, after); changed++; }
    }
    res.json({ ok: true, changed });
  });

  return r;
}
