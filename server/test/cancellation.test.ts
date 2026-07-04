import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runStep, runVerification } from '../src/verify/runner.js';
import { executeTool } from '../src/agent/tools.js';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-cancel-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('verification cancellation', () => {
  it('kills a running step immediately when the signal aborts, without waiting for the timeout', async () => {
    const controller = new AbortController();
    const start = Date.now();
    const promise = runStep(
      dir,
      { id: 'test', label: 'Test', command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000);'] },
      () => {},
      120_000, // long timeout — abort must win long before this
      controller.signal,
    );
    setTimeout(() => controller.abort(), 150);
    const r = await promise;
    const elapsed = Date.now() - start;
    expect(r.ok).toBe(false);
    expect(elapsed).toBeLessThan(5000); // proves the abort killed it, not the 120s timeout
    expect(r.output).toContain('cancelled by user');
  }, 10_000);

  it('runVerification stops issuing new steps once the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const results = await runVerification(
      dir,
      [{ id: 'a', label: 'A', command: process.execPath, args: ['-e', 'process.exit(0);'] }],
      () => {}, () => {},
      controller.signal,
    );
    expect(results).toHaveLength(0);
  });
});

describe('run_command cancellation via executeTool', () => {
  it('kills a long-running command immediately when the signal aborts', async () => {
    const controller = new AbortController();
    const start = Date.now();
    const promise = executeTool(dir, { tool: 'run_command', command: `${JSON.stringify(process.execPath)} -e "setInterval(function(){},1000)"` }, undefined, undefined, controller.signal);
    setTimeout(() => controller.abort(), 150);
    const result = await promise;
    const elapsed = Date.now() - start;
    expect(result.ok).toBe(false);
    expect(elapsed).toBeLessThan(5000);
    expect(result.output).toContain('cancelled by user');
  }, 10_000);
});
