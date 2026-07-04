import { Router } from 'express';
import { getProjectIndex } from '../intelligence/manager.js';
import { buildGraph, availableGraphs, type GraphType } from '../intelligence/graph.js';

const VALID: GraphType[] = ['imports', 'components', 'routes', 'hooks', 'focus'];

/** Visual project graphs, built on demand from the live index. */
export function graphRoutes(getWorkspace: () => string): Router {
  const r = Router();

  r.get('/available', async (_req, res) => {
    const idx = await getProjectIndex(getWorkspace());
    res.json({ available: availableGraphs(idx) });
  });

  r.get('/', async (req, res) => {
    const type = (VALID.includes(req.query.type as GraphType) ? req.query.type : 'imports') as GraphType;
    const focus = req.query.focus ? String(req.query.focus) : undefined;
    const idx = await getProjectIndex(getWorkspace());
    res.json(buildGraph(idx, type, focus));
  });

  return r;
}
