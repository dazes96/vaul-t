import fs from 'node:fs';
import path from 'node:path';

/**
 * Crash-safe file write: write to a temp file, then rename over the target.
 * rename() is atomic on the same filesystem, so a crash (or power loss) mid-
 * write can never leave a half-written source file or a corrupted undo log —
 * you either get the old contents or the new ones, never garbage.
 */
export function writeFileAtomic(file: string, data: string | Buffer, mode?: number): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmp, data, mode !== undefined ? { mode } : undefined);
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* temp already gone */ }
    throw err;
  }
}

/**
 * Serialize async operations that share a resource (keyed by a string, e.g. a
 * file path). Later calls wait for earlier ones, so read-modify-write cycles
 * can't interleave once any step becomes asynchronous.
 */
const chains = new Map<string, Promise<unknown>>();

export function withLock<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn); // run fn regardless of the previous outcome
  chains.set(key, run.then(() => undefined, () => undefined));
  return run;
}
