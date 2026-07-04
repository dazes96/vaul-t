import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { safeJoin, isIgnoredDir, dataDir } from '../util/paths.js';
import { writeFileAtomic } from '../util/atomic.js';
import { killTree } from '../util/proc.js';
import { getProjectIndex } from '../intelligence/manager.js';
import { searchAsync } from '../intelligence/search.js';
import type { AgentAction } from './protocol.js';

export interface ToolResult {
  ok: boolean;
  output: string;
  /** For write_file: the previous content, so the UI can render a diff. */
  oldContent?: string;
}

/** Tools that must be approved by the user before running. */
export const DESTRUCTIVE_TOOLS = new Set(['write_file', 'run_command', 'delete_file']);

/** Commands that install dependencies — get their own approval category. */
export function isDependencyInstall(command: string): boolean {
  return /\b(npm|pnpm|yarn|bun)\s+(install|add|i)\b|\bpip3?\s+install\b|\bcomposer\s+(install|require)\b/.test(command);
}

// --- Undo history -----------------------------------------------------------
// Before any agent write or delete we snapshot the previous content, so every
// change can be rolled back from the History panel.

export interface HistoryEntry {
  id: string;
  time: number;
  workspace: string;
  path: string;
  kind: 'write' | 'delete';
  previousContent: string | null;  // null = file did not exist before
  /** Groups every change from one agent run (incl. auto-heal rounds) so it can be undone as one checkpoint. */
  runId?: string;
}

function historyFile(): string {
  return path.join(dataDir(), 'history.json');
}

export function readHistory(): HistoryEntry[] {
  try { return JSON.parse(fs.readFileSync(historyFile(), 'utf8')); } catch { return []; }
}

function recordHistory(entry: HistoryEntry): void {
  const all = readHistory();
  all.push(entry);
  fs.mkdirSync(dataDir(), { recursive: true });
  // snapshotBeforeChange runs fully synchronously, so concurrent agent tool
  // calls cannot interleave this read-modify-write; atomic write protects the
  // log from corruption if the process dies mid-write.
  writeFileAtomic(historyFile(), JSON.stringify(all.slice(-500), null, 2));
}

export function snapshotBeforeChange(workspace: string, relPath: string, kind: 'write' | 'delete', runId?: string): HistoryEntry {
  const abs = safeJoin(workspace, relPath);
  let previousContent: string | null = null;
  try { previousContent = fs.readFileSync(abs, 'utf8'); } catch { /* new file */ }
  const entry: HistoryEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    time: Date.now(), workspace, path: relPath, kind, previousContent, runId,
  };
  recordHistory(entry);
  return entry;
}

function restoreEntry(entry: HistoryEntry): string {
  const abs = safeJoin(entry.workspace, entry.path);
  if (entry.previousContent === null) {
    try { fs.unlinkSync(abs); } catch { /* already gone */ }
    return `Removed ${entry.path} (it did not exist before the change)`;
  }
  writeFileAtomic(abs, entry.previousContent);
  return `Restored ${entry.path}`;
}

export function rollback(entryId: string): { ok: boolean; message: string } {
  const entry = readHistory().find(e => e.id === entryId);
  if (!entry) return { ok: false, message: 'History entry not found' };
  return { ok: true, message: restoreEntry(entry) };
}

// --- Checkpoints -------------------------------------------------------------
// A checkpoint is every history entry sharing one agent-run id. Restoring one
// undoes the whole run in a single click: for each file touched, we restore
// to its content from BEFORE the run's first change to that file (not just
// the most recent one), so a file written twice in one run still reverts
// cleanly to its pre-run state.

export interface Checkpoint {
  runId: string;
  workspace: string;
  time: number;         // time of the run's first change
  lastTime: number;      // time of the run's last change
  files: string[];
}

export function listCheckpoints(workspace?: string): Checkpoint[] {
  const byRun = new Map<string, HistoryEntry[]>();
  for (const e of readHistory()) {
    if (!e.runId) continue;
    if (workspace && e.workspace !== workspace) continue;
    (byRun.get(e.runId) ?? byRun.set(e.runId, []).get(e.runId)!).push(e);
  }
  const out: Checkpoint[] = [];
  for (const [runId, entries] of byRun) {
    entries.sort((a, b) => a.time - b.time);
    out.push({
      runId,
      workspace: entries[0].workspace,
      time: entries[0].time,
      lastTime: entries[entries.length - 1].time,
      files: [...new Set(entries.map(e => e.path))],
    });
  }
  return out.sort((a, b) => b.lastTime - a.lastTime);
}

export function getCheckpoint(runId: string): Checkpoint | undefined {
  return listCheckpoints().find(c => c.runId === runId);
}

