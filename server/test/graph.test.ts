import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProjectIndex } from '../src/intelligence/projectIndex.js';
import { buildGraph, availableGraphs } from '../src/intelligence/graph.js';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-graph-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

async function indexOf(files: Record<string, string>): Promise<ProjectIndex> {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  const idx = new ProjectIndex(dir);
  await idx.build();
  return idx;
}

describe('import graph', () => {
  it('builds file nodes and resolved import edges from the index', async () => {
    const idx = await indexOf({
      'src/util.ts': 'export function add(a,b){return a+b;}',
      'src/main.ts': "import { add } from './util';\nexport const main = () => add(1,2);",
    });
    const g = buildGraph(idx, 'imports');
    const ids = g.nodes.map(n => n.id);
    expect(ids).toContain('src/main.ts');
    expect(ids).toContain('src/util.ts');
    expect(g.edges).toContainEqual({ source: 'src/main.ts', target: 'src/util.ts' });
  });

  it('tags component files by the symbols they define', async () => {
    const idx = await indexOf({
      'ui/Button.tsx': 'export const Button = () => <button/>;',
    });
    const g = buildGraph(idx, 'imports');
    const btn = g.nodes.find(n => n.id === 'ui/Button.tsx');
    expect(btn?.kind).toBe('component');
  });
});

describe('routes and hooks graphs', () => {
  it('builds a routes graph linking each route to its file', async () => {
    const idx = await indexOf({
      'server/api.ts': "r.get('/health', h);\nr.post('/users', h);",
    });
    const g = buildGraph(idx, 'routes');
    expect(g.nodes.some(n => n.kind === 'route' && n.label.includes('/health'))).toBe(true);
    // each route node links to the defining file
    const routeNode = g.nodes.find(n => n.kind === 'route');
    expect(g.edges.some(e => e.source === routeNode!.id && e.target === 'server/api.ts')).toBe(true);
  });

  it('builds a WordPress hooks graph when hooks are present', async () => {
    const idx = await indexOf({
      'plugin.php': "<?php\nadd_action('init', 'setup');\nadd_filter('the_content', 'filterit');",
    });
    const g = buildGraph(idx, 'hooks');
    expect(g.nodes.some(n => n.kind === 'hook' && n.label === 'init')).toBe(true);
  });

  it('reports a friendly note when a requested graph has no data', async () => {
    const idx = await indexOf({ 'a.ts': 'export const x = 1;' });
    const g = buildGraph(idx, 'routes');
    expect(g.nodes).toHaveLength(0);
    expect(g.note).toMatch(/no routes/i);
  });
});

describe('focus graph', () => {
  it('returns only a file and its direct neighbours', async () => {
    const idx = await indexOf({
      'a.ts': 'export const a = 1;',
      'b.ts': "import { a } from './a';\nexport const b = a;",
      'c.ts': "import { b } from './b';\nexport const c = b;",
      'unrelated.ts': 'export const z = 9;',
    });
    const g = buildGraph(idx, 'focus', 'b.ts');
    const ids = g.nodes.map(n => n.id).sort();
    expect(ids).toContain('b.ts');
    expect(ids).toContain('a.ts'); // b imports a
    expect(ids).toContain('c.ts'); // c imports b
    expect(ids).not.toContain('unrelated.ts');
  });
});

describe('availableGraphs', () => {
  it('lists only graph types that have data', async () => {
    const idx = await indexOf({
      'ui/Card.tsx': 'export const Card = () => <div/>;',
      'server/api.ts': "app.get('/x', h);",
    });
    const avail = availableGraphs(idx);
    expect(avail).toContain('imports');
    expect(avail).toContain('components');
    expect(avail).toContain('routes');
    expect(avail).not.toContain('hooks');
  });
});
