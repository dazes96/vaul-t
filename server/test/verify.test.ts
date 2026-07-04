import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { detectVerifySteps, packageManagerCommand } from '../src/verify/detect.js';
import { runStep, runVerification } from '../src/verify/runner.js';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-verify-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('detectVerifySteps', () => {
  it('finds typecheck/lint/test/build scripts and aliases', () => {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      scripts: { 'type-check': 'tsc --noEmit', lint: 'eslint .', test: 'vitest run', build: 'vite build' },
    }));
    const steps = detectVerifySteps(dir);
    expect(steps.map(s => s.id)).toEqual(['typecheck', 'lint', 'test', 'build']);
  });

  it('picks pnpm when a pnpm lockfile is present', () => {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }));
    fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');
    const pm = packageManagerCommand(dir);
    expect(pm.command).toMatch(/pnpm/);
  });

  it('falls back to npx tsc --noEmit when there is a tsconfig but no script', () => {
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{}');
    const steps = detectVerifySteps(dir);
    expect(steps).toHaveLength(1);
    expect(steps[0].id).toBe('typecheck');
    expect(steps[0].args).toContain('--noEmit');
  });

  it('returns no steps for a project with neither scripts nor tsconfig', () => {
    expect(detectVerifySteps(dir)).toHaveLength(0);
  });
});

describe('runStep', () => {
  it('reports success for an exit-0 command and streams output', async () => {
    let streamed = '';
    const r = await runStep(dir, { id: 'test', label: 'Test', command: process.execPath, args: ['-e', "console.log('hello'); process.exit(0);"] },
      (chunk) => { streamed += chunk; });
    expect(r.ok).toBe(true);
    expect(r.output).toContain('hello');
    expect(streamed).toContain('hello');
  });

  it('reports failure for a non-zero exit code', async () => {
    const r = await runStep(dir, { id: 'test', label: 'Test', command: process.execPath, args: ['-e', 'process.exit(1);'] }, () => {});
    expect(r.ok).toBe(false);
  });

  it('kills a hung process at the timeout and marks it timed out', async () => {
    const r = await runStep(
      dir,
      { id: 'test', label: 'Test', command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000);'] },
      () => {},
      300,
    );
    expect(r.timedOut).toBe(true);
    expect(r.ok).toBe(false);
  }, 10_000);

  it('handles a command that fails to start', async () => {
    const r = await runStep(dir, { id: 'test', label: 'Test', command: 'this-binary-does-not-exist-xyz', args: [] }, () => {});
    expect(r.ok).toBe(false);
  });
});

describe('runVerification', () => {
  it('stops at the first failing step and does not run later ones', async () => {
    const seen: string[] = [];
    const results = await runVerification(
      dir,
      [
        { id: 'typecheck', label: 'Typecheck', command: process.execPath, args: ['-e', 'process.exit(1);'] },
        { id: 'build', label: 'Build', command: process.execPath, args: ['-e', 'process.exit(0);'] },
      ],
      (r) => seen.push(r.id),
      () => {},
    );
    expect(results).toHaveLength(1);
    expect(seen).toEqual(['typecheck']);
  });

  it('runs every step when all pass', async () => {
    const results = await runVerification(
      dir,
      [
        { id: 'typecheck', label: 'Typecheck', command: process.execPath, args: ['-e', 'process.exit(0);'] },
        { id: 'test', label: 'Test', command: process.execPath, args: ['-e', 'process.exit(0);'] },
      ],
      () => {}, () => {},
    );
    expect(results.every(r => r.ok)).toBe(true);
    expect(results).toHaveLength(2);
  });
});
