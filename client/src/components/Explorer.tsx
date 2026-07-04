import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api';
import { useStore } from '../state/store';

interface Entry { name: string; path: string; type: 'file' | 'dir' }

function Node({ entry, depth }: { entry: Entry; depth: number }) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<Entry[] | null>(null);
  const openFile = useStore(s => s.openFile);
  const activePath = useStore(s => s.activePath);
  const refreshTree = useStore(s => s.refreshTree);
  const treeVersion = useStore(s => s.treeVersion);

  useEffect(() => {
    if (open) void apiGet<Entry[]>(`/api/fs/tree?path=${encodeURIComponent(entry.path)}`).then(setChildren);
  }, [open, entry.path, treeVersion]);

  const onContext = async (e: React.MouseEvent) => {
    e.preventDefault();
    const action = window.prompt(`${entry.path}\n\nType: rename <newname> | delete`, '');
    if (!action) return;
    if (action.startsWith('rename ')) {
      const parts = entry.path.split('/');
      parts[parts.length - 1] = action.slice(7).trim();
      await apiPost('/api/fs/rename', { from: entry.path, to: parts.join('/') });
    } else if (action === 'delete') {
      if (window.confirm(`Delete ${entry.path}? A snapshot is kept in Change History for files.`)) {
        await apiPost('/api/fs/delete', { path: entry.path, confirm: true });
      }
    }
    refreshTree();
  };

  return (
    <>
      <div
        className={`tree-item ${activePath === entry.path ? 'active' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => (entry.type === 'dir' ? setOpen(o => !o) : void openFile(entry.path))}
        onContextMenu={onContext}
        title={entry.path}
      >
        <span className="icon">{entry.type === 'dir' ? (open ? '▾' : '▸') : '·'}</span>
        <span>{entry.name}</span>
      </div>
      {open && children?.map(c => <Node key={c.path} entry={c} depth={depth + 1} />)}
    </>
  );
}

export function Explorer() {
  const [roots, setRoots] = useState<Entry[]>([]);
  const workspace = useStore(s => s.workspace);
  const treeVersion = useStore(s => s.treeVersion);
  const refreshTree = useStore(s => s.refreshTree);

  const load = useCallback(() => {
    void apiGet<Entry[]>('/api/fs/tree').then(setRoots).catch(() => setRoots([]));
  }, []);

  useEffect(load, [load, workspace, treeVersion]);

  const newItem = async (type: 'file' | 'dir') => {
    const p = window.prompt(`New ${type === 'dir' ? 'folder' : 'file'} path (relative to workspace):`);
    if (!p) return;
    await apiPost('/api/fs/create', { path: p, type });
    refreshTree();
  };

  return (
    <>
      <h3>
        Explorer
        <span>
          <button title="New file" onClick={() => void newItem('file')}>＋</button>
          <button title="New folder" onClick={() => void newItem('dir')}>📂</button>
          <button title="Refresh" onClick={refreshTree}>⟳</button>
        </span>
      </h3>
      <div className="panel-body">
        {roots.map(e => <Node key={e.path} entry={e} depth={0} />)}
      </div>
    </>
  );
}
