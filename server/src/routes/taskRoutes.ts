import { Router } from 'express';
import { detectTasks, listTasks, startTask, stopTask, restartTask, getTaskLog, subscribeTask } from '../tasks.js';

export function taskRoutes(getWorkspace: () => string): Router {
  const r = Router();

  r.get('/', (_req, res) => {
    const workspace = getWorkspace();
    res.json({ detected: detectTasks(workspace), running: listTasks(workspace) });
  });

  r.post('/start', (req, res) => {
    const { name, command, args } = req.body as { name?: string; command?: string; args?: string[] };
    const workspace = getWorkspace();
    if (command) {
      res.json(startTask(workspace, name || command, command, args ?? []));
      return;
    }
    if (name) {
      const detected = detectTasks(workspace).find(t => t.name === name);
      if (!detected) return res.status(404).json({ error: `No script named "${name}" in package.json` });
      res.json(startTask(workspace, detected.name, detected.command, detected.args));
      return;
    }
    res.status(400).json({ error: 'Provide either "name" (a package.json script) or "command"' });
  });

  r.post('/:id/stop', (req, res) => {
    res.json({ ok: stopTask(req.params.id) });
  });

  r.post('/:id/restart', (req, res) => {
    const info = restartTask(req.params.id);
    if (!info) return res.status(404).json({ error: 'Task not found' });
    res.json(info);
  });

  /** Live log stream: sends the buffered backlog first, then chunks as they arrive. */
  r.get('/:id/stream', (req, res) => {
    res.setHeader('content-type', 'text/event-stream');
    res.setHeader('cache-control', 'no-cache');
    res.flushHeaders();
    res.write(`data: ${JSON.stringify({ type: 'backlog', log: getTaskLog(req.params.id) })}\n\n`);
    const unsubscribe = subscribeTask(req.params.id, (chunk) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify({ type: 'chunk', chunk })}\n\n`);
    });
    req.on('close', unsubscribe);
  });

  return r;
}
