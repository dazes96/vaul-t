# Contributing

Thanks for helping build a genuinely open AI IDE.

## Ground rules (non-negotiable)

Pull requests are rejected if they add any of:

- licensing systems, activation, or feature gating of any kind
- premium tiers, subscriptions, or artificial usage limits
- telemetry, analytics, or any network call not initiated by an explicit user
  action toward a user-configured endpoint
- mandatory accounts or remote authentication
- proprietary dependencies

Limits that exist for safety (like the agent step cap) must always be
user-configurable settings.

## Getting started

```bash
npm install
npm run dev        # server on :4620, client with hot reload on :4621
npm test           # vitest suite
npm run lint       # typecheck both workspaces
```

## Code style

- TypeScript strict mode everywhere.
- Comments explain **constraints and why**, not what the next line does.
- The browser never touches disk or model APIs directly — all through the server.
- New destructive capabilities must go through the approval + undo-history
  path in `server/src/agent/tools.ts`.
- Keep prompts in the two existing locations (`agent/protocol.ts`,
  `routes/aiRoutes.ts`) so they stay auditable.

## Adding features

Check [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) → "Extension points" first;
most features have a designated seam. If yours doesn't, open an issue
describing the seam you'd add.

## Tests

New server logic needs tests under `server/test/`. Bug fixes should include a
test that fails without the fix. Run `npm test` before pushing.

## Commit messages

Short imperative subject, body explaining why when it isn't obvious.
