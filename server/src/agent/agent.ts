import type { WebSocket } from 'ws';
import type { ChatMessage } from '../providers/types.js';
import { buildProvider } from '../providers/registry.js';
import { loadSettings } from '../config.js';
import { agentSystemPrompt, parseActions, type AgentAction } from './protocol.js';
import { executeTool, DESTRUCTIVE_TOOLS, isDependencyInstall, getCheckpoint, type ToolResult } from './tools.js';
import { getIndex } from '../routes/indexRoute.js';
import { detectVerifySteps } from '../verify/detect.js';
import { runVerification, type VerifyStepResult } from '../verify/runner.js';
import { buildRunSummary } from './summary.js';

interface Approval {
  approved: boolean;
  /** Present when the user edited the proposed content in the diff before applying it. */
  editedContent?: string;
}

/**
 * The agent loop runs over a WebSocket so every step streams to the UI and
 * destructive actions can pause for user approval mid-run.
 *
 * Client -> server: {type:'start', task, history?} | {type:'approve', id, approved, editedContent?}
 *                    | {type:'cancel'}
 * Server -> client: {type:'plan', text} | {type:'text', delta} | {type:'action', ...}
 *                    | {type:'approval-request', ...} | {type:'tool-result', ...}
 *                    | {type:'verify-start', steps} | {type:'verify-step', result} | {type:'verify-output', id, chunk}
 *                    | {type:'verify-done', ok, results} | {type:'summary', runId, text}
 *                    | {type:'done'} | {type:'error', message}
 */
