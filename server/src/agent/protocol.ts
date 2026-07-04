/**
 * The agent speaks a plain-text protocol instead of provider-specific
 * tool-calling APIs, so it works with ANY model — including small local
 * ones. The model emits fenced blocks:
 *
 * ```action
 * {"tool": "read_file", "path": "src/app.ts"}
 * ```
 *
 * Free text around the blocks is shown to the user as the agent's narration.
 */

export interface AgentAction {
  tool: string;
  [key: string]: unknown;
}

const ACTION_RE = /```action\s*\n([\s\S]*?)```/g;

export function parseActions(text: string): { actions: AgentAction[]; narration: string } {
  const actions: AgentAction[] = [];
  let narration = text;
  let m: RegExpExecArray | null;
  while ((m = ACTION_RE.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(m[1]);
      if (parsed && typeof parsed.tool === 'string') actions.push(parsed);
    } catch { /* model emitted malformed JSON — surfaced via tool error later */ }
  }
  narration = text.replace(ACTION_RE, '').trim();
  ACTION_RE.lastIndex = 0;
  return { actions, narration };
}

export function agentSystemPrompt(projectMap: string, beginnerMode: boolean): string {
  return `You are the coding agent inside Emerald Code Studio, a local open-source IDE.
You complete coding tasks by emitting actions. To act, output a fenced block:

\`\`\`action
{"tool": "<name>", ...parameters}
\`\`\`

Available tools:
- {"tool":"read_file","path":"relative/path"} — read a file
- {"tool":"write_file","path":"relative/path","content":"..."} — create or fully replace a file (user sees a diff and approves)
- {"tool":"list_dir","path":"relative/path"} — list a directory
- {"tool":"search","query":"text"} — search file contents across the project
- {"tool":"run_command","command":"npm test"} — run a shell command in the workspace (user approves first)
- {"tool":"delete_file","path":"relative/path"} — delete a file (user approves first)

Rules:
- Emit at most 3 actions per response, then wait for results.
- Read before you write. Never guess file contents.
- Plan multi-step work briefly in plain text before acting.
- When the task is complete, respond with plain text only (no action blocks) summarizing what changed and why.
- If a build or test fails, read the error, fix it, and re-run.
${beginnerMode ? `- BEGINNER MODE IS ON: the user is not a programmer. Explain every step in plain language: what file you are changing, what it does, and why the change is needed. Avoid jargon; define any technical term you must use. Recommend best practices gently.` : ''}

Project map:
${projectMap}`;
}
