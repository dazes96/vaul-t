# Example agent tasks

The Agent mode (AI panel → "Agent") takes a plain-language task and works
through it step by step, asking for your approval before it changes files or
runs commands. These examples show the level of task it handles well.

## Small, focused tasks

> Add a `/health` endpoint to the Express server that returns `{ok: true}` and
> the current uptime.

> Rename the `getUser` function to `fetchUser` everywhere in the project and
> update all imports.

> There is a bug where the search panel shows stale results after switching
> workspaces. Find and fix it.

## Multi-file features

> Create a new React component `UserCard` that shows a name, avatar, and email.
> Add it to the components folder with matching styles, and use it on the
> profile page.

> Add input validation to every API route in `server/src/routes/`: reject
> missing required fields with a 400 and a helpful message.

## Project-level work

> Read the whole project, then write a `TESTING.md` explaining how to run and
> extend the test suite.

> Set up Tailwind CSS in this Vite project: install it, create the config,
> and convert `styles.css` to use Tailwind utilities where sensible.

## Fix-the-build loop

> Run `npm test`. If anything fails, read the failure, fix the code, and run
> the tests again until they pass.

## Writing your own agent-style prompts

The agent works best when your task states:

1. **What** you want (the outcome, not the method)
2. **Where** it applies (file names or folders, if you know them)
3. **How to verify** (a command to run, a behavior to check)

The agent always shows a diff before writing a file and asks before running
commands — you stay in control of every change, and everything it writes can
be rolled back from the Change History panel.
