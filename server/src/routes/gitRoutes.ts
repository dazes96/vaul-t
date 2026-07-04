import { Router } from 'express';
import { run } from '../util/exec.js';

/** Git integration via the system git binary — no bundled implementation to trust. */
export function gitRoutes(getWorkspace: () => string): Router {
  const r = Router();
  const git = (args: string[]) => run('git', args, getWorkspace());

  r.get('/status', async (_req, res) => {
    const [status, branch] = await Promise.all([
      git(['status', '--porcelain=v1']),
      git(['rev-parse', '--abbrev-ref', 'HEAD']),
    ]);
    if (status.code !== 0) return res.json({ isRepo: false });
    const files = status.stdout.split('\n').filter(Boolean).map(line => ({
      status: line.slice(0, 2).trim(),
      path: line.slice(3),
    }));
    res.json({ isRepo: true, branch: branch.stdout.trim(), files });
  });

  r.get('/diff', async (req, res) => {
    const path = String(req.query.path ?? '');
    const out = await git(path ? ['diff', '--', path] : ['diff']);
    res.json({ diff: out.stdout });
  });

  r.get('/log', async (_req, res) => {
    const out = await git(['log', '--oneline', '-30']);
    res.json({ log: out.stdout });
  });

  r.post('/stage', async (req, res) => {
    const { paths } = req.body as { paths: string[] };
    const out = await git(['add', '--', ...paths]);
    res.json({ ok: out.code === 0, error: out.stderr });
  });

  r.post('/unstage', async (req, res) => {
    const { paths } = req.body as { paths: string[] };
    const out = await git(['reset', 'HEAD', '--', ...paths]);
    res.json({ ok: out.code === 0, error: out.stderr });
  });

  r.post('/commit', async (req, res) => {
    const { message } = req.body as { message: string };
    if (!message?.trim()) return res.status(400).json({ error: 'Commit message required' });
    const out = await git(['commit', '-m', message]);
    res.json({ ok: out.code === 0, output: out.stdout || out.stderr });
  });

  // git reset is destructive: requires explicit confirm flag (UI prompts).
  r.post('/reset', async (req, res) => {
    const { confirm, hard } = req.body as { confirm?: boolean; hard?: boolean };
    if (!confirm) return res.status(400).json({ error: 'Reset requires confirmation' });
    const out = await git(hard ? ['reset', '--hard'] : ['reset']);
    res.json({ ok: out.code === 0, output: out.stdout || out.stderr });
  });

  return r;
}
