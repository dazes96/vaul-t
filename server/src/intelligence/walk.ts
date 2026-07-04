import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { isIgnoredDir } from '../util/paths.js';

export interface WalkedFile {
  path: string;      // workspace-relative, forward slashes
  size: number;
  mtimeMs: number;
}

/**
 * Async, non-blocking directory walk. Uses fs/promises so it never blocks the
 * event loop the way the old synchronous walker did — the server stays
 * responsive to chat/agent/editor requests while a large repo is being indexed.
 *
 * Symlinks (files and directories) are skipped: this avoids walk cycles and
 * keeps the index from reaching outside the workspace, matching the safeJoin
 * jail. Ignored directories (node_modules, .git, dist, …) are pruned.
 */
export async function* walkFiles(root: string, maxFiles = 50_000): AsyncGenerator<WalkedFile> {
  let count = 0;
  async function* recurse(dir: string, rel: string): AsyncGenerator<WalkedFile> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory — skip
    }
    for (const e of entries) {
      if (count >= maxFiles) return;
      if (e.isSymbolicLink()) continue;
      if (e.name.startsWith('.') && e.name !== '.env.example' && e.name !== '.gitignore') {
        if (!e.isDirectory()) continue;
        if (isIgnoredDir(e.name)) continue;
      }
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!isIgnoredDir(e.name)) yield* recurse(abs, relPath);
      } else if (e.isFile()) {
        try {
          const st = await fsp.stat(abs);
          count++;
          yield { path: relPath, size: st.size, mtimeMs: st.mtimeMs };
        } catch { /* vanished mid-walk */ }
      }
    }
  }
  yield* recurse(root, '');
}

/** Run an async mapper over items with a bounded number in flight at once. */
export async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}
