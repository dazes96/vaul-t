import { spawn, type ChildProcess } from 'node:child_process';
import { killTree } from './util/proc.js';
import { packageManagerCommand, listPackageScripts } from './verify/detect.js';

export interface TaskInfo {
  id: string;
  name: string;
  command: string;
  args: string[];
  cwd: string;
  status: 'running' | 'stopped' | 'exited';
  pid?: number;
  exitCode: number | null;
  startedAt: number;
  endedAt?: number;
}

interface ManagedTask extends TaskInfo {
  child?: ChildProcess;
  log: string[];
  listeners: Set<(chunk: string) => void>;
}

const MAX_LOG_CHUNKS = 4000;

/**
 * Long-running task manager (dev servers, watch builds, test runners) —
 * distinct from the interactive terminal and from one-off agent commands.
 * Tasks are tracked with their own process group so stop() can kill every
 * child a script spawned (a `next dev` that forks workers, for instance),
 * not just the immediate shell — this is what prevents orphaned processes.
 */
const tasks = new Map<string, ManagedTask>();

function appendLog(t: ManagedTask, chunk: string): void {
  t.log.push(chunk);
  if (t.log.length > MAX_LOG_CHUNKS) t.log.splice(0, t.log.length - MAX_LOG_CHUNKS);
  for (const fn of t.listeners) fn(chunk);
}

function toInfo(t: ManagedTask): TaskInfo {
  const { child: _child, log: _log, listeners: _listeners, ...info } = t;
  return info;
}

/** Scripts detected in package.json — candidates the UI offers as one-click "Run" buttons. */
export function detectTasks(workspace: string): { name: string; command: string; args: string[] }[] {
  const scripts = listPackageScripts(workspace);
  const pm = packageManagerCommand(workspace);
  return Object.keys(scripts).map(name => ({ name, ...pm.runScript(name) }));
}

export function listTasks(workspace: string): TaskInfo[] {
  return [...tasks.values()].filter(t => t.cwd === workspace).map(toInfo);
}

const MAX_FINISHED = 30;   // cap retained exited/stopped tasks so the map can't grow unbounded

/** Drop the oldest finished tasks once we exceed the cap (running tasks are never pruned). */
function pruneFinished(): void {
  const finished = [...tasks.values()].filter(t => t.status !== 'running').sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0));
  for (let i = 0; i < finished.length - MAX_FINISHED; i++) tasks.delete(finished[i].id);
}

/** Remove a finished task from the list. Running tasks must be stopped first. */
export function removeTask(id: string): boolean {
  const t = tasks.get(id);
  if (!t || t.status === 'running') return false;
  tasks.delete(id);
  return true;
}

export function startTask(workspace: string, name: string, command: string, args: string[]): TaskInfo {
  pruneFinished();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const child = spawn(command, args, {
    cwd: workspace,
    detached: process.platform !== 'win32',
    env: process.env,
  });
  const t: ManagedTask = {
    id, name, command, args, cwd: workspace, status: 'running',
    pid: child.pid, exitCode: null, startedAt: Date.now(), child, log: [], listeners: new Set(),
  };
  const onData = (d: Buffer) => appendLog(t, d.toString());
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  child.on('exit', (code) => { t.status = 'exited'; t.exitCode = code; t.endedAt = Date.now(); t.child = undefined; });
  child.on('error', (err) => { appendLog(t, `\n[failed to start: ${err.message}]\n`); t.status = 'exited'; t.exitCode = -1; t.endedAt = Date.now(); });
  tasks.set(id, t);
  return toInfo(t);
}

export function stopTask(id: string): boolean {
  const t = tasks.get(id);
  if (!t?.child) return false;
  killTree(t.child);
  t.status = 'stopped';
  t.endedAt = Date.now();
  return true;
}

export function restartTask(id: string): TaskInfo | null {
  const t = tasks.get(id);
  if (!t) return null;
  if (t.child) killTree(t.child);
  tasks.delete(id);
  return startTask(t.cwd, t.name, t.command, t.args);
}

export function getTaskLog(id: string): string {
  return tasks.get(id)?.log.join('') ?? '';
}

export function subscribeTask(id: string, fn: (chunk: string) => void): () => void {
  const t = tasks.get(id);
  if (!t) return () => {};
  t.listeners.add(fn);
  return () => t.listeners.delete(fn);
}

/** Kill every managed task's process tree — called on graceful shutdown so nothing outlives the server. */
export function killAllTasks(): void {
  for (const t of tasks.values()) if (t.child) killTree(t.child);
}
