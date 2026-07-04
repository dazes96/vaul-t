import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api';
import { useStore } from '../state/store';

interface GitStatus {
  isRepo: boolean;
  branch?: string;
  files?: { status: string; path: string }[];
}

export function GitPanel() {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [message, setMessage] = useState('');
  const openFile = useStore(s => s.openFile);
  const appendOutput = useStore(s => s.appendOutput);

  const refresh = useCallback(() => {
    void apiGet<GitStatus>('/api/git/status').then(setStatus).catch(() => setStatus({ isRepo: false }));
  }, []);

  useEffect(refresh, [refresh]);

  const commit = async () => {
    await apiPost('/api/git/stage', { paths: (status?.files ?? []).map(f => f.path) });
    const res = await apiPost<{ ok: boolean; output: string }>('/api/git/commit', { message });
    appendOutput(`[git] ${res.output}`);
    setMessage('');
    refresh();
  };

  const reset = async () => {
    if (!window.confirm('Discard ALL uncommitted changes (git reset --hard)? This cannot be undone.')) return;
    const res = await apiPost<{ ok: boolean; output: string }>('/api/git/reset', { confirm: true, hard: true });
    appendOutput(`[git] ${res.output}`);
    refresh();
  };

  if (!status) return <><h3>Git</h3><div className="panel-body" style={{ padding: 10 }}>Loading…</div></>;
  if (!status.isRepo) return <><h3>Git</h3><div className="panel-body" style={{ padding: 10, color: 'var(--fg-dim)' }}>Not a git repository. Run <code>git init</code> in the terminal.</div></>;

  return (
    <>
      <h3>Git <span className="badge">{status.branch}</span></h3>
      <div className="panel-body" style={{ padding: '0 10px' }}>
        <textarea
          style={{ width: '100%', minHeight: 52, marginBottom: 6 }}
          placeholder="Commit message…"
          value={message}
          onChange={e => setMessage(e.target.value)}
        />
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <button className="primary" disabled={!message.trim()} onClick={() => void commit()}>Commit all</button>
          <button onClick={refresh}>⟳</button>
          <button className="danger" title="git reset --hard" onClick={() => void reset()}>Reset</button>
        </div>
        {(status.files ?? []).length === 0 && <div style={{ color: 'var(--fg-dim)' }}>Working tree clean.</div>}
        {(status.files ?? []).map(f => (
          <div key={f.path} className="git-file" onClick={() => void openFile(f.path)} title={f.path}>
            <span className="st">{f.status || '·'}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.path}</span>
          </div>
        ))}
      </div>
    </>
  );
}
