import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '../api';
import { useStore } from '../state/store';

interface DetectedTask { name: string; command: string; args: string[] }
interface TaskInfo {
  id: string; name: string; command: string; args: string[]; cwd: string;
  status: 'running' | 'stopped' | 'exited'; pid?: number; exitCode: number | null; startedAt: number;
}

/**
 * Long-running tasks (dev servers, watch builds) as first-class, trackable
 * processes (Priority 7) — distinct from the interactive terminal. Every
 * task is killed cleanly on stop and on server shutdown; see server/src/tasks.ts.
 */
export function TasksPanel() {
  const [detected, setDetected] = useState<DetectedTask[]>([]);
  const [running, setRunning] = useState<TaskInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [log, setLog] = useState('');
  const esRef = useRef<EventSource | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const workspace = useStore(s => s.workspace);
  const set = useStore(s => s.set);

  const refresh = () => void apiGet<{ detected: DetectedTask[]; running: TaskInfo[] }>('/api/tasks').then(r => {
    setDetected(r.detected);
    setRunning(r.running);
    set('runningTaskCount', r.running.filter(t => t.status === 'running').length);
  });

  useEffect(() => { refresh(); const id = setInterval(refresh, 3000); return () => clearInterval(id); }, [workspace]);

  useEffect(() => {
    esRef.current?.close();
    setLog('');
    if (!selected) return;
    const es = new EventSource(`/api/tasks/${selected}/stream`);
    es.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'backlog') setLog(msg.log);
      else if (msg.type === 'chunk') setLog(l => l + msg.chunk);
    };
    esRef.current = es;
    return () => es.close();
  }, [selected]);

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [log]);

  const start = async (t: DetectedTask) => {
    const info = await apiPost<TaskInfo>('/api/tasks/start', { name: t.name });
    refresh();
    setSelected(info.id);
  };
  const stop = async (id: string) => { await apiPost(`/api/tasks/${id}/stop`, {}); refresh(); };
  const restart = async (id: string) => { const info = await apiPost<TaskInfo>(`/api/tasks/${id}/restart`, {}); refresh(); setSelected(info.id); };
  const dismiss = async (id: string) => { await apiPost(`/api/tasks/${id}/remove`, {}); if (selected === id) setSelected(null); refresh(); };

  const selectedTask = running.find(t => t.id === selected);

  return (
    <div style={{ height: '100%', display: 'flex' }}>
      <div style={{ width: 220, borderRight: '1px solid var(--border)', overflow: 'auto', padding: 6 }}>
        <div style={{ fontSize: 11, color: 'var(--fg-dim)', textTransform: 'uppercase', padding: '4px 6px' }}>package.json scripts</div>
        {detected.length === 0 && <div style={{ padding: 6, color: 'var(--fg-dim)', fontSize: 12.5 }}>No scripts found.</div>}
        {detected.map(t => (
          <div key={t.name} className="tree-item" onClick={() => void start(t)} title={`${t.command} ${t.args.join(' ')}`}>
            <span className="icon">▶</span><span>{t.name}</span>
          </div>
        ))}
        <div style={{ fontSize: 11, color: 'var(--fg-dim)', textTransform: 'uppercase', padding: '10px 6px 4px' }}>Tasks</div>
        {running.length === 0 && <div style={{ padding: 6, color: 'var(--fg-dim)', fontSize: 12.5 }}>Nothing running.</div>}
        {running.map(t => (
          <div key={t.id} className={`tree-item ${selected === t.id ? 'active' : ''}`} onClick={() => setSelected(t.id)} title={`${t.command} ${t.args.join(' ')}${t.status === 'exited' ? ` — exit ${t.exitCode}` : ''}`}>
            <span className="icon" style={{ color: t.status === 'running' ? 'var(--accent)' : t.exitCode === 0 ? 'var(--fg-dim)' : 'var(--danger)' }}>●</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</span>
            {t.status !== 'running' && (
              <span
                className="close"
                title="Dismiss"
                onClick={(e) => { e.stopPropagation(); void dismiss(t.id); }}
              >×</span>
            )}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {selectedTask && (
          <div style={{ display: 'flex', gap: 6, padding: '6px 10px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
            {selectedTask.status === 'running'
              ? <button onClick={() => void stop(selectedTask.id)}>Stop</button>
              : <span style={{ color: selectedTask.exitCode === 0 ? 'var(--fg-dim)' : 'var(--danger)', fontSize: 12 }}>
                  {selectedTask.status === 'stopped' ? 'Stopped' : `Exited (code ${selectedTask.exitCode})`}
                </span>}
            <button onClick={() => void restart(selectedTask.id)}>Restart</button>
          </div>
        )}
        <div className="output-log" ref={logRef} style={{ flex: 1, overflow: 'auto' }}>
          {selected ? (log || '(no output yet)') : 'Select a running task, or start one from the list on the left.'}
        </div>
      </div>
    </div>
  );
}
