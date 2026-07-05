import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { startTask, stopTask, restartTask, removeTask, listTasks, getTaskLog, killAllTasks, detectTasks } from '../src/tasks.js';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-tasks-')); });
afterEach(() => { killAllTasks(); fs.rmSync(dir, { recursive: true, force: true }); });

function waitFor(fn: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (fn()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timed out'));
      setTimeout(tick, 20);
    };
    tick();
  });
}

describe('task runner', () => {
  it('starts a task, captures its log, and lists it as running', async () => {
    const info = startTask(dir, 'greet', process.execPath, ['-e', "console.log('hi from task')"]);
    expect(info.status).toBe('running');
    await waitFor(() => getTaskLog(info.id).includes('hi from task'));
    // it should have exited on its own (short-lived script)
    await waitFor(() => listTasks(dir).find(t => t.id === info.id)?.status === 'exited');
  });

  it('stops a long-running task and prevents it from being an orphan', async () => {
    const info = startTask(dir, 'server', process.execPath, ['-e', 'setInterval(() => {}, 1000);']);
    expect(listTasks(dir).find(t => t.id === info.id)?.status).toBe('running');
    const stopped = stopTask(info.id);
    expect(stopped).toBe(true);
    await waitFor(() => listTasks(dir).find(t => t.id === info.id)?.status !== 'running');
  });

  it('restarts a task under a new process', async () => {
    const info = startTask(dir, 'server', process.execPath, ['-e', 'setInterval(() => {}, 1000);']);
    const restarted = restartTask(info.id);
    expect(restarted).not.toBeNull();
    expect(restarted!.id).not.toBe(info.id);
    expect(restarted!.status).toBe('running');
    stopTask(restarted!.id);
  });

  it('reports false when stopping an unknown task id', () => {
    expect(stopTask('does-not-exist')).toBe(false);
  });

  it('detects package.json scripts as runnable tasks', () => {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { dev: 'vite', build: 'vite build' } }));
    const detected = detectTasks(dir);
    expect(detected.map(d => d.name).sort()).toEqual(['build', 'dev']);
  });

  it('dismisses a finished task but refuses to dismiss a running one', async () => {
    const running = startTask(dir, 'server', process.execPath, ['-e', 'setInterval(() => {}, 1000);']);
    expect(removeTask(running.id)).toBe(false);   // running: refused
    expect(listTasks(dir).some(t => t.id === running.id)).toBe(true);

    const shortLived = startTask(dir, 'quick', process.execPath, ['-e', 'process.exit(0)']);
    await waitFor(() => listTasks(dir).find(t => t.id === shortLived.id)?.status === 'exited');
    expect(removeTask(shortLived.id)).toBe(true);  // finished: removed
    expect(listTasks(dir).some(t => t.id === shortLived.id)).toBe(false);

    stopTask(running.id);
  });
});
