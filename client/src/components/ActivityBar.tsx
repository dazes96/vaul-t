import { useStore, type SidePanel } from '../state/store';

const items: { id: SidePanel; icon: string; title: string }[] = [
  { id: 'explorer', icon: '📁', title: 'Explorer' },
  { id: 'search', icon: '🔍', title: 'Search' },
  { id: 'git', icon: '⎇', title: 'Git' },
  { id: 'history', icon: '↩', title: 'Change History' },
];

export function ActivityBar() {
  const sidePanel = useStore(s => s.sidePanel);
  const set = useStore(s => s.set);

  return (
    <div className="activity-bar">
      {items.map(it => (
        <button
          key={it.id}
          title={it.title}
          className={sidePanel === it.id ? 'active' : ''}
          onClick={() => set('sidePanel', it.id)}
        >
          {it.icon}
        </button>
      ))}
      <div className="spacer" />
      <button title="AI Assistant (Ctrl+L)" onClick={() => set('aiVisible', !useStore.getState().aiVisible)}>✦</button>
      <button title="Settings (Ctrl+,)" onClick={() => set('settingsOpen', true)}>⚙</button>
    </div>
  );
}
