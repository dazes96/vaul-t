import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { safeJoin } from '../src/util/paths.js';
import { isAllowedOrigin } from '../src/util/origin.js';
import { writeFileAtomic, withLock } from '../src/util/atomic.js';

let ws: string;
let outside: string;

beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-ws-'));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-out-'));
});

afterEach(() => {
  fs.rmSync(ws, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

describe('safeJoin symlink jail', () => {
  it('allows normal paths inside the workspace', () => {
    expect(() => safeJoin(ws, 'src/app.ts')).not.toThrow();
  });

  it('rejects ../ traversal', () => {
    expect(() => safeJoin(ws, '../escape')).toThrow(/escapes/);
  });

  it('rejects reading through a symlink that points outside the workspace', () => {
    // A symlink inside the workspace whose target is an external directory.
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'top secret');
    fs.symlinkSync(outside, path.join(ws, 'link'));
    // Pure string checks would allow "link/secret.txt" (it looks contained);
    // the realpath-aware jail must reject it.
    expect(() => safeJoin(ws, 'link/secret.txt')).toThrow(/escapes/);
  });

  it('rejects writing a NEW file through an escaping symlink', () => {
    fs.symlinkSync(outside, path.join(ws, 'link'));
    expect(() => safeJoin(ws, 'link/newfile.txt')).toThrow(/escapes/);
  });

  it('allows a symlink that stays inside the workspace', () => {
    fs.mkdirSync(path.join(ws, 'real'));
    fs.symlinkSync(path.join(ws, 'real'), path.join(ws, 'alias'));
    expect(() => safeJoin(ws, 'alias/file.txt')).not.toThrow();
  });
});

describe('isAllowedOrigin (CSRF guard)', () => {
  it('allows requests with no Origin (curl, native tools)', () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
    expect(isAllowedOrigin('')).toBe(true);
  });

  it('allows loopback origins', () => {
    expect(isAllowedOrigin('http://localhost:4620')).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:4621')).toBe(true);
    expect(isAllowedOrigin('http://[::1]:4620')).toBe(true);
  });

  it('blocks external websites', () => {
    expect(isAllowedOrigin('https://evil.example')).toBe(false);
    expect(isAllowedOrigin('http://attacker.com')).toBe(false);
    // A lookalike host must not slip through.
    expect(isAllowedOrigin('http://127.0.0.1.evil.com')).toBe(false);
    expect(isAllowedOrigin('http://notlocalhost.com')).toBe(false);
  });
});

describe('writeFileAtomic', () => {
  it('writes content and leaves no temp files behind', () => {
    const f = path.join(ws, 'out.txt');
    writeFileAtomic(f, 'hello');
    expect(fs.readFileSync(f, 'utf8')).toBe('hello');
    expect(fs.readdirSync(ws).filter(n => n.includes('.tmp'))).toHaveLength(0);
  });

  it('creates parent directories', () => {
    const f = path.join(ws, 'a/b/c.txt');
    writeFileAtomic(f, 'nested');
    expect(fs.readFileSync(f, 'utf8')).toBe('nested');
  });
});

describe('withLock', () => {
  it('serializes overlapping async read-modify-write cycles', async () => {
    const f = path.join(ws, 'counter.json');
    writeFileAtomic(f, JSON.stringify({ n: 0 }));
    const bump = () => withLock(f, async () => {
      const cur = JSON.parse(fs.readFileSync(f, 'utf8')).n;
      await new Promise(r => setTimeout(r, 5)); // force interleaving if unlocked
      writeFileAtomic(f, JSON.stringify({ n: cur + 1 }));
    });
    await Promise.all([bump(), bump(), bump(), bump(), bump()]);
    expect(JSON.parse(fs.readFileSync(f, 'utf8')).n).toBe(5);
  });
});
