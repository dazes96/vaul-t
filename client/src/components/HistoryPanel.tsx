import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api';
import { useStore } from '../state/store';

interface Entry { id: string; time: number; path: string; kind: 'write' | 'delete' }
interface Checkpoint { runId: string; time: number; lastTime: number; files: string[] }

/**
 * Two levels of undo (Priority 6): checkpoints group every file an agent run
 * touched (including auto-heal rounds) so one click reverts the whole task;
 * the flat history below still restores any single file individually.
 */
export function HistoryPanel() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const workspace = useStore(s => s.workspace);
  const refreshTree = useStore(s => s.refreshTree);
  const appendOutput = useStore(s => s.appendOutput);

  const load = useCallback(() => {
    void apiGet<Entry[]>(`/api/settings/history?workspace=${encodeURIComponent(workspace)}`).then(setEntries);
    void apiGet<Checkpoint[]>(`/api/settings/checkpoints?workspace=${encodeURIComponent(workspace)}`).then(setCheckpoints);
  }, [workspace]);

  useEffect(load, [load]);

  const rollback = async (e: Entry) => {
    if (!window.confirm(`Roll back ${e.path} to its state before this ${e.kind}?`)) return;
    const res = await apiPost<{ ok: boolean; message: string }>('/api/settings/rollback', { id: e.id });
    appendOutput(`[history] ${res.message}`);
    refreshTree();
    load();
  };

  const restoreCheckpoint = async (c: Checkpoint) => {
    if (!window.confirm(`Restore all ${c.files.length} file(s) from this run to their state before it ran?\n\n${c.files.join('\n')}`)) return;
    const res = await apiPost<{ ok: boolean; message: string }>('/api/settings/checkpoints/rollback', { runId: c.runId });
    appendOutput(`[checkpoint] ${res.message}`);
    refreshTree();
    load();
  };

  return (
    <>
      <h3>Change History <button title="Refresh" onClick={load}>⟳</button></h3>
      <div className="panel-body" style={{ padding: '0 6px' }}>
        <div style={{ fontSize: 11, color: 'var(--fg-dim)', textTransform: 'uppercase', padding: '6px 6px 2px' }}>Checkpoints (agent runs)</div>
        {checkpoints.length === 0 && <div style={{ padding: '2px 6px 10px', color: 'var(--fg-dim)', fontSize: 12.5 }}>No agent runs yet.</div>}
        {checkpoints.map(c => (
          <div key={c.runId} className="tree-item" onClick={() => void restoreCheckpoint(c)} title="Click to restore all files in this run">
            <span className="icon">↺</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {c.files.length} file{c.files.length === 1 ? '' : 's'}
              <div style={{ fontSize: 10.5, color: 'var(--fg-dim)' }}>{new Date(c.lastTime).toLocaleString()} — {c.files.join(', ')}</div>
            </span>
          </div>
        ))}

        <div style={{ fontSize: 11, color: 'var(--fg-dim)', textTransform: 'uppercase', padding: '10px 6px 2px' }}>All changes</div>
        {entries.length === 0 && <div style={{ padding: '2px 6px 8px', color: 'var(--fg-dim)' }}>No recorded changes yet.</div>}
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
