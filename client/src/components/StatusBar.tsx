import { useEffect, useState } from 'react';
import { apiGet } from '../api';
import { useStore } from '../state/store';

export function StatusBar() {
  const workspace = useStore(s => s.workspace);
  const settings = useStore(s => s.settings);
  const activePath = useStore(s => s.activePath);
  const set = useStore(s => s.set);
  const updateSettings = useStore(s => s.updateSettings);
  const verifyStatus = useStore(s => s.verifyStatus);
  const runningTaskCount = useStore(s => s.runningTaskCount);
  const statusMessage = useStore(s => s.statusMessage);
  const treeVersion = useStore(s => s.treeVersion);
  const [branch, setBranch] = useState('');
  const [indexStats, setIndexStats] = useState<{ fileCount: number; symbolCount: number } | null>(null);

  useEffect(() => {
    void apiGet<{ isRepo: boolean; branch?: string }>('/api/git/status')
      .then(s => setBranch(s.isRepo ? s.branch ?? '' : ''))
      .catch(() => setBranch(''));
  }, [workspace]);

  useEffect(() => {
    void apiGet<{ fileCount: number; symbolCount: number }>('/api/index')
      .then(setIndexStats)
      .catch(() => setIndexStats(null));
  }, [workspace, treeVersion]);

  const provider = settings?.providers.find(p => p.id === settings.activeProvider);

  return (
    <div className="status-bar">
      <span title={workspace}>📂 {workspace.split(/[\\/]/).pop()}</span>
      {branch && <span>⎇ {branch}</span>}
      {indexStats && (
        <span title={`${indexStats.fileCount} files, ${indexStats.symbolCount} symbols indexed — kept live by a background watcher`}>
          🧠 {indexStats.fileCount} files
        </span>
      )}
      {statusMessage && (
        <span style={{ color: statusMessage.kind === 'error' ? 'var(--danger)' : 'var(--accent)', fontWeight: 500 }}>
          {statusMessage.kind === 'error' ? '⚠ ' : ''}{statusMessage.text}
        </span>
      )}
      <span className="grow" />
      {activePath && <span>{activePath}</span>}
      {runningTaskCount > 0 && (
        <button title="Running tasks" onClick={() => { set('bottomVisible', true); set('bottomTab', 'tasks'); }}>
          ▶ {runningTaskCount} task{runningTaskCount === 1 ? '' : 's'}
        </button>
      )}
      {verifyStatus !== 'idle' && (
        <button title="Verification status — click to open" onClick={() => { set('bottomVisible', true); set('bottomTab', 'verify'); }}
          style={{ color: verifyStatus === 'running' ? 'var(--fg-dim)' : verifyStatus === 'pass' ? 'var(--accent)' : 'var(--danger)' }}>
          {verifyStatus === 'running' ? '⋯ verifying' : verifyStatus === 'pass' ? '✓ verified' : '✗ verify failed'}
        </button>
      )}
      <button
        title="Beginner mode: plain-language explanations for non-programmers"
        onClick={() => void updateSettings({ beginnerMode: !settings?.beginnerMode })}
      >
        {settings?.beginnerMode ? '🎓 Beginner mode ON' : '🎓 Beginner mode off'}
      </button>
      <button title="Active AI model — click to change in Settings" onClick={() => set('settingsOpen', true)}>
        ✦ {provider ? `${provider.id} · ${provider.model}` : 'no model'}
      </button>
      <button
        title="Toggle theme"
        onClick={() => void updateSettings({ theme: settings?.theme === 'light' ? 'dark' : 'light' })}
      >
        {settings?.theme === 'light' ? '☀' : '☾'}
      </button>
    </div>
  );
}
