import { Router } from 'express';
import { loadSettings, saveSettings, setSecret, listSecretNames, type Settings } from '../config.js';
import { readHistory, rollback } from '../agent/tools.js';

export function settingsRoutes(): Router {
  const r = Router();

  r.get('/', (_req, res) => {
    res.json({ settings: loadSettings(), secretNames: listSecretNames() });
  });

  r.post('/', (req, res) => {
    const incoming = req.body as Partial<Settings>;
    const merged = { ...loadSettings(), ...incoming };
    saveSettings(merged);
    res.json({ ok: true });
  });

  /** Store an API key. The value is written to the encrypted store, never to settings.json. */
  r.post('/secret', (req, res) => {
    const { name, value } = req.body as { name: string; value: string };
    if (!name) return res.status(400).json({ error: 'name required' });
    setSecret(name, value);
    res.json({ ok: true });
  });

  // --- Change history / rollback ---
  r.get('/history', (req, res) => {
    const workspace = String(req.query.workspace ?? '');
    const entries = readHistory()
      .filter(e => !workspace || e.workspace === workspace)
      .slice(-100)
      .reverse()
      .map(({ id, time, path, kind }) => ({ id, time, path, kind }));
    res.json(entries);
  });

  r.post('/rollback', (req, res) => {
    const { id } = req.body as { id: string };
    res.json(rollback(id));
  });

  return r;
}
