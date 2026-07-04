import fs from 'node:fs';
import path from 'node:path';

export interface RunnableCommand {
  command: string;
  args: string[];
}

interface PkgJson { scripts?: Record<string, string> }

function readPkg(root: string): PkgJson | null {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); } catch { return null; }
}

/**
 * Pick the package manager to invoke scripts with, from lockfile evidence —
 * never guessed from PATH availability, so the runner matches whatever the
 * project actually uses. `.cmd` shims are used on Windows because plain
 * `npm`/`pnpm`/`yarn` are batch/shell scripts there, not directly spawnable.
 */
export function packageManagerCommand(root: string): RunnableCommand & { runScript: (script: string) => RunnableCommand } {
  const isWin = process.platform === 'win32';
  const of = (bin: string) => (isWin ? `${bin}.cmd` : bin);

  let cmd: string;
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) cmd = of('pnpm');
  else if (fs.existsSync(path.join(root, 'yarn.lock'))) cmd = of('yarn');
  else if (fs.existsSync(path.join(root, 'bun.lockb'))) cmd = of('bun');
  else cmd = of('npm');

  return {
    command: cmd,
    args: [],
    runScript: (script: string) => ({ command: cmd, args: cmd.startsWith('yarn') ? [script] : ['run', script] }),
  };
}

/** All scripts declared in package.json, verbatim (name -> script body). */
export function listPackageScripts(root: string): Record<string, string> {
  return readPkg(root)?.scripts ?? {};
}

export interface VerifyStep {
  id: 'typecheck' | 'lint' | 'test' | 'build';
  label: string;
  command: string;
  args: string[];
}

const SCRIPT_ALIASES: Record<VerifyStep['id'], string[]> = {
  typecheck: ['typecheck', 'type-check', 'tsc'],
  lint: ['lint'],
  test: ['test'],
  build: ['build'],
};

const LABELS: Record<VerifyStep['id'], string> = {
  typecheck: 'Typecheck', lint: 'Lint', test: 'Test', build: 'Build',
};

/**
 * Detect which verification steps this project supports, from package.json
 * scripts and lockfile evidence — nothing is run yet, only discovered.
 * Falls back to a bare `tsc --noEmit` when there's a tsconfig but no script,
 * so TypeScript projects without a formal script still get a typecheck step.
 */
export function detectVerifySteps(root: string): VerifyStep[] {
  const scripts = listPackageScripts(root);
  const steps: VerifyStep[] = [];

  if (Object.keys(scripts).length) {
    const pm = packageManagerCommand(root);
    for (const id of ['typecheck', 'lint', 'test', 'build'] as const) {
      const found = SCRIPT_ALIASES[id].find(name => scripts[name]);
      if (found) {
        const r = pm.runScript(found);
        steps.push({ id, label: LABELS[id], command: r.command, args: r.args });
      }
    }
  }

  if (!steps.some(s => s.id === 'typecheck') && fs.existsSync(path.join(root, 'tsconfig.json'))) {
    const isWin = process.platform === 'win32';
    steps.unshift({ id: 'typecheck', label: LABELS.typecheck, command: isWin ? 'npx.cmd' : 'npx', args: ['tsc', '--noEmit'] });
  }

  return steps;
}
