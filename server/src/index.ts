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
import { handleTerminalSocket } from './terminal.js';
import { handleAgentSocket } from './agent/agent.js';
import { loadPlugins, type LoadedPlugin } from './plugins.js';

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
  app.use(express.json({ limit: '50mb' }));

  app.use('/api/fs', fsRoutes(getWorkspace));
  app.use('/api/search', searchRoutes(getWorkspace));
  app.use('/api/git', gitRoutes(getWorkspace));
  app.use('/api/index', indexRoutes(getWorkspace));
  app.use('/api/ai', aiRoutes(getWorkspace));
  app.use('/api/conversations', conversationRoutes());
  app.use('/api/settings', settingsRoutes());

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
  const wss = new WebSocketServer({ server });
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
}

// Only start the server when run directly (tests import createApp instead).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
