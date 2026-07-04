import chokidar, { type FSWatcher } from 'chokidar';
import path from 'node:path';
import { isIgnoredDir } from '../util/paths.js';
import { ProjectIndex } from './projectIndex.js';

/**
 * Background file watcher → incremental index updates.
 *
 * chokidar gives reliable cross-platform events (native fs.watch is flaky on
 * Linux and differs on Windows). We ignore the same directories the walker
 * prunes, and debounce bursts (git checkout, npm install, save-all) so we
 * re-index each changed file once, not once per intermediate event.
 */
export class IndexWatcher {
  private watcher: FSWatcher | null = null;
  private pending = new Map<string, 'update' | 'remove'>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private index: ProjectIndex) {}

  start(): void {
    this.watcher = chokidar.watch(this.index.root, {
      ignoreInitial: true,          // initial state came from the async build
      followSymlinks: false,        // match the walker + jail
      ignorePermissionErrors: true,
      ignored: (p: string) => p.split(path.sep).some(seg => isIgnoredDir(seg)),
    });
    const rel = (p: string) => path.relative(this.index.root, p).split(path.sep).join('/');
    this.watcher
      .on('add', (p) => this.queue(rel(p), 'update'))
      .on('change', (p) => this.queue(rel(p), 'update'))
      .on('unlink', (p) => this.queue(rel(p), 'remove'));
  }

  private queue(relPath: string, op: 'update' | 'remove'): void {
    if (!relPath || relPath.startsWith('..')) return;
    this.pending.set(relPath, op);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 200);
  }

  private async flush(): Promise<void> {
    const batch = [...this.pending.entries()];
    this.pending.clear();
    for (const [relPath, op] of batch) {
      try {
        if (op === 'remove') this.index.removeFile(relPath);
        else await this.index.updateFile(relPath);
      } catch { /* file churned again; next event will reconcile */ }
    }
  }

  async close(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    await this.watcher?.close();
    this.watcher = null;
  }
}
