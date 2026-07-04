import { Router } from 'express';
import fs from 'node:fs';
import { safeJoin } from '../util/paths.js';
import { writeFileAtomic } from '../util/atomic.js';
import { getProjectIndex } from '../intelligence/manager.js';
import { searchAsync } from '../intelligence/search.js';

export function searchRoutes(getWorkspace: () => string): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    const query = String(req.query.q ?? '');
    if (!query) return res.json({ results: [] });
    const index = await getProjectIndex(getWorkspace());
    const results = await searchAsync(index, query, 200);
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
