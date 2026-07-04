import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api';
import { useStore } from '../state/store';

interface Memory {
  workspace: string;
  updatedAt: number;
  architecture: string;
  conventions: string[];
  preferences: string[];
  importantFiles: { path: string; note: string }[];
  knownBugs: { id: string; note: string; resolved: boolean; time: number }[];
  priorFixes: { id: string; time: number; summary: string; files: string[] }[];
  decisions: { id: string; time: number; note: string }[];
  detected: { frameworks: string[]; languages: string[]; packageManager: string | null };
}

/**
 * Project memory — inspectable and editable. Everything the IDE remembers about
 * this project lives here as plain, local JSON; you can read it, edit it, or
 * reset it. The agent reads a relevance-filtered slice of this when planning,
 * and appends to prior fixes after successful tasks.
 */
export function MemoryPanel() {
  const [mem, setMem] = useState<Memory | null>(null);
  const [dirty, setDirty] = useState(false);
  const workspace = useStore(s => s.workspace);

  const load = useCallback(() => {
    void apiGet<Memory>('/api/memory').then(m => { setMem(m); setDirty(false); });
  }, [workspace]);

  useEffect(load, [load]);

  if (!mem) return <><h3>Memory</h3><div className="panel-body" style={{ padding: 10, color: 'var(--fg-dim)' }}>Loading…</div></>;

  const save = async () => {
    await apiPost('/api/memory', {
      architecture: mem.architecture,
      conventions: mem.conventions,
      preferences: mem.preferences,
      importantFiles: mem.importantFiles,
      knownBugs: mem.knownBugs,
      decisions: mem.decisions,
    });
    setDirty(false);
  };

  const reset = async () => {
    if (!window.confirm('Reset all memory for this project? This clears architecture notes, conventions, prior fixes, and known bugs. It cannot be undone.')) return;
    await apiPost('/api/memory/reset', { confirm: true });
    load();
  };

  const upd = (patch: Partial<Memory>) => { setMem({ ...mem, ...patch }); setDirty(true); };
  const asLines = (arr: string[]) => arr.join('\n');
  const fromLines = (s: string) => s.split('\n').map(l => l.trim()).filter(Boolean);

  return (
    <>
      <h3>
        Memory
        <span>
          {dirty && <button className="primary" style={{ fontSize: 11 }} onClick={() => void save()}>Save</button>}
          <button title="Reload" onClick={load}>⟳</button>
          <button title="Reset memory" className="danger" onClick={() => void reset()}>Reset</button>
        </span>
      </h3>
      <div className="panel-body" style={{ padding: '0 10px', fontSize: 12.5 }}>
        <div className="mem-section">Detected (auto)</div>
        <div style={{ color: 'var(--fg-dim)', marginBottom: 8 }}>
          {mem.detected.frameworks.join(', ') || 'no frameworks'} · {mem.detected.languages.slice(0, 5).join(', ') || 'no languages'} · {mem.detected.packageManager ?? 'no package manager'}
        </div>

        <div className="mem-section">Architecture</div>
        <textarea
          style={{ width: '100%', minHeight: 60, marginBottom: 8 }}
          placeholder="Describe how this project is organized…"
          value={mem.architecture}
          onChange={e => upd({ architecture: e.target.value })}
        />

        <div className="mem-section">Conventions (one per line)</div>
        <textarea
          style={{ width: '100%', minHeight: 50, marginBottom: 8 }}
          placeholder="prefer named exports&#10;2-space indent"
          value={asLines(mem.conventions)}
          onChange={e => upd({ conventions: fromLines(e.target.value) })}
        />

        <div className="mem-section">Preferences (one per line)</div>
        <textarea
          style={{ width: '100%', minHeight: 50, marginBottom: 8 }}
          placeholder="explain tradeoffs before big changes"
          value={asLines(mem.preferences)}
          onChange={e => upd({ preferences: fromLines(e.target.value) })}
        />

        <div className="mem-section">Important files</div>
        {mem.importantFiles.length === 0 && <div style={{ color: 'var(--fg-dim)', marginBottom: 6 }}>None yet.</div>}
        {mem.importantFiles.map((f, i) => (
          <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
            <input style={{ flex: '0 0 40%' }} value={f.path} onChange={e => { const next = [...mem.importantFiles]; next[i] = { ...f, path: e.target.value }; upd({ importantFiles: next }); }} placeholder="path" />
            <input style={{ flex: 1 }} value={f.note} onChange={e => { const next = [...mem.importantFiles]; next[i] = { ...f, note: e.target.value }; upd({ importantFiles: next }); }} placeholder="why it matters" />
            <button onClick={() => upd({ importantFiles: mem.importantFiles.filter((_, j) => j !== i) })}>×</button>
          </div>
        ))}
        <button style={{ fontSize: 11, marginBottom: 8 }} onClick={() => upd({ importantFiles: [...mem.importantFiles, { path: '', note: '' }] })}>＋ Add file</button>

        <div className="mem-section">Known bugs</div>
        {mem.knownBugs.length === 0 && <div style={{ color: 'var(--fg-dim)', marginBottom: 6 }}>None recorded.</div>}
        {mem.knownBugs.map((b, i) => (
          <div key={b.id} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
            <input type="checkbox" checked={b.resolved} title="resolved" onChange={e => { const next = [...mem.knownBugs]; next[i] = { ...b, resolved: e.target.checked }; upd({ knownBugs: next }); }} />
            <span style={{ flex: 1, textDecoration: b.resolved ? 'line-through' : 'none', color: b.resolved ? 'var(--fg-dim)' : 'var(--fg)' }}>{b.note}</span>
            <button onClick={() => upd({ knownBugs: mem.knownBugs.filter((_, j) => j !== i) })}>×</button>
          </div>
        ))}

        <div className="mem-section">Prior fixes (agent-recorded)</div>
        {mem.priorFixes.length === 0 && <div style={{ color: 'var(--fg-dim)', marginBottom: 6 }}>None yet — the agent adds these after successful tasks.</div>}
        {mem.priorFixes.slice(0, 20).map(f => (
          <div key={f.id} style={{ marginBottom: 5, color: 'var(--fg-dim)' }}>
            <div style={{ color: 'var(--fg)' }}>{f.summary}</div>
            <div style={{ fontSize: 10.5 }}>{new Date(f.time).toLocaleString()} — {f.files.join(', ')}</div>
          </div>
        ))}
      </div>
    </>
  );
}