export function handleAgentSocket(ws: WebSocket, workspace: string): void {
  let cancelled = false;
  let turnAbort: AbortController | null = null;   // aborts whatever long operation is in flight right now
  const pendingApprovals = new Map<string, (result: Approval) => void>();

  const send = (msg: object) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); };

  ws.on('message', async (raw) => {
    let msg: { type?: string; [k: string]: unknown };
    try { msg = JSON.parse(String(raw)); } catch { return; }

    if (msg.type === 'cancel') {
      cancelled = true;
      turnAbort?.abort();
      for (const resolve of pendingApprovals.values()) resolve({ approved: false });
      pendingApprovals.clear();
      return;
    }
    if (msg.type === 'approve') {
      const resolve = pendingApprovals.get(String(msg.id));
      if (resolve) {
        pendingApprovals.delete(String(msg.id));
        resolve({
          approved: Boolean(msg.approved),
          editedContent: typeof msg.editedContent === 'string' ? msg.editedContent : undefined,
        });
      }
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
    turnAbort?.abort();
    for (const resolve of pendingApprovals.values()) resolve({ approved: false });
  });

  function requestApproval(action: AgentAction, preview?: { oldContent: string | null; newContent: string }): Promise<Approval> {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    send({ type: 'approval-request', id, action, preview });
    return new Promise((resolve) => pendingApprovals.set(id, resolve));
  }

  async function runAgent(task: string, priorHistory: ChatMessage[]): Promise<void> {
    const settings = loadSettings();
    const provider = buildProvider(settings);
    const index = await getIndex(workspace);
    const messages: ChatMessage[] = [
      { role: 'system', content: agentSystemPrompt(index.map, settings.beginnerMode) },
      ...priorHistory,
      { role: 'user', content: task },
    ];
    // One runId for the whole task, including any auto-heal rounds, so every
    // file this run touches can be rolled back together as one checkpoint
    // (see agent/tools.ts listCheckpoints/rollbackCheckpoint).
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    let totalStepsUsed = 0;
    let filesChanged = false;

    /**
     * Runs the think/act loop until the model answers in plain text (done) or
     * the step budget runs out. Each call — the initial task AND every
     * auto-heal round — gets its OWN fresh budget of agentMaxSteps; only
     * totalStepsUsed accumulates across calls (for reporting). Sharing one
     * counter across heal rounds would mean a task that used its whole budget
     * just to finish the primary work leaves zero steps for healing, so the
     * self-heal loop would silently never actually try to fix anything.
     */
    async function stepUntilComplete(): Promise<'completed' | 'exhausted' | 'cancelled'> {
      let localSteps = 0;
      while (localSteps < settings.agentMaxSteps) {
        if (cancelled) return 'cancelled';
        localSteps++;
        totalStepsUsed++;
        turnAbort = new AbortController();
        let response = '';
        for await (const delta of provider.streamChat(messages, { signal: turnAbort.signal })) {
          if (cancelled) return 'cancelled';
          response += delta;
          send({ type: 'text', delta });
        }
        messages.push({ role: 'assistant', content: response });

        const { actions, plan } = parseActions(response);
        if (plan) send({ type: 'plan', text: plan });
        if (actions.length === 0) return 'completed';

        const results: string[] = [];
        for (const action of actions.slice(0, 3)) {
          if (cancelled) return 'cancelled';
          send({ type: 'action', action });

          let result: ToolResult;
          if (needsApproval(action, settings.approvals)) {
            const preview = action.tool === 'write_file' ? await previewWrite(action) : undefined;
            const { approved, editedContent } = await requestApproval(action, preview);
            if (cancelled) return 'cancelled';
            turnAbort = new AbortController();
            result = approved
              ? await executeTool(workspace, action, runId, editedContent, turnAbort.signal)
              : { ok: false, output: 'User rejected this action. Ask what to do differently or stop.' };
          } else {
            turnAbort = new AbortController();
            result = await executeTool(workspace, action, runId, undefined, turnAbort.signal);
          }
          if (result.ok && (action.tool === 'write_file' || action.tool === 'delete_file')) filesChanged = true;
          send({ type: 'tool-result', tool: action.tool, ok: result.ok, output: truncate(result.output, 4000) });
          results.push(`### Result of ${action.tool} ${JSON.stringify(stripContent(action))}\n${result.ok ? '' : '(FAILED) '}${truncate(result.output, 8000)}`);
        }
        messages.push({ role: 'user', content: `TOOL RESULTS:\n${results.join('\n\n')}` });
      }
      return 'exhausted';
    }

    const first = await stepUntilComplete();
    if (first === 'cancelled') {
      sendSummary(null, true);
      return;
    }

    // Self-healing loop: if the agent changed files, verify the project still
    // builds/typechecks/lints/tests, and if not, hand the failure back to the
    // model for a bounded number of fix-and-recheck rounds. This never runs
    // unattended forever — autoHealAttempts is a hard cap, not a suggestion.
    let verifyOutcome: { ranSteps: boolean; ok: boolean; failedLabel?: string } | null = null;
    if (filesChanged && settings.autoVerify) {
      const steps = detectVerifySteps(workspace);
      if (steps.length > 0) {
        for (let heal = 0; heal <= settings.autoHealAttempts; heal++) {
          if (cancelled) { sendSummary(verifyOutcome, true); return; }
          send({ type: 'verify-start', steps });
          turnAbort = new AbortController();
          const results = await runVerification(
            workspace, steps,
            (r) => send({ type: 'verify-step', result: r }),
            (id, chunk) => send({ type: 'verify-output', id, chunk: truncate(chunk, 2000) }),
            turnAbort.signal,
          );
          if (cancelled) { sendSummary(verifyOutcome, true); return; }
          const failed = results.find(r => !r.ok);
          verifyOutcome = { ranSteps: true, ok: !failed, failedLabel: failed?.label };
          send({ type: 'verify-done', ok: !failed, results });
          if (!failed) break;
          if (heal >= settings.autoHealAttempts) {
            send({ type: 'error', message: `Verification still failing after ${settings.autoHealAttempts} auto-fix attempt(s) (${failed.label}). Review the output and fix manually, or ask the agent to try a different approach.` });
            break;
          }
          messages.push({ role: 'user', content: healPrompt(failed) });
          const outcome = await stepUntilComplete();
          if (outcome === 'cancelled') { sendSummary(verifyOutcome, true); return; }
        }
      } else {
        verifyOutcome = { ranSteps: false, ok: true };
      }
    }

    sendSummary(verifyOutcome, false);

    function sendSummary(verify: { ranSteps: boolean; ok: boolean; failedLabel?: string } | null, wasCancelled: boolean): void {
      const files = filesChanged ? (getCheckpoint(runId)?.files ?? []) : [];
      const text = buildRunSummary({ task, filesChanged: files, verify, cancelled: wasCancelled, stepsUsed: totalStepsUsed, runId });
      send({ type: 'summary', runId, text });
    }
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

function healPrompt(failed: VerifyStepResult): string {
  return `VERIFICATION FAILED (${failed.label}):\n${truncate(failed.output, 6000)}\n\nFix the underlying issue in the code, then respond with plain text (no further action needed) once you believe it's fixed. Do not just suppress or ignore the error.`;
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
