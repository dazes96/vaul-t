import { spawn, type ChildProcess } from 'node:child_process';

/**
 * Kill a process and everything it spawned. Used everywhere a child process
 * needs to be stoppable on demand (verification steps, managed tasks, agent
 * `run_command`) — a plain `child.kill()` only kills the immediate process,
 * leaving anything it forked (a test runner's workers, `npm run dev`'s
 * actual dev server) running as an orphan.
 */
export function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
  }
}
