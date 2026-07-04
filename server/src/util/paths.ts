import path from 'node:path';
import os from 'node:os';

/** Directory where Emerald stores settings, history, and conversations. */
export function dataDir(): string {
  return process.env.EMERALD_DATA_DIR || path.join(os.homedir(), '.emerald-code-studio');
}

/**
 * Resolve a workspace-relative path and refuse anything that escapes the
 * workspace root. This is the single safety chokepoint for all file access.
 */
export function safeJoin(workspaceRoot: string, relPath: string): string {
  const resolved = path.resolve(workspaceRoot, relPath);
  const root = path.resolve(workspaceRoot);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
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
