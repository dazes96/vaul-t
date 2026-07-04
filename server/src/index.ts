import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'node:url';
import { loadSettings, saveSettings } from './config.js';
import { fsRoutes } from './routes/fsRoutes.js';
import { searchRoutes } from './routes/searchRoutes.js';
import { gitRoutes } from './routes/gitRoutes.js';
import { indexRoutes } from './routes/indexRoute.js';
import { aiRoutes } from './routes/aiRoutes.js';
import { conversationRoutes } from './routes/conversationRoutes.js';
import { settingsRoutes } from './routes/settingsRoutes.js';
import { verifyRoutes } from './routes/verifyRoutes.js';
import { taskRoutes } from './routes/taskRoutes.js';
import { memoryRoutes } from './routes/memoryRoutes.js';
import { graphRoutes } from './routes/graphRoutes.js';
import { handleTerminalSocket } from './terminal.js';
import { handleAgentSocket } from './agent/agent.js';
import { loadPlugins, type LoadedPlugin } from './plugins.js';
import { isAllowedOrigin } from './util/origin.js';
import { closeAllIndexes } from './intelligence/manager.js';
import { killAllTasks } from './tasks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.EMERALD_PORT || 4620);
// Bind to localhost only: the IDE is yours, not the network's.
const HOST = process.env.EMERALD_HOST || '127.0.0.1';

// Current workspace: CLI arg > env > last used > cwd
let workspace = path.resolve(
  process.argv[2] || process.env.EMERALD_WORKSPACE || loadSettings().recentWorkspaces[0] || process.cwd(),
);
const getWorkspace = () => workspace;

export function createApp(): express.Express {
  const app = express();

  // Cross-origin guard: block browser requests from non-loopback pages before
  // they can reach any file/terminal/git endpoint. Non-browser clients (no
  // Origin header) pass through. See util/origin.ts for the rationale.
  app.use((req, res, next) => {
    if (isAllowedOrigin(req.headers.origin)) return next();
    res.status(403).json({ error: 'Cross-origin request blocked' });
  });

  app.use(express.json({ limit: '25mb' }));

  app.use('/api/fs', fsRoutes(getWorkspace));
  app.use('/api/search', searchRoutes(getWorkspace));
  app.use('/api/git', gitRoutes(getWorkspace));
  app.use('/api/index', indexRoutes(getWorkspace));
  app.use('/api/ai', aiRoutes(getWorkspace));
  app.use('/api/conversations', conversationRoutes());
  app.use('/api/settings', settingsRoutes());
  app.use('/api/verify', verifyRoutes(getWorkspace));
  app.use('/api/tasks', taskRoutes(getWorkspace));
  app.use('/api/memory', memoryRoutes(getWorkspace));
  app.use('/api/graph', graphRoutes(getWorkspace));

  app.get('/api/workspace', (_req, res) => {
    res.json({ workspace, recent: loadSettings().recentWorkspaces });
  });

  app.post('/api/workspace', (req, res) => {
    const { path: p } = req.body as { path: string };
    const abs = path.resolve(p);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
      return res.status(400).json({ error: 'Not a directory' });
    }
    workspace = abs;
    const s = loadSettings();
    s.recentWorkspaces = [abs, ...s.recentWorkspaces.filter(w => w !== abs)].slice(0, 10);
    saveSettings(s);
    res.json({ ok: true, workspace });
  });

  // Express error handler: JSON errors instead of HTML stack pages.
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err.message });
  });

  return app;
}

async function main() {
  const app = createApp();

  let plugins: LoadedPlugin[] = [];
  const pluginsDir = process.env.EMERALD_PLUGINS_DIR || path.resolve(__dirname, '../../plugins');
  plugins = await loadPlugins(app, pluginsDir);
  app.get('/api/plugins', (_req, res) => res.json(plugins));

  // Serve the built client (production). In dev, Vite serves the client itself.
  const clientDist = path.resolve(__dirname, '../../client/dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  const server = http.createServer(app);
  // verifyClient rejects the WebSocket upgrade for cross-origin pages, so a
  // malicious site can never open the terminal or agent socket. The terminal
  // socket spawns a real shell — this check is what keeps that off the network.
  const wss = new WebSocketServer({
    server,
    verifyClient: (info: { origin: string }) => isAllowedOrigin(info.origin),
  });
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/ws/terminal') void handleTerminalSocket(ws, workspace);
    else if (url.pathname === '/ws/agent') handleAgentSocket(ws, workspace);
    else ws.close();
  });

  server.listen(PORT, HOST, () => {
    console.log(`\n  Emerald Code Studio`);
    console.log(`  workspace: ${workspace}`);
    console.log(`  open:      http://${HOST}:${PORT}\n`);
  });

  // Graceful shutdown: close every live socket (each ws 'close' handler kills
  // its child shell/agent process) and stop accepting connections, so Ctrl+C
  // never orphans a terminal or leaves the port held.
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n  ${signal} received — shutting down cleanly…`);
    for (const client of wss.clients) client.close();
    wss.close();
    void closeAllIndexes();
    killAllTasks();
    server.close(() => process.exit(0));
    // Drop lingering HTTP keep-alive sockets so close() returns promptly
    // instead of waiting for idle connections to time out.
    server.closeAllConnections?.();
    // Hard-stop if something still refuses to release within 5s.
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Only start the server when run directly (tests import createApp instead).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
