import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let ws: string;
let dataDir: string;

beforeAll(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-modify-ws-'));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-modify-data-'));
  process.env.EMERALD_DATA_DIR = dataDir;
});
afterAll(() => {
  fs.rmSync(ws, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('write_file with user-edited content', () => {
  it('writes the AI-proposed content when the user does not edit it', async () => {
    const { executeTool } = await import('../src/agent/tools.js');
    const result = await executeTool(ws, { tool: 'write_file', path: 'a.txt', content: 'ai version' });
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(path.join(ws, 'a.txt'), 'utf8')).toBe('ai version');
    expect(result.output).not.toContain('user edited');
  });

  it('writes the user-edited content instead of the AI-proposed content when it differs', async () => {
    const { executeTool } = await import('../src/agent/tools.js');
    const result = await executeTool(ws, { tool: 'write_file', path: 'b.txt', content: 'ai version' }, undefined, 'user-edited version');
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(path.join(ws, 'b.txt'), 'utf8')).toBe('user-edited version');
    expect(result.output).toContain('user edited');
  });

  it('does not flag it as user-edited when the edited content happens to match the original', async () => {
    const { executeTool } = await import('../src/agent/tools.js');
    const result = await executeTool(ws, { tool: 'write_file', path: 'c.txt', content: 'same' }, undefined, 'same');
    expect(result.output).not.toContain('user edited');
  });

  it('still records an undo snapshot for the pre-edit file state', async () => {
    const { executeTool, rollback, readHistory } = await import('../src/agent/tools.js');
    fs.writeFileSync(path.join(ws, 'd.txt'), 'original');
    await executeTool(ws, { tool: 'write_file', path: 'd.txt', content: 'ai proposal' }, undefined, 'edited by human');
    expect(fs.readFileSync(path.join(ws, 'd.txt'), 'utf8')).toBe('edited by human');
    const entry = readHistory().find(e => e.path === 'd.txt');
    expect(entry).toBeDefined();
    rollback(entry!.id);
    expect(fs.readFileSync(path.join(ws, 'd.txt'), 'utf8')).toBe('original');
  });
});