export function rollbackCheckpoint(runId: string): { ok: boolean; message: string; restored: string[] } {
  const entries = readHistory().filter(e => e.runId === runId);
  if (entries.length === 0) return { ok: false, message: 'Checkpoint not found', restored: [] };
  // Keep only the EARLIEST entry per file — that holds the true pre-run state.
  const earliestByPath = new Map<string, HistoryEntry>();
  for (const e of entries.sort((a, b) => a.time - b.time)) {
    if (!earliestByPath.has(e.path)) earliestByPath.set(e.path, e);
  }
  const restored: string[] = [];
  for (const entry of earliestByPath.values()) {
    restoreEntry(entry);
    restored.push(entry.path);
  }
  return { ok: true, message: `Restored ${restored.length} file(s) to their state before this run`, restored };
}

// --- Tool execution ---------------------------------------------------------

/**
 * `editedContent` overrides `action.content` for write_file — the approval
 * dialog lets the user edit the proposed diff before applying it, and their
 * version always wins over what the model proposed (Priority: modify).
 * `signal` lets an in-flight run_command be killed the instant the user hits
 * Stop, instead of running until it happens to exit on its own.
 */
export async function executeTool(workspace: string, action: AgentAction, runId?: string, editedContent?: string, signal?: AbortSignal): Promise<ToolResult> {
  try {
    switch (action.tool) {
      case 'read_file': {
        const abs = safeJoin(workspace, String(action.path));
        const content = fs.readFileSync(abs, 'utf8');
        touchFile(workspace, String(action.path));
        return { ok: true, output: content.length > 100_000 ? content.slice(0, 100_000) + '\n…(truncated)' : content };
      }
      case 'list_dir': {
        const abs = safeJoin(workspace, String(action.path ?? '.'));
        const entries = fs.readdirSync(abs, { withFileTypes: true })
          .filter(e => !isIgnoredDir(e.name))
          .map(e => (e.isDirectory() ? e.name + '/' : e.name));
        return { ok: true, output: entries.join('\n') || '(empty)' };
      }
      case 'search': {
        const index = await getProjectIndex(workspace);
        const hits = await searchAsync(index, String(action.query));
        const out = hits.length ? hits.map(h => `${h.path}:${h.line}: ${h.text}`).join('\n') : '(no matches)';
        return { ok: true, output: out };
      }
      case 'write_file': {
        const rel = String(action.path);
        const abs = safeJoin(workspace, rel);
        const old = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : undefined;
        const finalContent = editedContent ?? String(action.content ?? '');
        const wasEdited = editedContent !== undefined && editedContent !== String(action.content ?? '');
        snapshotBeforeChange(workspace, rel, 'write', runId);
        writeFileAtomic(abs, finalContent);
        touchFile(workspace, rel);
        return {
          ok: true,
          output: `Wrote ${rel} (${finalContent.length} bytes)${wasEdited ? ' — NOTE: the user edited this content before applying it; the file now contains their version, not yours' : ''}`,
          oldContent: old,
        };
      }
      case 'delete_file': {
        const rel = String(action.path);
        const abs = safeJoin(workspace, rel);
        snapshotBeforeChange(workspace, rel, 'delete', runId);
        fs.unlinkSync(abs);
        return { ok: true, output: `Deleted ${rel}` };
      }
      case 'run_command': {
        return await runInWorkspace(workspace, String(action.command), signal);
      }
      default:
        return { ok: false, output: `Unknown tool: ${action.tool}` };
    }
  } catch (err) {
    return { ok: false, output: `Error: ${(err as Error).message}` };
  }
}

/** Best-effort recency signal for retrieval (Priority 9) — never fails the tool call. */
function touchFile(workspace: string, relPath: string): void {
  void getProjectIndex(workspace).then(idx => idx.touch(relPath)).catch(() => { /* index not ready yet */ });
}

function runInWorkspace(cwd: string, command: string, signal?: AbortSignal): Promise<ToolResult> {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const child = isWin
      ? spawn('cmd.exe', ['/d', '/s', '/c', command], { cwd, timeout: 120_000, detached: false })
      : spawn('/bin/sh', ['-c', command], { cwd, timeout: 120_000, detached: true });
    let out = '';
    let cancelled = false;
    const onAbort = () => { cancelled = true; killTree(child); };
    signal?.addEventListener('abort', onAbort);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('close', code => {
      signal?.removeEventListener('abort', onAbort);
      if (out.length > 20_000) out = out.slice(0, 20_000) + '\n…(truncated)';
      resolve({ ok: !cancelled && code === 0, output: cancelled ? `[cancelled by user]\n${out}` : `exit code ${code}\n${out}` });
    });
    child.on('error', err => {
      signal?.removeEventListener('abort', onAbort);
      resolve({ ok: false, output: `Failed to start: ${err.message}` });
    });
  });
}
