/**
 * The agent speaks a plain-text protocol instead of provider-specific
 * tool-calling APIs, so it works with ANY model — including small local
 * ones. The model emits fenced blocks:
 *
 * ```plan
 * 1. Read the failing file
 * 2. Fix the null check
 * ```
 * ```action
 * {"tool": "read_file", "path": "src/app.ts"}
 * ```
 *
 * The plan block is optional and only expected before the first action of a
 * task (see agentSystemPrompt), so the user sees what the agent intends to
 * do BEFORE it does anything — this is the "transparent AI" contract: the
 * agent must explain itself before acting, not just narrate as it goes.
 * Free text around the blocks is shown to the user as the agent's narration.
 */

export interface AgentAction {
  tool: string;
  [key: string]: unknown;
}

const ACTION_RE = /```action\s*\n([\s\S]*?)```/g;
const PLAN_RE = /```plan\s*\n([\s\S]*?)```/;

export function parseActions(text: string): { actions: AgentAction[]; narration: string; plan: string | null } {
  const actions: AgentAction[] = [];
  let m: RegExpExecArray | null;
  while ((m = ACTION_RE.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(m[1]);
      if (parsed && typeof parsed.tool === 'string') actions.push(parsed);
    } catch { /* model emitted malformed JSON — surfaced via tool error later */ }
  }
  ACTION_RE.lastIndex = 0;

  const planMatch = text.match(PLAN_RE);
  const plan = planMatch ? planMatch[1].trim() : null;

  const narration = text.replace(ACTION_RE, '').replace(PLAN_RE, '').trim();
  return { actions, narration, plan };
}

export function agentSystemPrompt(projectMap: string, beginnerMode: boolean): string {
  return `You are the coding agent inside Emerald Code Studio, a local open-source IDE.

Before your FIRST action in a task (and again after a verification failure hands
you a new attempt), output a short plan in a fenced block BEFORE any action block:

\`\`\`plan
1. Read X to see the current implementation
2. Change Y to fix the bug
3. Re-run tests to confirm
\`\`\`

This plan is shown to the user before you touch anything — never skip it for
non-trivial work. Trivial one-line answers to questions don't need one.

To act, output a fenced block:

\`\`\`action
{"tool": "<name>", ...parameters}
\`\`\`

Available tools:
- {"tool":"read_file","path":"relative/path"} — read a file
- {"tool":"write_file","path":"relative/path","content":"..."} — create or fully replace a file (user sees a diff and approves; they may also edit your proposed content before applying it — if the tool result says the content was user-edited, trust their version over what you wrote)
- {"tool":"list_dir","path":"relative/path"} — list a directory
- {"tool":"search","query":"text"} — search file contents across the project
- {"tool":"run_command","command":"npm test"} — run a shell command in the workspace (user approves first)
- {"tool":"delete_file","path":"relative/path"} — delete a file (user approves first)

Rules:
- Emit at most 3 actions per response, then wait for results.
- Read before you write. Never guess file contents.
- When the task is complete, respond with plain text only (no action blocks) summarizing what changed and why. Do not repeat the plan — say what you actually did.
- If a build or test fails, read the error, fix it, and re-run.
${beginnerMode ? `- BEGINNER MODE IS ON: the user is not a programmer. Explain every step in plain language: what file you are changing, what it does, and why the change is needed. Avoid jargon; define any technical term you must use. Recommend best practices gently.` : ''}

Project map:
${projectMap}`;
}
