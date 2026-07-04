# 💎 Emerald Code Studio

A **fully open-source, local-first AI coding IDE**. Think Cursor, but it runs
entirely on your own computer, costs nothing, phones home to no one, and every
line of it belongs to you.

- **No subscription. No premium tier. No feature gates. No usage caps.**
- **No account. No telemetry. No cloud lock-in.**
- Works completely **offline** with local models (Ollama, LM Studio, llama.cpp, vLLM)
- Optional support for OpenRouter / OpenAI / Anthropic / Gemini-compatible APIs — never required
- MIT licensed: use it, change it, sell it, fork it — forever

## What you get

| Area | Features |
|---|---|
| **Editor** | Monaco (the VS Code editor engine), tabs, themes (dark/light), search & replace across files, markdown preview, image viewer, JSON viewer, command palette (Ctrl+P) |
| **AI Chat** | Chat with your whole codebase — relevant files are selected and included automatically. Modes: Chat, Explain (beginner-friendly), Review, Docs |
| **AI Agent** | Plans before it acts (shown to you as a plan card), edits multiple files, runs commands. Every write shows an **editable diff** you approve, reject, or modify; every run is **undoable as one checkpoint** from Change History |
| **Self-healing** | After the agent changes files, it automatically typechecks/lints/tests/builds and hands failures back to itself to fix — bounded by a setting you control, never unattended forever |
| **Cancellation** | Stop actually stops: a running verification step or terminal command is killed within seconds, not left to time out |
| **Tasks** | Dev servers and watch builds as trackable, stoppable/restartable processes with live logs — distinct from the terminal, never orphaned |
| **Autocomplete** | Inline AI completions as you type, powered by whatever model you choose |
| **Terminal** | Real integrated shell (bottom panel) |
| **Git** | Status, stage, commit, diff, log, reset — via your system git |
| **Project intelligence** | Async, incremental, symbol- and import-graph-aware index kept live by a background watcher; automatic framework detection (React, Next.js, Vue, Laravel, WordPress themes & plugins, Tailwind, Docker…); retrieval finds code by what it *does*, not just filename matches |
| **Project memory** | Local, per-project, editable memory of architecture, conventions, preferences, important files, known bugs, and prior fixes. The agent plans *with* it and appends to it after successful tasks — relevance-filtered, never dumped wholesale, safe to reset |
| **Visual graphs** | On-demand dependency, component, route, and WordPress-hook graphs drawn from the live index (no duplicate parsing); click a node to open the file |
| **Beginner mode** | One toggle and the AI explains everything in plain language, assumes zero programming knowledge, and describes each change before making it |
| **Extensibility** | Plugin system (server routes, commands, new AI provider kinds, swappable retrieval strategy), documented architecture, clear extension APIs |

## Quick start

Requires [Node.js 18+](https://nodejs.org) and git.

```bash
git clone <this-repo>
cd emerald-code-studio
npm install
npm run build
npm start -- /path/to/your/project
```

Open **http://127.0.0.1:4620** in your browser. That's it — no sign-up, no key.

To use a local model, install [Ollama](https://ollama.com) and pull a coding model:

```bash
ollama pull qwen2.5-coder:7b
```

Emerald talks to Ollama at `http://localhost:11434` out of the box. Pick a
different provider or model anytime from **Settings (Ctrl+,)** — switching is
instant.

### Development mode (hot reload)

```bash
npm run dev
```

Then open http://127.0.0.1:4621 (Vite dev server; the API runs on 4620).

## Keyboard shortcuts

| Keys | Action |
|---|---|
| `Ctrl+S` | Save file |
| `Ctrl+P` | Quick open file / `>` for commands |
| `Ctrl+L` | Toggle AI panel |
| `Ctrl+J` | Toggle terminal panel |
| `Ctrl+,` | Settings |

## Documentation

- [Installation guide](docs/INSTALL.md)
- [Architecture](docs/ARCHITECTURE.md) — diagrams and how it all fits together
- [Build instructions](docs/BUILD.md)
- [Plugin & extension API](docs/PLUGINS.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Security & privacy](docs/SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Example plugins](examples/plugins/) · [Example agent tasks](examples/agents/)

## Philosophy

This project will never contain a licensing system, premium tier,
subscription, feature lock, activation step, remote authentication, artificial
usage limit, or proprietary dependency. Any limit you find (like the agent's
default step cap) is a **setting you can change**, not a restriction. If a
contribution introduces any of the above, it gets rejected.

The server binds to `127.0.0.1` only. The only network calls it ever makes are
to the AI endpoints **you** configure. No telemetry exists in the codebase —
not off-by-default, just absent.

## License

[MIT](LICENSE). You own every line.
