import { useStore } from '../state/store';
import { Explorer } from './Explorer';
import { SearchPanel } from './SearchPanel';
import { GitPanel } from './GitPanel';
import { HistoryPanel } from './HistoryPanel';
import { MemoryPanel } from './MemoryPanel';

export function SidePanel() {
  const sidePanel = useStore(s => s.sidePanel);
  return (
    <div className="side-panel">
      {sidePanel === 'explorer' && <Explorer />}
      {sidePanel === 'search' && <SearchPanel />}
      {sidePanel === 'git' && <GitPanel />}
      {sidePanel === 'history' && <HistoryPanel />}
      {sidePanel === 'memory' && <MemoryPanel />}
    </div>
  );
}
