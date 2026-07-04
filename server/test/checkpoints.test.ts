import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let ws: string;
let dataDir: string;

beforeAll(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-ckpt-ws-'));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-ckpt-data-'));
  process.env.EMERALD_DATA_DIR = dataDir;
});
afterAll(() => {
  fs.rmSync(ws, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});
beforeEach(() => {
  // fresh history per test
  try { fs.unlinkSync(path.join(dataDir, 'history.json')); } catch { /* not created yet */ }
});

describe('checkpoints (run-scoped undo)', () => {
  it('groups changes from one run and restores them together', async () => {
    const { snapshotBeforeChange, listCheckpoints, rollbackCheckpoint } = await import('../src/agent/tools.js');
    const { writeFileAtomic } = await import('../src/util/atomic.js');
    const runId = 'run-test-1';

    fs.writeFileSync(path.join(ws, 'a.txt'), 'original a');
    fs.writeFileSync(path.join(ws, 'b.txt'), 'original b');

    snapshotBeforeChange(ws, 'a.txt', 'write', runId);
    writeFileAtomic(path.join(ws, 'a.txt'), 'changed a');
    snapshotBeforeChange(ws, 'b.txt', 'write', runId);
    writeFileAtomic(path.join(ws, 'b.txt'), 'changed b');

    const checkpoints = listCheckpoints(ws);
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0].files.sort()).toEqual(['a.txt', 'b.txt']);

    const result = rollbackCheckpoint(runId);
    expect(result.ok).toBe(true);
    expect(result.restored.sort()).toEqual(['a.txt', 'b.txt']);
    expect(fs.readFileSync(path.join(ws, 'a.txt'), 'utf8')).toBe('original a');
    expect(fs.readFileSync(path.join(ws, 'b.txt'), 'utf8')).toBe('original b');
  });

  it('restores to the state BEFORE the run, even if a file was written twice in the run', async () => {
    const { snapshotBeforeChange, rollbackCheckpoint } = await import('../src/agent/tools.js');
    const { writeFileAtomic } = await import('../src/util/atomic.js');
    const runId = 'run-test-2';

    fs.writeFileSync(path.join(ws, 'c.txt'), 'version 0');
    snapshotBeforeChange(ws, 'c.txt', 'write', runId);
    writeFileAtomic(path.join(ws, 'c.txt'), 'version 1');
    snapshotBeforeChange(ws, 'c.txt', 'write', runId); // second edit in the SAME run
    writeFileAtomic(path.join(ws, 'c.txt'), 'version 2');

    rollbackCheckpoint(runId);
    // Must land on version 0 (pre-run), not version 1 (the more recent snapshot).
    expect(fs.readFileSync(path.join(ws, 'c.txt'), 'utf8')).toBe('version 0');
  });

  it('restores a file that did not exist before the run by deleting it', async () => {
    const { snapshotBeforeChange, rollbackCheckpoint } = await import('../src/agent/tools.js');
    const { writeFileAtomic } = await import('../src/util/atomic.js');
    const runId = 'run-test-3';

    // File does not exist yet — snapshot records previousContent: null.
    snapshotBeforeChange(ws, 'new-file.txt', 'write', runId);
    writeFileAtomic(path.join(ws, 'new-file.txt'), 'created by agent');
    expect(fs.existsSync(path.join(ws, 'new-file.txt'))).toBe(true);

    rollbackCheckpoint(runId);
    expect(fs.existsSync(path.join(ws, 'new-file.txt'))).toBe(false);
  });

  it('does not group changes made outside an agent run (no runId)', async () => {
    const { snapshotBeforeChange, listCheckpoints } = await import('../src/agent/tools.js');
    fs.writeFileSync(path.join(ws, 'manual.txt'), 'x');
    snapshotBeforeChange(ws, 'manual.txt', 'write'); // no runId — an editor save, not an agent run
    expect(listCheckpoints(ws)).toHaveLength(0);
  });

  it('returns ok:false for an unknown runId', async () => {
    const { rollbackCheckpoint } = await import('../src/agent/tools.js');
    const result = rollbackCheckpoint('does-not-exist');
    expect(result.ok).toBe(false);
  });
});
