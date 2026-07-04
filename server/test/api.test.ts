import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let ws: string;
let dataDir: string;

beforeAll(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-ws-'));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-data-'));
  process.env.EMERALD_DATA_DIR = dataDir;
  process.env.EMERALD_WORKSPACE = ws;
  fs.writeFileSync(path.join(ws, 'hello.txt'), 'hello world');
  fs.mkdirSync(path.join(ws, 'src'));
  fs.writeFileSync(path.join(ws, 'src/app.ts'), 'const answer = 42;');
});

afterAll(() => {
  fs.rmSync(ws, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function app() {
  const { createApp } = await import('../src/index.js');
  return createApp();
}

describe('file system API', () => {
  it('lists the workspace tree', async () => {
    const res = await request(await app()).get('/api/fs/tree');
    expect(res.status).toBe(200);
    const names = res.body.map((e: { name: string }) => e.name);
    expect(names).toContain('hello.txt');
    expect(names).toContain('src');
  });

  it('reads and writes files', async () => {
    const a = await app();
    const read = await request(a).get('/api/fs/read').query({ path: 'hello.txt' });
    expect(read.body.content).toBe('hello world');

    await request(a).post('/api/fs/write').send({ path: 'new.txt', content: 'created' }).expect(200);
    expect(fs.readFileSync(path.join(ws, 'new.txt'), 'utf8')).toBe('created');
  });

  it('refuses deletion without confirmation', async () => {
    const res = await request(await app()).post('/api/fs/delete').send({ path: 'hello.txt' });
    expect(res.status).toBe(400);
    expect(fs.existsSync(path.join(ws, 'hello.txt'))).toBe(true);
  });

  it('blocks path traversal', async () => {
    const res = await request(await app()).get('/api/fs/read').query({ path: '../../etc/passwd' });
    expect(res.status).toBe(500);
  });

  it('blocks cross-origin browser requests but allows loopback', async () => {
    const a = await app();
    const blocked = await request(a).post('/api/fs/write')
      .set('Origin', 'https://evil.example')
      .send({ path: 'hacked.txt', content: 'pwned' });
    expect(blocked.status).toBe(403);
    expect(fs.existsSync(path.join(ws, 'hacked.txt'))).toBe(false);

    const allowed = await request(a).post('/api/fs/write')
      .set('Origin', 'http://localhost:4621')
      .send({ path: 'ok.txt', content: 'fine' });
    expect(allowed.status).toBe(200);
  });
});

describe('search API', () => {
  it('finds matches with file and line info', async () => {
    const res = await request(await app()).get('/api/search').query({ q: 'answer' });
    expect(res.status).toBe(200);
    expect(res.body.results[0].path).toBe('src/app.ts');
    expect(res.body.results[0].line).toBe(1);
  });
});

describe('project index API', () => {
  it('returns file count and a project map', async () => {
    const res = await request(await app()).get('/api/index').query({ refresh: '1' });
    expect(res.status).toBe(200);
    expect(res.body.fileCount).toBeGreaterThanOrEqual(2);
    expect(res.body.map).toContain('src');
  });
});

describe('settings API', () => {
  it('round-trips settings and stores secrets encrypted', async () => {
    const a = await app();
    await request(a).post('/api/settings').send({ beginnerMode: true }).expect(200);
    const res = await request(a).get('/api/settings');
    expect(res.body.settings.beginnerMode).toBe(true);

    await request(a).post('/api/settings/secret').send({ name: 'test-key', value: 'sk-secret' }).expect(200);
    const after = await request(a).get('/api/settings');
    expect(after.body.secretNames).toContain('test-key');
    // The secret value must never appear in plaintext on disk.
    const files = fs.readdirSync(dataDir);
    for (const f of files) {
      const p = path.join(dataDir, f);
      if (fs.statSync(p).isFile()) {
        expect(fs.readFileSync(p, 'latin1')).not.toContain('sk-secret');
      }
    }
  });
});
