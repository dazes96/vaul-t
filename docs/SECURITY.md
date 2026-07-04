# Security & privacy

## Network behavior — the complete list

Emerald's server makes outbound connections **only** to the AI endpoints you
configure in Settings (e.g. `http://localhost:11434` for Ollama). There is:

- no telemetry (not disabled — absent from the codebase)
- no update checker
- no account system or remote authentication
- no analytics, crash reporting, or "anonymous usage statistics"

You can verify this: `grep -rn "fetch(" server/src` — every call site is a
provider file or a route acting on your explicit request.

The HTTP server binds to `127.0.0.1` by default, so nothing on your network
can reach your IDE or your files. If you change `EMERALD_HOST`, you are
exposing a tool that can read and write files and run commands as your user —
put a real authentication layer in front of it first.

## Data at rest

| Data | Location | Protection |
|---|---|---|
| Settings | `~/.emerald-code-studio/settings.json` | plain JSON (no secrets inside) |
| API keys | `secrets.enc` | AES-256-GCM, key in `secret.key` (mode 0600) |
| Chat history | `conversations/*.json` | plain JSON — delete freely |
| Undo snapshots | `history.json` | plain JSON |

Honest threat model: the encrypted secret store protects keys from casual
file browsing, backups, and accidental pastes of your settings file. It does
**not** protect against malware running as your user (which could read
`secret.key` too). That's the same model as most desktop tools; use OS-level
disk encryption for stronger guarantees.

## Destructive-action gates

The UI and agent both require explicit confirmation before:

- file or folder deletion (`confirm: true` is enforced server-side, not just in the UI)
- `git reset`
- agent terminal commands (separately configurable for dependency installs)
- any agent file write (always shows a diff first)

Every agent/editor write or delete snapshots the previous state first and can
be rolled back from the Change History panel.

## Path jail

All file APIs resolve paths through `safeJoin()` (`server/src/util/paths.ts`),
which rejects any path that resolves outside the current workspace — including
`../` traversal and absolute paths. Covered by tests (`server/test/paths.test.ts`).

## Prompt-injection awareness

The agent reads files from your workspace and follows model output. A
malicious file in a project you open could try to steer the model into
destructive actions. Your protections: the approval gates above (leave them
on for untrusted code), the workspace jail, and undo history. Treat "open a
stranger's repo + agent mode + approvals off" as the risky combination it is.

## Reporting

Security issues: open an issue or contact the maintainer. There is no bug
bounty — there is also no vendor between you and the fix.
