import { Router } from 'express';
import fs from 'node:fs';
import { safeJoin } from '../util/paths.js';
import { writeFileAtomic } from '../util/atomic.js';
import { searchWorkspace } from '../agent/tools.js';

export function searchRoutes(getWorkspace: () => string): Router {
  const r = Router();

  r.get('/', (req, res) => {
    const query = String(req.query.q ?? '');
    if (!query) return res.json({ results: [] });
    const raw = searchWorkspace(getWorkspace(), query, 200);
    const results = raw === '(no matches)' ? [] : raw.split('\n').map(line => {
      const m = line.match(/^(.+?):(\d+): (.*)$/);
      return m ? { path: m[1], line: Number(m[2]), text: m[3] } : null;
    }).filter(Boolean);
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
