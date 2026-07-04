import { useStore, type BottomTab } from '../state/store';
import { TerminalView } from './TerminalView';
import { VerifyPanel } from './VerifyPanel';
import { TasksPanel } from './TasksPanel';

const tabs: { id: BottomTab; label: string }[] = [
  { id: 'terminal', label: 'Terminal' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'verify', label: 'Verify' },
  { id: 'output', label: 'Output' },
  { id: 'problems', label: 'Problems' },
];

export function BottomPanel() {
  const bottomTab = useStore(s => s.bottomTab);
  const set = useStore(s => s.set);
  const output = useStore(s => s.output);
  const verifyStatus = useStore(s => s.verifyStatus);
  const runningTaskCount = useStore(s => s.runningTaskCount);

  return (
    <div className="bottom-panel">
      <div className="bottom-tabs">
        {tabs.map(t => (
          <button key={t.id} className={bottomTab === t.id ? 'active' : ''} onClick={() => set('bottomTab', t.id)}>
            {t.label}
            {t.id === 'tasks' && runningTaskCount > 0 && <span className="badge" style={{ marginLeft: 6 }}>{runningTaskCount}</span>}
            {t.id === 'verify' && verifyStatus !== 'idle' && (
              <span style={{ marginLeft: 6, color: verifyStatus === 'running' ? 'var(--fg-dim)' : verifyStatus === 'pass' ? 'var(--accent)' : 'var(--danger)' }}>
                {verifyStatus === 'running' ? '…' : verifyStatus === 'pass' ? '✓' : '✗'}
              </span>
            )}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button title="Hide panel (Ctrl+J)" onClick={() => set('bottomVisible', false)}>▾</button>
      </div>
      <div className="bottom-body">
        {/* Terminal stays mounted so the shell session survives tab switches */}
        <div style={{ height: '100%', display: bottomTab === 'terminal' ? 'block' : 'none' }}>
          <TerminalView />
        </div>
        {bottomTab === 'tasks' && <TasksPanel />}
        {bottomTab === 'verify' && <VerifyPanel />}
        {bottomTab === 'output' && (
          <div className="output-log">{output.length ? output.join('\n') : 'Git, history, and agent events appear here.'}</div>
        )}
        {bottomTab === 'problems' && (
          <div className="output-log" style={{ color: 'var(--fg-dim)' }}>
            Problems reported by the editor's language services appear inline as squiggles.
            Run builds or linters in the Terminal to check the whole project.
          </div>
        )}
      </div>
    </div>
  );
}
