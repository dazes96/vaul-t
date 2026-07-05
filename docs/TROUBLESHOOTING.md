# Troubleshooting

## The AI panel says the request failed / nothing streams

1. **Is a model server running?** For Ollama: `ollama list` should work and
   `curl http://localhost:11434/api/tags` should return JSON.
2. **Is the right provider active?** Status bar (bottom right) shows the
   active provider and model. Open Settings (Ctrl+,) → check Base URL and
   model name. Use "List available" to confirm Emerald can reach the backend.
3. **Model name typos** are the most common issue — `qwen2.5-coder:7b` and
   `qwen2.5-coder` are different names to Ollama.

## Autocomplete never suggests anything

- It's debounced (~450 ms) and silent on errors by design. Check that the
  active provider works in Chat first, and that autocomplete is enabled in
  Settings. Small models can also legitimately return empty completions.

## The agent talks but never emits actions

Small models sometimes ignore the action format. Fixes, in order:

1. Use a stronger model (7B+ coding models follow it reliably).
2. Rephrase the task to be concrete ("edit file X to do Y").
3. Lower temperature isn't exposed per-request in the UI, but the default is
   already 0.2; persistent failures are a model-capability issue.

## Terminal shows "[Emerald] Basic terminal mode"

The optional `node-pty` native module isn't installed. Commands still work;
interactive TUIs (vim, htop) won't. To upgrade:

```bash
npm install node-pty -w server   # needs a C++ toolchain
```

## The UI is stuck on "Connecting…"

The client can't reach the Emerald server. It retries automatically every
couple of seconds (and there's a **Retry now** button), so this usually clears
on its own once the server finishes starting. If it persists: confirm the
server is running (`npm start`), that it's on the expected port, and that
nothing else is bound to it. In dev mode (`npm run dev`) the UI is served by
Vite on 4621 and proxies the API to the server on 4620 — the "Connecting…"
screen means the 4620 server isn't up yet.

## A save didn't stick

Emerald shows **"Saved <file>"** in the status bar on a successful save and a
red **"Save failed: …"** if the write is rejected (e.g. a permission error).
If a save fails, the tab keeps its unsaved-changes dot — your edits are still
in the editor, nothing is lost; fix the underlying cause and save again.

## Port already in use

```bash
EMERALD_PORT=5000 npm start -- /path/to/project
```

## Windows: `npm install` fails on node-pty

`node-pty` is optional and not in the dependency tree by default — if you
added it and it fails to compile, remove it (`npm uninstall node-pty -w server`)
and use the built-in fallback terminal.

## The file tree is missing folders

`node_modules`, `.git`, `dist`, `vendor` and similar are intentionally hidden
(see `IGNORED_DIRS` in `server/src/util/paths.ts` — edit to taste).

## Git panel says "Not a git repository"

Run `git init` in the terminal panel. The git features shell out to your
system git, so anything git can do, you can do in the terminal too.

## Chat answers ignore my project

Context is selected by filename relevance to your question. Mention specific
file names or folders in your question, or open the Index: `GET
http://127.0.0.1:4620/api/index` shows what the AI sees (`map`). Very large
projects index the first 20,000 files.

## Rolling back an AI change

Activity bar → ↩ Change History → click the entry → confirm. Deleted files
are restored; created files are removed; edits revert to the prior content.

## Reset the app completely

Delete `~/.emerald-code-studio` (Windows: `C:\Users\<you>\.emerald-code-studio`).
Your projects are never stored there — only settings, chat history, and undo
snapshots.
