import { Router } from 'express';
import { loadMemory, patchMemory, resetMemory, type ProjectMemory } from '../memory/memory.js';
import { getProjectIndex } from '../intelligence/manager.js';
import { refreshDetected } from '../memory/memory.js';

/** Local project-memory API — inspect, edit, and reset. */
export function memoryRoutes(getWorkspace: () => string): Router {
  const r = Router();

  r.get('/', async (_req, res) => {
    const workspace = getWorkspace();
    // Opportunistically keep the detection snapshot fresh from the live index.
    try {
      const idx = await getProjectIndex(workspace);
      refreshDetected(workspace, {
        frameworks: idx.info.frameworks,
        languages: Object.keys(idx.info.languages),
        packageManager: idx.info.packageManager,
      });
    } catch { /* index not ready — memory still loads */ }
    res.json(loadMemory(workspace));
  });

  r.post('/', (req, res) => {
    const patch = req.body as Partial<ProjectMemory>;
    // workspace is server-authoritative; never let the client repoint it.
    delete (patch as { workspace?: string }).workspace;
    res.json(patchMemory(getWorkspace(), patch));
  });

  r.post('/reset', (req, res) => {
    if (!(req.body as { confirm?: boolean }).confirm) return res.status(400).json({ error: 'Reset requires confirmation' });
    resetMemory(getWorkspace());
    res.json({ ok: true, memory: loadMemory(getWorkspace()) });
  });

  return r;
}
