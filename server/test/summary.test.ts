import { describe, it, expect } from 'vitest';
import { buildRunSummary } from '../src/agent/summary.js';

describe('buildRunSummary', () => {
  it('reports no changes when nothing was touched', () => {
    const text = buildRunSummary({ task: 'look around', filesChanged: [], verify: null, cancelled: false, stepsUsed: 1, runId: 'r1' });
    expect(text).toContain('No files were changed.');
    expect(text).not.toContain('checkpoint');
  });

  it('lists changed files and offers undo via the checkpoint', () => {
    const text = buildRunSummary({ task: 'add health route', filesChanged: ['a.ts', 'b.ts'], verify: null, cancelled: false, stepsUsed: 3, runId: 'run-42' });
    expect(text).toContain('Changed 2 files');
    expect(text).toContain('a.ts');
    expect(text).toContain('b.ts');
    expect(text).toContain('run-42');
  });

  it('reports a passing verification', () => {
    const text = buildRunSummary({ task: 't', filesChanged: ['a.ts'], verify: { ranSteps: true, ok: true }, cancelled: false, stepsUsed: 2, runId: 'r' });
    expect(text).toContain('✓ Verified');
  });

  it('reports a failing verification with the failed step label', () => {
    const text = buildRunSummary({ task: 't', filesChanged: ['a.ts'], verify: { ranSteps: true, ok: false, failedLabel: 'Test' }, cancelled: false, stepsUsed: 2, runId: 'r' });
    expect(text).toContain('✗');
    expect(text).toContain('Test');
  });

  it('notes when verification was skipped due to no detected scripts', () => {
    const text = buildRunSummary({ task: 't', filesChanged: ['a.ts'], verify: { ranSteps: false, ok: true }, cancelled: false, stepsUsed: 1, runId: 'r' });
    expect(text).toContain('skipped');
  });

  it('flags a cancelled run', () => {
    const text = buildRunSummary({ task: 't', filesChanged: [], verify: null, cancelled: true, stepsUsed: 1, runId: 'r' });
    expect(text).toContain('Stopped by user');
  });

  it('says nothing about verification when it never ran', () => {
    const text = buildRunSummary({ task: 't', filesChanged: [], verify: null, cancelled: false, stepsUsed: 1, runId: 'r' });
    expect(text).not.toMatch(/verif/i);
  });
});
