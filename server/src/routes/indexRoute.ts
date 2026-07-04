import { Router } from 'express';
import { buildIndex, type ProjectIndex } from '../intelligence/indexer.js';

// One cached index per workspace; rebuilt incrementally on demand.
const cache = new Map<string, ProjectIndex>();

export function getIndex(workspace: string, forceRefresh = false): ProjectIndex {
  const cached = cache.get(workspace);
  if (cached && !forceRefresh && Date.now() - cached.builtAt < 30_000) return cached;
  const fresh = buildIndex(workspace, cached);
  cache.set(workspace, fresh);
  return fresh;
}

export function indexRoutes(getWorkspace: () => string): Router {
  const r = Router();

  r.get('/', (req, res) => {
    const idx = getIndex(getWorkspace(), req.query.refresh === '1');
    res.json({
      builtAt: idx.builtAt,
      fileCount: idx.files.length,
      info: idx.info,
      map: idx.map,
    });
  });

  return r;
}
