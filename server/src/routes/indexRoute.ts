import { Router } from 'express';
import { getProjectIndex, rebuildProjectIndex } from '../intelligence/manager.js';

/** Backwards-compatible accessor used by the agent and AI routes. */
export function getIndex(workspace: string) {
  return getProjectIndex(workspace);
}

export function indexRoutes(getWorkspace: () => string): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    const idx = req.query.refresh === '1'
      ? await rebuildProjectIndex(getWorkspace())
      : await getProjectIndex(getWorkspace());
    res.json({
      builtAt: idx.builtAt,
      fileCount: idx.fileCount,
      symbolCount: idx.symbolCount,
      edgeCount: idx.edgeCount,
      info: idx.info,
      map: idx.map,
    });
  });

  /** Flat file list (used by the command palette — replaces fragile map parsing). */
  r.get('/files', async (_req, res) => {
    const idx = await getProjectIndex(getWorkspace());
    res.json(idx.filePaths());
  });

  /** Symbols defined in a file — foundation for future outline/go-to-symbol. */
  r.get('/symbols', async (req, res) => {
    const idx = await getProjectIndex(getWorkspace());
    const entry = idx.getFile(String(req.query.path));
    res.json(entry?.symbols ?? []);
  });

  /** Dependency-graph neighbours of a file — what it imports and what imports it. */
  r.get('/graph', async (req, res) => {
    const idx = await getProjectIndex(getWorkspace());
    const p = String(req.query.path);
    res.json({ imports: idx.importsOf(p), importedBy: idx.importedBy(p) });
  });

  return r;
}
