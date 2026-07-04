import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { safeJoin } from '../src/util/paths.js';

describe('safeJoin (workspace jail)', () => {
  const root = path.resolve('/tmp/ws');

  it('resolves paths inside the workspace', () => {
    expect(safeJoin(root, 'src/app.ts')).toBe(path.join(root, 'src', 'app.ts'));
    expect(safeJoin(root, '.')).toBe(root);
  });

  it('rejects traversal out of the workspace', () => {
    expect(() => safeJoin(root, '../etc/passwd')).toThrow(/escapes/);
    expect(() => safeJoin(root, 'src/../../other')).toThrow(/escapes/);
  });

  it('rejects absolute paths outside the workspace', () => {
    expect(() => safeJoin(root, '/etc/passwd')).toThrow(/escapes/);
  });

  it('rejects sibling directories with a shared prefix', () => {
    expect(() => safeJoin(root, '../ws-evil/file')).toThrow(/escapes/);
  });
});
