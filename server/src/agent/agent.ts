import type { WebSocket } from 'ws';
import type { ChatMessage } from '../providers/types.js';
import { buildProvider } from '../providers/registry.js';
import { loadSettings } from '../config.js';
import { agentSystemPrompt, parseActions, type AgentAction } from './protocol.js';
import { executeTool, DESTRUCTIVE_TOOLS, isDependencyInstall, type ToolResult } from './tools.js';
import { getIndex } from '../routes/indexRoute.js';

/**
 * The agent loop runs over a WebSocket so every step streams to the UI and
 * destructive actions can pause for user approval mid-run.
 *
 * Client -> server: {type:'start', task, history?} | {type:'approve', id, approved} | {type:'cancel'}
 * Server -> client: {type:'text', delta} | {type:'action', ...} | {type:'approval-request', ...}
 *                   | {type:'tool-result', ...} | {type:'done'} | {type:'error', message}
 */
export function handleAgentSocket(ws: WebSocket, workspace: string): void {
  let cancelled = false;
  let abort: AbortController | null = null;
  const pendingApprovals = new Map<string, (approved: boolean) => void>();

  const send = (msg: object) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); };

  ws.on('message', async (raw) => {
    let msg: { type?: string; [k: string]: unknown };
    try { msg = JSON.parse(String(raw)); } catch { return; }

    if (msg.type === 'cancel') {
      cancelled = true;
      abort?.abort();
      for (const resolve of pendingApprovals.values()) resolve(false);
      pendingApprovals.clear();
      return;
    }
    if (msg.type === 'approve') {
      const resolve = pendingApprovals.get(String(msg.id));
      if (resolve) { pendingApprovals.delete(String(msg.id)); resolve(Boolean(msg.approved)); }
      return;
    }
    if (msg.type === 'start') {
      cancelled = false;
      try {
        await runAgent(String(msg.task), (msg.history as ChatMessage[] | undefined) ?? []);
      } catch (err) {
        send({ type: 'error', message: (err as Error).message });
      }
      send({ type: 'done' });
    }
  });

  ws.on('close', () => {
    cancelled = true;
    abort?.abort();
    for (const resolve of pendingApprovals.values()) resolve(false);
  });

  function requestApproval(action: AgentAction, preview?: { oldContent: string | null; newContent: string }): Promise<boolean> {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    send({ type: 'approval-request', id, action, preview });
    return new Promise((resolve) => pendingApprovals.set(id, resolve));
  }

  async function runAgent(task: string, priorHistory: ChatMessage[]): Promise<void> {
    const settings = loadSettings();
    const provider = buildProvider(settings);
    const index = getIndex(workspace);
    const messages: ChatMessage[] = [
      { role: 'system', content: agentSystemPrompt(index.map, settings.beginnerMode) },
      ...priorHistory,
      { role: 'user', content: task },
    ];

    for (let step = 0; step < settings.agentMaxSteps && !cancelled; step++) {
      abort = new AbortController();
      let response = '';
      for await (const delta of provider.streamChat(messages, { signal: abort.signal })) {
        if (cancelled) return;
        response += delta;
        send({ type: 'text', delta });
      }
      messages.push({ role: 'assistant', content: response });

      const { actions } = parseActions(response);
      if (actions.length === 0) return; // plain-text answer => task complete

      const results: string[] = [];
      for (const action of actions.slice(0, 3)) {
        if (cancelled) return;
        send({ type: 'action', action });

        let result: ToolResult;
        if (needsApproval(action, settings.approvals)) {
          const preview = action.tool === 'write_file'
            ? await previewWrite(action)
            : undefined;
          const approved = await requestApproval(action, preview);
          if (!approved) {
            result = { ok: false, output: 'User rejected this action. Ask what to do differently or stop.' };
          } else {
            result = await executeTool(workspace, action);
          }
        } else {
          result = await executeTool(workspace, action);
        }
        send({ type: 'tool-result', tool: action.tool, ok: result.ok, output: truncate(result.output, 4000) });
        results.push(`### Result of ${action.tool} ${JSON.stringify(stripContent(action))}\n${result.ok ? '' : '(FAILED) '}${truncate(result.output, 8000)}`);
      }

      messages.push({ role: 'user', content: `TOOL RESULTS:\n${results.join('\n\n')}` });
    }
    if (!cancelled) send({ type: 'error', message: `Reached the configured step limit (${loadSettings().agentMaxSteps}). Raise "agentMaxSteps" in Settings to allow longer runs.` });
  }

  async function previewWrite(action: AgentAction): Promise<{ oldContent: string | null; newContent: string }> {
    const { readFileSync, existsSync } = await import('node:fs');
    const { safeJoin } = await import('../util/paths.js');
    let oldContent: string | null = null;
    try {
      const abs = safeJoin(workspace, String(action.path));
      if (existsSync(abs)) oldContent = readFileSync(abs, 'utf8');
    } catch { /* new file or bad path — executeTool will report it */ }
    return { oldContent, newContent: String(action.content ?? '') };
  }
}

function needsApproval(action: AgentAction, approvals: { fileDelete: boolean; terminalExec: boolean; dependencyInstall: boolean }): boolean {
  if (!DESTRUCTIVE_TOOLS.has(action.tool)) return false;
  if (action.tool === 'delete_file') return approvals.fileDelete;
  if (action.tool === 'run_command') {
    return isDependencyInstall(String(action.command)) ? approvals.dependencyInstall : approvals.terminalExec;
  }
  return true; // write_file always shows a diff for approval
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '\n…(truncated)' : s;
}

function stripContent(action: AgentAction): AgentAction {
  const { content: _content, ...rest } = action;
  return rest as AgentAction;
}
