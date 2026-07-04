import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { detectProject } from '../src/intelligence/detect.js';
import { buildIndex } from '../src/intelligence/indexer.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-test-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('project detection', () => {
  it('detects a Next.js + Tailwind project with npm', () => {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      dependencies: { next: '^14', react: '^18' },
      devDependencies: { tailwindcss: '^3', typescript: '^5' },
    }));
    const info = detectProject(dir, ['package.json']);
    expect(info.frameworks).toContain('Next.js');
    expect(info.frameworks).toContain('Tailwind CSS');
    expect(info.frameworks).not.toContain('React'); // Next implies React
    expect(info.packageManager).toBe('npm');
    expect(info.buildTools).toContain('TypeScript');
  });

  it('detects a WordPress plugin', () => {
    fs.writeFileSync(path.join(dir, 'my-plugin.php'), '<?php\n/*\nPlugin Name: My Plugin\n*/');
    const info = detectProject(dir, ['my-plugin.php']);
    expect(info.frameworks).toContain('WordPress plugin');
  });

  it('detects Laravel via composer', () => {
    fs.writeFileSync(path.join(dir, 'composer.json'), JSON.stringify({
      require: { 'laravel/framework': '^11.0' },
    }));
    const info = detectProject(dir, ['composer.json']);
    expect(info.frameworks).toContain('Laravel');
  });
});

describe('indexer', () => {
  it('indexes files, skips node_modules, and builds a map', () => {
    fs.mkdirSync(path.join(dir, 'src'));
    fs.mkdirSync(path.join(dir, 'node_modules/pkg'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src/main.ts'), 'export {}');
    fs.writeFileSync(path.join(dir, 'node_modules/pkg/index.js'), '');
    const idx = buildIndex(dir);
    expect(idx.files.map(f => f.path)).toContain('src/main.ts');
    expect(idx.files.some(f => f.path.includes('node_modules'))).toBe(false);
    expect(idx.map).toContain('`src/`: main.ts');
  });

  it('reuses unchanged entries on incremental rebuild', () => {
    fs.writeFileSync(path.join(dir, 'a.ts'), 'x');
    const first = buildIndex(dir);
    const second = buildIndex(dir, first);
    expect(second.files[0]).toBe(first.files[0]); // same object => reused
  });
});
