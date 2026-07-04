import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { safeJoin, isIgnoredDir, dataDir } from '../util/paths.js';
import { writeFileAtomic } from '../util/atomic.js';
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

export function snapshotBeforeChange(workspace: string, relPath: string, kind: 'write' | 'delete'): HistoryEntry {
  const abs = safeJoin(workspace, relPath);
  let previousContent: string | null = null;
  try { previousContent = fs.readFileSync(abs, 'utf8'); } catch { /* new file */ }
  const entry: HistoryEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    time: Date.now(), workspace, path: relPath, kind, previousContent,
  };
  recordHistory(entry);
  return entry;
}

export function rollback(entryId: string): { ok: boolean; message: string } {
  const entry = readHistory().find(e => e.id === entryId);
  if (!entry) return { ok: false, message: 'History entry not found' };
  const abs = safeJoin(entry.workspace, entry.path);
  if (entry.previousContent === null) {
    try { fs.unlinkSync(abs); } catch { /* already gone */ }
    return { ok: true, message: `Removed ${entry.path} (it did not exist before the change)` };
  }
  writeFileAtomic(abs, entry.previousContent);
  return { ok: true, message: `Restored ${entry.path}` };
}

// --- Tool execution ---------------------------------------------------------

export async function executeTool(workspace: string, action: AgentAction): Promise<ToolResult> {
  try {
    switch (action.tool) {
      case 'read_file': {
        const abs = safeJoin(workspace, String(action.path));
        const content = fs.readFileSync(abs, 'utf8');
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
        snapshotBeforeChange(workspace, rel, 'write');
        writeFileAtomic(abs, String(action.content ?? ''));
        return { ok: true, output: `Wrote ${rel} (${String(action.content ?? '').length} bytes)`, oldContent: old };
      }
      case 'delete_file': {
        const rel = String(action.path);
        const abs = safeJoin(workspace, rel);
        snapshotBeforeChange(workspace, rel, 'delete');
        fs.unlinkSync(abs);
        return { ok: true, output: `Deleted ${rel}` };
      }
      case 'run_command': {
        return await runInWorkspace(workspace, String(action.command));
      }
      default:
        return { ok: false, output: `Unknown tool: ${action.tool}` };
    }
  } catch (err) {
    return { ok: false, output: `Error: ${(err as Error).message}` };
  }
}

function runInWorkspace(cwd: string, command: string): Promise<ToolResult> {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const child = isWin
      ? spawn('cmd.exe', ['/d', '/s', '/c', command], { cwd, timeout: 120_000 })
      : spawn('/bin/sh', ['-c', command], { cwd, timeout: 120_000 });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('close', code => {
      if (out.length > 20_000) out = out.slice(0, 20_000) + '\n…(truncated)';
      resolve({ ok: code === 0, output: `exit code ${code}\n${out}` });
    });
    child.on('error', err => resolve({ ok: false, output: `Failed to start: ${err.message}` }));
  });
}
