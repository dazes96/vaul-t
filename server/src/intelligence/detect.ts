import fs from 'node:fs';
import path from 'node:path';

export interface ProjectInfo {
  frameworks: string[];
  languages: Record<string, number>;   // extension -> file count
  packageManager: string | null;
  buildTools: string[];
  dependencies: string[];
}

const EXT_LANG: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript',
  '.py': 'Python', '.php': 'PHP', '.vue': 'Vue', '.html': 'HTML', '.css': 'CSS',
  '.scss': 'SCSS', '.json': 'JSON', '.md': 'Markdown', '.rs': 'Rust', '.go': 'Go',
  '.rb': 'Ruby', '.java': 'Java', '.sh': 'Shell', '.sql': 'SQL', '.yml': 'YAML', '.yaml': 'YAML',
};

export function languageForExt(ext: string): string | null {
  return EXT_LANG[ext.toLowerCase()] ?? null;
}

function readJson(p: string): Record<string, unknown> | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function exists(root: string, rel: string): boolean {
  return fs.existsSync(path.join(root, rel));
}

/**
 * Detect frameworks, package manager, and build tooling from marker files.
 * Pure heuristics over the file tree — no network, no execution.
 */
export function detectProject(root: string, fileList: string[]): ProjectInfo {
  const frameworks: string[] = [];
  const buildTools: string[] = [];
  let packageManager: string | null = null;
  let dependencies: string[] = [];

  const pkg = readJson(path.join(root, 'package.json'));
  if (pkg) {
    const deps = { ...(pkg.dependencies as object ?? {}), ...(pkg.devDependencies as object ?? {}) } as Record<string, string>;
    dependencies = Object.keys(deps);
    if (deps['next']) frameworks.push('Next.js');
    else if (deps['react']) frameworks.push('React');
    if (deps['vue'] || deps['nuxt']) frameworks.push('Vue');
    if (deps['tailwindcss']) frameworks.push('Tailwind CSS');
    if (deps['express'] || deps['fastify'] || deps['koa']) frameworks.push('Node.js server');
    if (deps['electron']) frameworks.push('Electron');
    if (deps['vite']) buildTools.push('Vite');
    if (deps['webpack']) buildTools.push('Webpack');
    if (deps['typescript']) buildTools.push('TypeScript');
    packageManager = exists(root, 'pnpm-lock.yaml') ? 'pnpm'
      : exists(root, 'yarn.lock') ? 'yarn'
      : exists(root, 'bun.lockb') ? 'bun'
      : 'npm';
  }

  const composer = readJson(path.join(root, 'composer.json'));
  if (composer) {
    packageManager = packageManager ?? 'composer';
    const deps = Object.keys({ ...(composer.require as object ?? {}), ...(composer['require-dev'] as object ?? {}) });
    dependencies.push(...deps);
    if (deps.some(d => d.startsWith('laravel/'))) frameworks.push('Laravel');
  }

  // WordPress: theme style.css header or a plugin header in a root PHP file
  const styleCss = path.join(root, 'style.css');
  if (fs.existsSync(styleCss) && fs.readFileSync(styleCss, 'utf8').includes('Theme Name:')) {
    frameworks.push('WordPress theme');
  }
  for (const f of fileList.filter(f => f.endsWith('.php') && !f.includes('/')).slice(0, 20)) {
    try {
      if (fs.readFileSync(path.join(root, f), 'utf8').includes('Plugin Name:')) {
        frameworks.push('WordPress plugin');
        break;
      }
    } catch { /* unreadable file */ }
  }

  if (exists(root, 'requirements.txt') || exists(root, 'pyproject.toml')) {
    packageManager = packageManager ?? 'pip';
    frameworks.push('Python');
  }
  if (exists(root, 'Dockerfile') || exists(root, 'docker-compose.yml')) buildTools.push('Docker');
  if (exists(root, 'Makefile')) buildTools.push('Make');

  const languages: Record<string, number> = {};
  for (const f of fileList) {
    const lang = languageForExt(path.extname(f));
    if (lang) languages[lang] = (languages[lang] ?? 0) + 1;
  }

  return { frameworks: [...new Set(frameworks)], languages, packageManager, buildTools: [...new Set(buildTools)], dependencies };
}
