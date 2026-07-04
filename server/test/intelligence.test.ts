import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { extractSymbols, extractImports } from '../src/intelligence/symbols.js';
import { ProjectIndex } from '../src/intelligence/projectIndex.js';
import { selectContext } from '../src/intelligence/retrieval.js';
import { searchAsync } from '../src/intelligence/search.js';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-intel-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('symbol extraction', () => {
  it('extracts TS functions, classes, interfaces, types, components', () => {
    const src = [
      'export interface User { id: number }',
      'export type Id = string;',
      'export class UserService {}',
      'export function fetchUser() {}',
      'export const helper = () => 1;',
      'export const Button = () => <div/>;',
    ].join('\n');
    const syms = extractSymbols('a.tsx', src);
    const byName = Object.fromEntries(syms.map(s => [s.name, s.kind]));
    expect(byName.User).toBe('interface');
    expect(byName.Id).toBe('type');
    expect(byName.UserService).toBe('class');
    expect(byName.fetchUser).toBe('function');
    expect(byName.helper).toBe('function');
    expect(byName.Button).toBe('component');
  });

  it('extracts Express routes', () => {
    const syms = extractSymbols('r.ts', `r.get('/health', h); r.post('/users', h);`);
    expect(syms.some(s => s.kind === 'route' && s.name === 'GET /health')).toBe(true);
  });

  it('extracts Python and PHP + WordPress hooks', () => {
    expect(extractSymbols('a.py', 'def run():\n    pass\nclass Foo:\n    pass').map(s => s.name)).toEqual(['run', 'Foo']);
    const php = extractSymbols('p.php', `<?php\nclass Plugin {}\nadd_action('init', 'setup');`);
    expect(php.some(s => s.kind === 'class' && s.name === 'Plugin')).toBe(true);
    expect(php.some(s => s.kind === 'hook' && s.name === 'init')).toBe(true);
  });

  it('extracts import specifiers', () => {
    const imps = extractImports('a.ts', `import { x } from './b';\nimport c from '../c';\nconst d = require('pkg');`);
    expect(imps).toContain('./b');
    expect(imps).toContain('../c');
    expect(imps).toContain('pkg');
  });
});

describe('ProjectIndex build + graph', () => {
  it('builds an index with symbols and a resolved import graph', async () => {
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src/util.ts'), 'export function add(a,b){return a+b;}');
    fs.writeFileSync(path.join(dir, 'src/main.ts'), `import { add } from './util';\nexport const main = () => add(1,2);`);
    fs.mkdirSync(path.join(dir, 'node_modules/pkg'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules/pkg/i.js'), 'x');

    const idx = new ProjectIndex(dir);
    await idx.build();

    expect(idx.filePaths()).toContain('src/main.ts');
    expect(idx.filePaths().some(p => p.includes('node_modules'))).toBe(false);
    expect(idx.symbolLookup('add')).toContain('src/util.ts');
    // main imports util => edge resolved
    expect(idx.importsOf('src/main.ts')).toContain('src/util.ts');
    expect(idx.importedBy('src/util.ts')).toContain('src/main.ts');
    expect(idx.map).toContain('import edges');
  });

  it('updates and removes files incrementally, keeping symbol + graph indexes consistent', async () => {
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export function alpha(){}');
    const idx = new ProjectIndex(dir);
    await idx.build();
    expect(idx.symbolLookup('alpha')).toContain('a.ts');

    // rename symbol inside the file
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export function beta(){}');
    await idx.updateFile('a.ts');
    expect(idx.symbolLookup('alpha')).toHaveLength(0); // old symbol gone
    expect(idx.symbolLookup('beta')).toContain('a.ts');

    // delete the file
    idx.removeFile('a.ts');
    expect(idx.filePaths()).not.toContain('a.ts');
    expect(idx.symbolLookup('beta')).toHaveLength(0);
  });
});

describe('retrieval quality', () => {
  it('finds the file defining a symbol even when the filename is unrelated', async () => {
    fs.writeFileSync(path.join(dir, 'zzz_obscure_name.ts'), 'export function computeInvoiceTotal(){ return 0; }');
    fs.writeFileSync(path.join(dir, 'other.ts'), 'export const nothing = 1;');
    const idx = new ProjectIndex(dir);
    await idx.build();
    const ctx = await selectContext(idx, 'where is computeInvoiceTotal defined?');
    expect(ctx[0].path).toBe('zzz_obscure_name.ts');
    expect(ctx[0].reason).toBe('symbol');
  });

  it('pulls in graph-related files', async () => {
    fs.writeFileSync(path.join(dir, 'db.ts'), 'export function query(){}');
    fs.writeFileSync(path.join(dir, 'users.ts'), `import { query } from './db';\nexport function listUsers(){ return query(); }`);
    const idx = new ProjectIndex(dir);
    await idx.build();
    const ctx = await selectContext(idx, 'listUsers');
    const paths = ctx.map(c => c.path);
    expect(paths).toContain('users.ts');
    expect(paths).toContain('db.ts'); // related via import graph
  });
});

describe('async search', () => {
  it('finds content matches with path and line numbers, off the event loop', async () => {
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src/app.ts'), 'const secret = 42;\nconst other = 1;');
    const idx = new ProjectIndex(dir);
    await idx.build();
    const hits = await searchAsync(idx, 'secret');
    expect(hits[0]).toMatchObject({ path: 'src/app.ts', line: 1 });
  });
});
