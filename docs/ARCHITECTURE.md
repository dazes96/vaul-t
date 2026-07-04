# Architecture

Emerald Code Studio is two small programs that talk over localhost:

```mermaid
flowchart LR
    subgraph Browser["Browser (client/)"]
        UI[React UI]
        Monaco[Monaco editor]
        Xterm[xterm.js terminal]
    end

    subgraph Server["Node.js (server/)"]
        API[Express REST API]
        WS[WebSocket hub]
        Agent[Agent loop]
        Providers[Provider layer]
        Indexer[Project indexer]
        Plugins[Plugin loader]
        FS[(Your workspace files)]
    end

    subgraph Models["AI backends (your choice)"]
        Ollama[Ollama]
        LMS[LM Studio / llama.cpp / vLLM]
        Cloud[OpenRouter / OpenAI / Anthropic / Gemini — optional]
    end

    UI -->|/api/*| API
    Xterm -->|/ws/terminal| WS
    UI -->|/ws/agent| WS
    WS --> Agent
    Agent --> Providers
    API --> Providers
    API --> Indexer
    Agent -->|tools| FS
    API --> FS
    Providers --> Ollama
    Providers --> LMS
    Providers --> Cloud
    Plugins --> API
```

Everything runs on your machine. The server binds `127.0.0.1` only; the sole
outbound traffic is to the model endpoints you configure.

## Repository layout

```
server/src/
  index.ts            entry point; wires routes, websockets, plugins, static client
  config.ts           settings + AES-256-GCM encrypted secret store
  terminal.ts         shell over WebSocket (node-pty if present, pipe fallback)
  plugins.ts          plugin discovery and the PluginApi surface
  util/paths.ts       safeJoin() workspace jail + ignore lists
  util/exec.ts        shell-free child process helper
  routes/             one file per REST area: fs, search, git, ai, index,
                      conversations, settings
  providers/          the AI backend layer (see below)
  agent/              protocol.ts (action parsing), tools.ts (execution +
                      undo history), agent.ts (the loop over WebSocket)
  intelligence/       detect.ts (framework detection), indexer.ts (file index,
                      project map, context selection)

client/src/
  main.tsx            bootstrap; loads monacoSetup (offline Monaco bundling)
  App.tsx             layout + global keyboard shortcuts
  api.ts              typed fetch/SSE helpers
  state/store.ts      zustand store: tabs, settings, panels
  components/         one file per UI region (Explorer, EditorArea, AIPanel,
                      TerminalView, GitPanel, SettingsModal, …)
```

## The provider layer

`providers/types.ts` defines the entire contract:

```ts
interface Provider {
  streamChat(messages, opts): AsyncIterable<string>;
  complete(prefix, suffix, opts): Promise<string>;
  listModels(): Promise<string[]>;
}
```

Four implementations ship in-tree: `ollama` (native API), `openai-compatible`
(covers LM Studio, llama.cpp server, vLLM, OpenRouter, OpenAI), `anthropic`,
and `gemini`. `registry.ts` maps a settings entry to an implementation, and
`registerProviderKind()` lets plugins add new kinds without touching core.

Model switching is instant because providers are constructed per request from
current settings — there is no long-lived connection to invalidate.

## The agent

Local models rarely support provider-specific function calling, so the agent
uses a **text protocol** any model can speak (see `agent/protocol.ts`): the
model emits ```` ```action ```` fenced JSON blocks, the server parses and
executes them, and appends results as the next user message. The loop:

```mermaid
sequenceDiagram
    participant User
    participant UI as AI Panel
    participant Agent as Agent loop
    participant Model
    participant Tools

    User->>UI: task
    UI->>Agent: start (WebSocket)
    loop until plain-text answer or step cap
        Agent->>Model: messages (system prompt + project map + history)
        Model-->>Agent: narration + action blocks (streamed to UI)
        alt destructive action (write / delete / command)
            Agent->>UI: approval-request (with diff for writes)
            User->>Agent: approve / reject
        end
        Agent->>Tools: execute
        Tools-->>Agent: results (snapshot saved to undo history first)
        Agent->>Model: TOOL RESULTS: …
    end
    Agent->>UI: done
```

Safety properties:

- **Workspace jail** — every tool path goes through `safeJoin()`, which
  rejects anything resolving outside the workspace.
- **Approval gates** — `write_file` always shows a diff; `run_command` and
  `delete_file` prompt according to your Settings. Dependency installs are a
  separately toggleable category.
- **Undo** — before any write or delete, the previous content is snapshotted
  (`agent/tools.ts`). The History panel rolls back any change.
- **Step cap** — a user-editable setting, not a product limit.

## Project intelligence

`indexer.ts` walks the workspace (skipping `node_modules` etc.), reusing stat
results for unchanged files (incremental). From the index it derives:

- **Detection** (`detect.ts`): frameworks, languages, package manager, build
  tools — from marker files only; nothing is executed.
- **Project map**: a compact markdown tree + facts, injected as system-prompt
  memory into every chat and agent run.
- **Context selection** (`selectContextFiles`): scores files against the
  user's question (path terms, entry-point names, shallow depth) and inlines
  the best ones within a byte budget — how "chat with the entire codebase"
  works without a vector database. Swap this function for embeddings if you
  want; it's one exported function.

## Extension points (stable surfaces)

| To add… | Touch |
|---|---|
| An AI provider kind | one file in `server/src/providers/` + one line in `registry.ts`, **or** a plugin calling `registerProviderKind()` |
| An agent tool | `agent/tools.ts` (`executeTool` switch) + one line in the system prompt in `agent/protocol.ts` |
| An HTTP API | a router file in `server/src/routes/`, mounted in `index.ts`, **or** a plugin `addRoute()` |
| A theme | a `:root[data-theme='name']` block in `client/src/styles.css` |
| A command | `CommandPalette.tsx` commands array, or a plugin `addCommand()` |
| A framework detector | `intelligence/detect.ts` |

## Design rules

1. **The browser never touches disk or models directly** — everything goes
   through the server, so the security chokepoints stay in one process.
2. **Providers are dumb pipes** — no prompt logic lives in them.
3. **Prompts live in exactly two places** — `agent/protocol.ts` and
   `routes/aiRoutes.ts`.
4. **No hidden state** — settings, secrets, history, and conversations are
   plain files in `~/.emerald-code-studio` (secrets encrypted).
5. **Nothing phones home.** Adding telemetry is a rejected-PR category.
