# Build instructions

## Commands

| Command | What it does |
|---|---|
| `npm install` | install all workspace dependencies (server + client) |
| `npm run dev` | development mode: server with auto-restart (tsx) + Vite client with hot reload on http://127.0.0.1:4621 |
| `npm run build` | production build: client → `client/dist`, server → `server/dist` |
| `npm start -- <folder>` | run the built app on http://127.0.0.1:4620 with `<folder>` as the workspace |
| `npm test` | run the server test suite (vitest) |
| `npm run lint` | typecheck both workspaces |

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `EMERALD_PORT` | `4620` | HTTP/WebSocket port |
| `EMERALD_HOST` | `127.0.0.1` | bind address (keep it loopback unless you know what you're doing) |
| `EMERALD_WORKSPACE` | last used / cwd | workspace folder |
| `EMERALD_DATA_DIR` | `~/.emerald-code-studio` | settings/history/conversations location |
| `EMERALD_PLUGINS_DIR` | `<repo>/plugins` | plugin discovery folder |

## Production layout

After `npm run build`, the server serves the static client itself — you only
need to keep `server/dist`, `client/dist`, and `node_modules`. A minimal
"install" on another machine is: clone, `npm ci`, `npm run build`, done.

## Tests

```bash
npm test
```

Covers: the workspace path jail, the agent action protocol parser, framework
detection, the incremental indexer, and API integration tests (file system,
search, index, settings, secret encryption) via supertest. Add new test files
under `server/test/*.test.ts`.
