import fs from 'node:fs';
import path from 'node:path';
import { isIgnoredDir } from '../util/paths.js';
import { detectProject, type ProjectInfo } from './detect.js';

export interface IndexedFile {
  path: string;      // workspace-relative, forward slashes
  size: number;
  mtimeMs: number;
}

export interface ProjectIndex {
  root: string;
  builtAt: number;
  files: IndexedFile[];
  info: ProjectInfo;
  map: string;       // human/model-readable project map (markdown)
}

const MAX_FILES = 20_000;

/** Walk the workspace, skipping ignored dirs. Incremental: reuses stat info when unchanged. */
export function buildIndex(root: string, previous?: ProjectIndex): ProjectIndex {
  const files: IndexedFile[] = [];
  const prevByPath = new Map(previous?.files.map(f => [f.path, f]) ?? []);

  function walk(dir: string, rel: string) {
    if (files.length >= MAX_FILES) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.env.example') {
        if (!e.isDirectory() || isIgnoredDir(e.name)) continue;
      }
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!isIgnoredDir(e.name)) walk(path.join(dir, e.name), relPath);
      } else if (e.isFile()) {
        try {
          const st = fs.statSync(path.join(dir, e.name));
          const prev = prevByPath.get(relPath);
          files.push(prev && prev.mtimeMs === st.mtimeMs
            ? prev
            : { path: relPath, size: st.size, mtimeMs: st.mtimeMs });
        } catch { /* file vanished mid-walk */ }
      }
    }
  }

  walk(root, '');
  const info = detectProject(root, files.map(f => f.path));
  return { root, builtAt: Date.now(), files, info, map: renderMap(root, files, info) };
}

/** A compact markdown project map — given to the model as architecture memory. */
function renderMap(root: string, files: IndexedFile[], info: ProjectInfo): string {
  const lines: string[] = [
    `# Project map: ${path.basename(root)}`,
    '',
    `- Frameworks: ${info.frameworks.join(', ') || 'none detected'}`,
    `- Languages: ${Object.entries(info.languages).sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l} (${n})`).join(', ') || 'none'}`,
    `- Package manager: ${info.packageManager ?? 'none detected'}`,
    `- Build tools: ${info.buildTools.join(', ') || 'none detected'}`,
    '',
    '## Files',
  ];
  // Show tree up to a budget so huge projects still produce a useful map.
  const shown = files.slice(0, 500);
  const dirs = new Map<string, string[]>();
  for (const f of shown) {
    const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '.';
    if (!dirs.has(dir)) dirs.set(dir, []);
    dirs.get(dir)!.push(f.path.slice(f.path.lastIndexOf('/') + 1));
  }
  for (const [dir, names] of [...dirs.entries()].sort()) {
    lines.push(`- \`${dir}/\`: ${names.join(', ')}`);
  }
  if (files.length > shown.length) lines.push(`- …and ${files.length - shown.length} more files`);
  return lines.join('\n');
}

/** Pick files worth inlining into model context, ranked by relevance to the query. */
export function selectContextFiles(index: ProjectIndex, query: string, budgetBytes = 60_000): { path: string; content: string }[] {
  const terms = query.toLowerCase().split(/\W+/).filter(t => t.length > 2);
  const scored = index.files
    .filter(f => f.size > 0 && f.size < 100_000 && isTextFile(f.path))
    .map(f => {
      const p = f.path.toLowerCase();
      let score = 0;
      for (const t of terms) if (p.includes(t)) score += 5;
      if (/readme|package\.json|composer\.json|main|index|app/.test(p)) score += 2;
      const depth = f.path.split('/').length;
      score += Math.max(0, 3 - depth);
      return { f, score };
    })
    .sort((a, b) => b.score - a.score);

  const out: { path: string; content: string }[] = [];
  let used = 0;
  for (const { f, score } of scored) {
    if (score <= 0 && out.length >= 3) break;
    if (used + f.size > budgetBytes) continue;
    try {
      out.push({ path: f.path, content: fs.readFileSync(path.join(index.root, f.path), 'utf8') });
      used += f.size;
    } catch { /* skip unreadable */ }
    if (out.length >= 12) break;
  }
  return out;
}

const TEXT_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.php', '.vue', '.html', '.css', '.scss', '.json', '.md', '.txt', '.yml', '.yaml', '.sh', '.sql', '.rs', '.go', '.rb', '.java', '.env.example', '.xml', '.toml', '.ini', '.cfg', '.svelte']);

export function isTextFile(p: string): boolean {
  return TEXT_EXT.has(path.extname(p).toLowerCase()) || /(^|\/)(Makefile|Dockerfile|LICENSE)$/.test(p);
}
