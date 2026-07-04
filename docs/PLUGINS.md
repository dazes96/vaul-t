# Plugin & extension API

## Plugins (no core changes required)

A plugin is a folder in `plugins/` (repo root; override with
`EMERALD_PLUGINS_DIR`) containing an `index.mjs`:

```
plugins/
  my-plugin/
    index.mjs
```

```js
export default function register(api) {
  // called once at server startup
}
```

Copy a working example to start:

```bash
mkdir -p plugins
cp -r examples/plugins/hello-world plugins/
npm start
```

### The `api` object

| Method | Purpose |
|---|---|
| `api.addRoute(subpath, handler)` | Mount an Express handler at `/api/plugins/<name><subpath>`. Handler gets standard `(req, res)`. |
| `api.registerProviderKind(kind, factory)` | Add a new AI backend type selectable in Settings. `factory(cfg, apiKey)` must return a `Provider` (see below). |
| `api.addCommand({ id, title, description })` | Register a command; the list is served at `GET /api/plugins`. |
| `api.log(...)` | Namespaced console logging. |

### Writing a custom AI provider

```js
export default function register(api) {
  api.registerProviderKind('my-backend', (cfg, apiKey) => ({
    async *streamChat(messages, opts) {
      // call your backend at cfg.baseUrl with cfg.model,
      // yield plain-text deltas as they arrive
      yield 'Hello from my backend';
    },
    async complete(prefix, suffix) { return ''; },
    async listModels() { return ['my-model']; },
  }));
}
```

Then in Settings, add a provider and type `my-backend` as its kind (the kind
field accepts any registered value).

## In-tree extension points

For anything a plugin can't reach, the codebase is deliberately small and
documented — extend it directly:

| Goal | Where |
|---|---|
| New agent tool | `server/src/agent/tools.ts` — add a case to `executeTool`, describe it in the system prompt in `agent/protocol.ts`, and decide whether it belongs in `DESTRUCTIVE_TOOLS` |
| New chat mode | `server/src/routes/aiRoutes.ts` — add an entry to the `modes` map; add the `<option>` in `client/src/components/AIPanel.tsx` |
| New theme | `client/src/styles.css` — copy the `:root[data-theme='light']` block, rename, adjust variables |
| New framework detection | `server/src/intelligence/detect.ts` |
| New keyboard shortcut | `client/src/App.tsx` — the single `onKey` handler |
| New side panel | add a component, an entry in `ActivityBar.tsx`, and a case in `SidePanel.tsx` |
| Smarter context retrieval | replace `selectContextFiles` in `server/src/intelligence/indexer.ts` (e.g. with embeddings) — it's the only function the chat context flow calls |

## Project templates

The agent doubles as a template engine: ask it (Agent mode) to
"scaffold a new <React/Next.js/WordPress plugin/Laravel> project in an empty
folder" and approve the writes. For reusable templates, keep a folder of
starter files anywhere on disk and ask the agent to copy and customize it.
