import { useStore } from '../state/store';

export function TabBar() {
  const tabs = useStore(s => s.tabs);
  const activePath = useStore(s => s.activePath);
  const setActive = useStore(s => s.setActive);
  const closeTab = useStore(s => s.closeTab);

  if (tabs.length === 0) return null;
  return (
    <div className="tab-bar">
      {tabs.map(t => {
        const dirty = t.kind === 'text' && t.content !== t.savedContent;
        const name = t.path.split('/').pop();
        return (
          <div
            key={t.path}
            className={`tab ${t.path === activePath ? 'active' : ''}`}
            onClick={() => setActive(t.path)}
            title={t.path}
          >
            {dirty && <span className="dirty">•</span>}
            <span>{name}</span>
            <span
              className="close"
              onClick={(e) => {
                e.stopPropagation();
                if (dirty && !window.confirm(`${name} has unsaved changes. Close anyway?`)) return;
                closeTab(t.path);
              }}
            >
              ×
            </span>
          </div>
        );
      })}
    </div>
  );
}
