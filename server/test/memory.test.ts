import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  loadMemory, saveMemory, patchMemory, resetMemory, recordAgentRun, memoryContext,
} from '../src/memory/memory.js';

let dataDir: string;
const ws = '/tmp/project-alpha';

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-mem-'));
  process.env.EMERALD_DATA_DIR = dataDir;
});
afterEach(() => { fs.rmSync(dataDir, { recursive: true, force: true }); });

describe('project memory store', () => {
  it('returns empty memory for a fresh project and persists edits', () => {
    const fresh = loadMemory(ws);
    expect(fresh.architecture).toBe('');
    expect(fresh.priorFixes).toEqual([]);

    patchMemory(ws, { architecture: 'React + Express monorepo', conventions: ['named exports'] });
    const reloaded = loadMemory(ws);
    expect(reloaded.architecture).toBe('React + Express monorepo');
    expect(reloaded.conventions).toEqual(['named exports']);
  });

  it('keeps memory project-specific (different workspaces, different files)', () => {
    patchMemory('/tmp/project-alpha', { architecture: 'alpha' });
    patchMemory('/tmp/project-beta', { architecture: 'beta' });
    expect(loadMemory('/tmp/project-alpha').architecture).toBe('alpha');
    expect(loadMemory('/tmp/project-beta').architecture).toBe('beta');
  });

  it('is safe to reset', () => {
    patchMemory(ws, { architecture: 'to be wiped' });
    resetMemory(ws);
    expect(loadMemory(ws).architecture).toBe('');
  });

  it('does not let a client patch repoint the workspace', () => {
    const patched = patchMemory(ws, { architecture: 'x', workspace: '/etc/evil' } as never);
    expect(patched.workspace).toBe(ws);
  });
});

describe('recordAgentRun', () => {
  it('records a prior fix for a run that changed files', () => {
    recordAgentRun(ws, { task: 'add health route', files: ['server/app.ts'], verifyOk: true });
    const mem = loadMemory(ws);
    expect(mem.priorFixes).toHaveLength(1);
    expect(mem.priorFixes[0].summary).toContain('add health route');
    expect(mem.priorFixes[0].files).toEqual(['server/app.ts']);
  });

  it('records a resolved known-bug when a failure was healed', () => {
    recordAgentRun(ws, { task: 'fix parser', files: ['parser.ts'], verifyOk: true, healedLabel: 'Test' });
    const mem = loadMemory(ws);
    expect(mem.knownBugs.some(b => b.resolved && b.note.includes('Test'))).toBe(true);
  });

  it('records nothing when no files changed', () => {
    recordAgentRun(ws, { task: 'just looked around', files: [], verifyOk: null });
    expect(loadMemory(ws).priorFixes).toHaveLength(0);
  });
});

describe('memoryContext relevance filtering', () => {
  it('always includes architecture, conventions, and preferences when set', () => {
    saveMemory({ ...loadMemory(ws), architecture: 'monorepo', conventions: ['tabs'], preferences: ['no default exports'] });
    const ctx = memoryContext(loadMemory(ws), 'anything unrelated');
    expect(ctx).toContain('monorepo');
    expect(ctx).toContain('tabs');
    expect(ctx).toContain('no default exports');
  });

  it('filters prior fixes by query relevance — irrelevant ones are omitted', () => {
    const mem = loadMemory(ws);
    mem.priorFixes = [
      { id: '1', time: 1, summary: 'fixed the invoice calculation', files: ['invoice.ts'] },
      { id: '2', time: 2, summary: 'updated the login form', files: ['login.tsx'] },
    ];
    saveMemory(mem);
    const ctx = memoryContext(loadMemory(ws), 'the invoice total is wrong');
    expect(ctx).toContain('invoice calculation');
    expect(ctx).not.toContain('login form');
  });

  it('includes prior fixes that touch the same files even if wording differs', () => {
    const mem = loadMemory(ws);
    mem.priorFixes = [{ id: '1', time: 1, summary: 'refactored zzz', files: ['auth/session.ts'] }];
    saveMemory(mem);
    const ctx = memoryContext(loadMemory(ws), 'unrelated words', ['auth/session.ts']);
    expect(ctx).toContain('refactored zzz');
  });

  it('returns an empty string when nothing is set and nothing matches', () => {
    expect(memoryContext(loadMemory(ws), 'anything')).toBe('');
  });

  it('never includes an unresolved bug that is irrelevant to the query', () => {
    const mem = loadMemory(ws);
    mem.knownBugs = [{ id: '1', note: 'timezone bug in the scheduler', resolved: false, time: 1 }];
    saveMemory(mem);
    expect(memoryContext(loadMemory(ws), 'change the button color')).not.toContain('timezone');
    expect(memoryContext(loadMemory(ws), 'the scheduler timezone is off')).toContain('timezone');
  });
});
