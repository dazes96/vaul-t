import { spawn, type ChildProcess } from 'node:child_process';
import { killTree } from '../util/proc.js';
import type { VerifyStep } from './detect.js';

export interface VerifyStepResult {
  id: string;
  label: string;
  ok: boolean;
  output: string;
  durationMs: number;
  timedOut: boolean;
}

const MAX_OUTPUT = 200_000;
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Run one verification step, streaming output as it arrives.
 *
 * Spawned detached (POSIX) in its own process group so killTree() can reach
 * everything the command started, not just the immediate child — a test
 * runner that forks workers would otherwise survive the timeout kill.
 * CI=1 is set so tools that auto-detect an interactive TTY (many test
 * runners default to watch mode without it) run once and exit; the timeout
 * is the hard backstop regardless.
 *
 * `signal` lets a caller (the agent's cancel handler) kill an in-progress
 * step immediately instead of waiting for the timeout — this is what makes
 * "Stop" in the UI actually stop a running verification, not just stop
 * queueing future work.
 */
export function runStep(root: string, step: VerifyStep, onOutput: (chunk: string) => void, timeoutMs = DEFAULT_TIMEOUT_MS, signal?: AbortSignal): Promise<VerifyStepResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    let output = '';
    let timedOut = false;
    let cancelled = false;
    let settled = false;

    let child: ChildProcess;
    try {
      child = spawn(step.command, step.args, {
        cwd: root,
        env: { ...process.env, CI: '1' },
        detached: process.platform !== 'win32',
      });
    } catch (err) {
      resolve({ id: step.id, label: step.label, ok: false, output: `Failed to start: ${(err as Error).message}`, durationMs: 0, timedOut: false });
      return;
    }

    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
    const onAbort = () => { cancelled = true; killTree(child); };
    signal?.addEventListener('abort', onAbort);

    const onData = (d: Buffer) => {
      output += d.toString();
      if (output.length > MAX_OUTPUT) output = output.slice(-MAX_OUTPUT);
      onOutput(d.toString());
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    const finish = (ok: boolean, extra?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({ id: step.id, label: step.label, ok, output: extra ? output + extra : output, durationMs: Date.now() - start, timedOut });
    };

    child.on('close', (code) => finish(
      code === 0 && !timedOut && !cancelled,
      cancelled ? '\n[cancelled by user]' : timedOut ? '\n[timed out and was killed]' : undefined,
    ));
    child.on('error', (err) => finish(false, `\nFailed to start: ${err.message}`));
  });
}

/**
 * Run steps in order, stopping at the first failure (later steps like
 * "build" usually assume earlier ones like "typecheck" already pass, and
 * running them anyway would just produce confusing double failures).
 */
export async function runVerification(
  root: string,
  steps: VerifyStep[],
  onStep: (r: VerifyStepResult) => void,
  onOutput: (id: string, chunk: string) => void,
  signal?: AbortSignal,
): Promise<VerifyStepResult[]> {
  const results: VerifyStepResult[] = [];
  for (const step of steps) {
    if (signal?.aborted) break;
    const r = await runStep(root, step, (chunk) => onOutput(step.id, chunk), undefined, signal);
    results.push(r);
    onStep(r);
    if (!r.ok) break;
  }
  return results;
}
