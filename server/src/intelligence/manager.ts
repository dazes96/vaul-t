import { ProjectIndex } from './projectIndex.js';
import { IndexWatcher } from './watcher.js';

interface Managed {
  index: ProjectIndex;
  watcher: IndexWatcher;
  ready: Promise<void>;
}

// One index + watcher per workspace root, shared across all requests.
const managed = new Map<string, Managed>();

/**
 * Get the live index for a workspace, building it (and starting the watcher)
 * on first use. Subsequent calls return the same instance — the watcher keeps
 * it current, so there is no polling/TTL rebuild.
 */
export function getProjectIndex(root: string): Promise<ProjectIndex> {
  let m = managed.get(root);
  if (!m) {
    const index = new ProjectIndex(root);
    const watcher = new IndexWatcher(index);
    const ready = index.build().then(() => watcher.start());
    const entry: Managed = { index, watcher, ready };
    m = entry;
    managed.set(root, entry);
    // If the initial build or watcher start fails, evict the entry so the next
    // request retries from scratch. Without this, a transient error (a file
    // permission hiccup, a directory removed mid-walk) would cache a rejected
    // promise forever and permanently break this workspace's index until the
    // server is restarted.
    ready.catch(async () => {
      if (managed.get(root) === entry) managed.delete(root);
      try { await watcher.close(); } catch { /* nothing to close */ }
    });
  }
  return m.ready.then(() => m!.index);
}

/** Force a full rebuild (e.g. after switching branches manually). */
export async function rebuildProjectIndex(root: string): Promise<ProjectIndex> {
  const m = managed.get(root);
  if (!m) return getProjectIndex(root);
  await m.index.build();
  return m.index;
}

/** Close all watchers — called on graceful shutdown. */
export async function closeAllIndexes(): Promise<void> {
  await Promise.all([...managed.values()].map(m => m.watcher.close()));
  managed.clear();
}
