import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { safeJoin, isIgnoredDir } from '../util/paths.js';
import { writeFileAtomic } from '../util/atomic.js';
import { snapshotBeforeChange } from '../agent/tools.js';

/** File system API. Every path is workspace-relative and jailed by safeJoin. */
export function fsRoutes(getWorkspace: () => string): Router {
  const r = Router();

  r.get('/tree', (req, res) => {
    const root = getWorkspace();
    const rel = String(req.query.path ?? '');
    const abs = safeJoin(root, rel || '.');
    const entries = fs.readdirSync(abs, { withFileTypes: true })
      .filter(e => !isIgnoredDir(e.name))
      .map(e => ({
        name: e.name,
        path: rel ? `${rel}/${e.name}` : e.name,
        type: e.isDirectory() ? 'dir' as const : 'file' as const,
      }))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
    res.json(entries);
  });

  r.get('/read', (req, res) => {
    const abs = safeJoin(getWorkspace(), String(req.query.path));
    const buf = fs.readFileSync(abs);
    const ext = path.extname(abs).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp'].includes(ext)) {
      res.json({ kind: 'image', base64: buf.toString('base64'), ext });
    } else {
      res.json({ kind: 'text', content: buf.toString('utf8') });
    }
  });

  r.post('/write', (req, res) => {
    const { path: rel, content } = req.body as { path: string; content: string };
    const abs = safeJoin(getWorkspace(), rel);
    snapshotBeforeChange(getWorkspace(), rel, 'write');
    writeFileAtomic(abs, content);
    res.json({ ok: true });
  });

  r.post('/create', (req, res) => {
    const { path: rel, type } = req.body as { path: string; type: 'file' | 'dir' };
    const abs = safeJoin(getWorkspace(), rel);
    if (fs.existsSync(abs)) return res.status(409).json({ error: 'Already exists' });
    if (type === 'dir') fs.mkdirSync(abs, { recursive: true });
    else { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, ''); }
    res.json({ ok: true });
  });

  r.post('/rename', (req, res) => {
    const { from, to } = req.body as { from: string; to: string };
    fs.renameSync(safeJoin(getWorkspace(), from), safeJoin(getWorkspace(), to));
    res.json({ ok: true });
  });

  // Deletion requires the client to send confirm:true — the UI always prompts first.
  r.post('/delete', (req, res) => {
    const { path: rel, confirm } = req.body as { path: string; confirm?: boolean };
    if (!confirm) return res.status(400).json({ error: 'Deletion requires confirmation' });
    const abs = safeJoin(getWorkspace(), rel);
    const st = fs.statSync(abs);
    if (st.isDirectory()) fs.rmSync(abs, { recursive: true });
    else {
      snapshotBeforeChange(getWorkspace(), rel, 'delete');
      fs.unlinkSync(abs);
    }
    res.json({ ok: true });
  });

  return r;
}
