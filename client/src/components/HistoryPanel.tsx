import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api';
import { useStore } from '../state/store';

interface Entry { id: string; time: number; path: string; kind: 'write' | 'delete' }

/** Every AI or editor write/delete is snapshotted; roll any of them back here. */
export function HistoryPanel() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const workspace = useStore(s => s.workspace);
  const refreshTree = useStore(s => s.refreshTree);
  const appendOutput = useStore(s => s.appendOutput);

  const load = useCallback(() => {
    void apiGet<Entry[]>(`/api/settings/history?workspace=${encodeURIComponent(workspace)}`).then(setEntries);
  }, [workspace]);

  useEffect(load, [load]);

  const rollback = async (e: Entry) => {
    if (!window.confirm(`Roll back ${e.path} to its state before this ${e.kind}?`)) return;
    const res = await apiPost<{ ok: boolean; message: string }>('/api/settings/rollback', { id: e.id });
    appendOutput(`[history] ${res.message}`);
    refreshTree();
    load();
  };

  return (
    <>
      <h3>Change History <button title="Refresh" onClick={load}>⟳</button></h3>
      <div className="panel-body" style={{ padding: '0 6px' }}>
        {entries.length === 0 && <div style={{ padding: 8, color: 'var(--fg-dim)' }}>No recorded changes yet.</div>}
        {entries.map(e => (
          <div key={e.id} className="tree-item" onClick={() => void rollback(e)} title="Click to roll back">
            <span className="icon">{e.kind === 'delete' ? '✖' : '✎'}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {e.path}
              <div style={{ fontSize: 10.5, color: 'var(--fg-dim)' }}>{new Date(e.time).toLocaleString()}</div>
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
