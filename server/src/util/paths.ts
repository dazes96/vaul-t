import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** Directory where Emerald stores settings, history, and conversations. */
export function dataDir(): string {
  return process.env.EMERALD_DATA_DIR || path.join(os.homedir(), '.emerald-code-studio');
}

/** realpath() a path, falling back to a pure resolve if it doesn't exist yet. */
function realOrResolve(p: string): string {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

/**
 * Resolve a workspace-relative path and refuse anything that escapes the
 * workspace root. This is the single safety chokepoint for all file access.
 *
 * The jail is symlink-aware: it resolves the real (symlink-followed) location
 * of the nearest existing ancestor before checking containment, so a symlink
 * inside the workspace that points at, say, /etc cannot be used to read or
 * write outside the workspace. A pure string check (path.resolve + prefix)
 * does NOT catch that — this is why we touch the filesystem here.
 *
 * Note: there is an inherent TOCTOU window (a symlink could be swapped between
 * this check and the actual IO). For a single-user local tool operating on
 * your own repos that is an acceptable risk; a hardened multi-tenant server
 * would need openat2/RESOLVE_BENEATH-style enforcement instead.
 */
export function safeJoin(workspaceRoot: string, relPath: string): string {
  const resolved = path.resolve(workspaceRoot, relPath);
  const realRoot = realOrResolve(workspaceRoot);

  // Walk up to the nearest ancestor that actually exists, then realpath it and
  // re-append the not-yet-created tail. This makes writes to new files safe too.
  let existing = resolved;
  const tail: string[] = [];
  while (!fs.existsSync(existing)) {
    tail.unshift(path.basename(existing));
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const realFinal = path.resolve(realOrResolve(existing), ...tail);

  if (realFinal !== realRoot && !realFinal.startsWith(realRoot + path.sep)) {
    throw new Error(`Path escapes workspace: ${relPath}`);
  }
  return resolved;
}

/** Directories never worth indexing, searching, or sending to a model. */
export const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt',
  'vendor', '__pycache__', '.venv', 'venv', 'coverage', '.cache',
  '.idea', '.vscode', '.emerald-data', 'target', '.svelte-kit',
]);

export function isIgnoredDir(name: string): boolean {
  return IGNORED_DIRS.has(name);
}
