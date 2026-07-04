import { useStore, type BottomTab } from '../state/store';
import { TerminalView } from './TerminalView';

const tabs: { id: BottomTab; label: string }[] = [
  { id: 'terminal', label: 'Terminal' },
  { id: 'output', label: 'Output' },
  { id: 'problems', label: 'Problems' },
];

export function BottomPanel() {
  const bottomTab = useStore(s => s.bottomTab);
  const set = useStore(s => s.set);
  const output = useStore(s => s.output);

  return (
    <div className="bottom-panel">
      <div className="bottom-tabs">
        {tabs.map(t => (
          <button key={t.id} className={bottomTab === t.id ? 'active' : ''} onClick={() => set('bottomTab', t.id)}>
            {t.label}
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
