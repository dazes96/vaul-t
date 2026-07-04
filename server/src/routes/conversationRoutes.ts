import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '../util/paths.js';

interface Conversation {
  id: string;
  title: string;
  workspace: string;
  updatedAt: number;
  messages: { role: string; content: string }[];
}

function convDir(): string {
  const d = path.join(dataDir(), 'conversations');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/** Conversation history, persisted as one JSON file per conversation. */
export function conversationRoutes(): Router {
  const r = Router();

  r.get('/', (req, res) => {
    const workspace = String(req.query.workspace ?? '');
    const items = fs.readdirSync(convDir())
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(convDir(), f), 'utf8')) as Conversation; }
        catch { return null; }
      })
      .filter((c): c is Conversation => !!c && (!workspace || c.workspace === workspace))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(({ id, title, updatedAt }) => ({ id, title, updatedAt }));
    res.json(items);
  });

  r.get('/:id', (req, res) => {
    const file = path.join(convDir(), `${req.params.id.replace(/[^\w-]/g, '')}.json`);
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' });
    res.json(JSON.parse(fs.readFileSync(file, 'utf8')));
  });

  r.post('/', (req, res) => {
    const body = req.body as Partial<Conversation>;
    const id = body.id?.replace(/[^\w-]/g, '') || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const conv: Conversation = {
      id,
      title: body.title || 'Untitled',
      workspace: body.workspace || '',
      updatedAt: Date.now(),
      messages: body.messages ?? [],
    };
    fs.writeFileSync(path.join(convDir(), `${id}.json`), JSON.stringify(conv, null, 2));
    res.json({ id });
  });

  r.delete('/:id', (req, res) => {
    const file = path.join(convDir(), `${req.params.id.replace(/[^\w-]/g, '')}.json`);
    try { fs.unlinkSync(file); } catch { /* already gone */ }
    res.json({ ok: true });
  });

  return r;
}
