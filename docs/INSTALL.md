# Installation guide

## 1. Prerequisites

| Requirement | Why | Get it |
|---|---|---|
| **Node.js 18+** (22 recommended) | runs the server and build | <https://nodejs.org> |
| **git** | version control features | <https://git-scm.com> |
| **Ollama** (recommended) | free local AI models | <https://ollama.com> |

Windows, macOS, and Linux are all supported.

## 2. Get the code

```bash
git clone <this-repo-url> emerald-code-studio
cd emerald-code-studio
npm install
```

`npm install` installs both the server and client workspaces.

## 3. Build and run

```bash
npm run build
npm start -- /path/to/the/project/you/want/to/work/on
```

On Windows (PowerShell):

```powershell
npm run build
npm start -- C:\Users\you\Projects\my-site
```

Open **http://127.0.0.1:4620**. You can switch to any other folder later from
Settings → Workspace, and recent workspaces are remembered.

## 4. Connect a model

### Ollama (recommended, free, offline)

```bash
ollama pull qwen2.5-coder:7b     # great coding model, ~5 GB
# smaller machines:
ollama pull qwen2.5-coder:1.5b
```

Emerald's default provider already points at Ollama — open the AI panel and
start chatting. Pick a different model in Settings → AI model → List available.

Ollama uses your GPU automatically when it has one and falls back to CPU
gracefully; Emerald inherits that behavior since inference runs in the model
server, not in Emerald.

### LM Studio / llama.cpp / vLLM

Start their OpenAI-compatible server, then in Settings pick the matching
preconfigured provider (or edit its Base URL):

- LM Studio: `http://localhost:1234/v1`
- llama.cpp (`llama-server`): `http://localhost:8080/v1`
- vLLM: `http://localhost:8000/v1`

### OpenRouter / OpenAI / Anthropic / Gemini (optional)

1. Settings → API keys → save your key under a name (e.g. `openrouter`).
   Keys are stored **encrypted** in `~/.emerald-code-studio`, never in plain text.
2. Add a provider: kind `openai-compatible` (for OpenRouter/OpenAI),
   `anthropic`, or `gemini`; set the Base URL and model; set
   "API key reference" to the name you saved.

Nothing in the app requires a paid API — these are conveniences, not
dependencies.

## 5. Optional upgrades

**Full TTY terminal** (colors, interactive programs like `htop`/`vim`):

```bash
npm install node-pty -w server
```

Requires build tools (on Windows: `npm install -g windows-build-tools` or
Visual Studio Build Tools). Without it, the terminal uses a portable
pipe-based fallback that runs commands fine.

## 6. Where your data lives

Everything is local, in `~/.emerald-code-studio/`:

| File | Contents |
|---|---|
| `settings.json` | providers, theme, toggles |
| `secrets.enc` + `secret.key` | encrypted API keys |
| `conversations/` | chat history (JSON, yours to grep or delete) |
| `history.json` | undo snapshots for every AI/editor change |

Delete the folder to reset the app completely.
