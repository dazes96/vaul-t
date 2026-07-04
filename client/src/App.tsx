import { useEffect } from 'react';
import { useStore } from './state/store';
import { ActivityBar } from './components/ActivityBar';
import { SidePanel } from './components/SidePanel';
import { TabBar } from './components/TabBar';
import { EditorArea } from './components/EditorArea';
import { BottomPanel } from './components/BottomPanel';
import { AIPanel } from './components/AIPanel';
import { StatusBar } from './components/StatusBar';
import { CommandPalette } from './components/CommandPalette';
import { SettingsModal } from './components/SettingsModal';
import { GraphView } from './components/GraphView';

export function App() {
  const init = useStore(s => s.init);
  const saveActive = useStore(s => s.saveActive);
  const set = useStore(s => s.set);
  const paletteOpen = useStore(s => s.paletteOpen);
  const settingsOpen = useStore(s => s.settingsOpen);
  const graphOpen = useStore(s => s.graphOpen);
  const bottomVisible = useStore(s => s.bottomVisible);
  const aiVisible = useStore(s => s.aiVisible);

  useEffect(() => { void init(); }, [init]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 's') { e.preventDefault(); void saveActive(); }
      else if (mod && e.key === 'p') { e.preventDefault(); set('paletteOpen', true); }
      else if (mod && e.key === 'j') { e.preventDefault(); set('bottomVisible', !useStore.getState().bottomVisible); }
      else if (mod && e.key === 'l') { e.preventDefault(); set('aiVisible', !useStore.getState().aiVisible); }
      else if (mod && e.key === ',') { e.preventDefault(); set('settingsOpen', true); }
      else if (mod && e.shiftKey && (e.key === 'g' || e.key === 'G')) { e.preventDefault(); set('graphOpen', !useStore.getState().graphOpen); }
      else if (e.key === 'Escape') {
        // Close whichever overlay is open (graph/settings/palette), topmost-first.
        const s = useStore.getState();
        if (s.graphOpen) set('graphOpen', false);
        else if (s.settingsOpen) set('settingsOpen', false);
        else if (s.paletteOpen) set('paletteOpen', false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveActive, set]);

  return (
    <div className="app">
      <div className="app-main">
        <ActivityBar />
        <SidePanel />
        <div className="center">
          <TabBar />
          <EditorArea />
          {bottomVisible && <BottomPanel />}
        </div>
        {aiVisible && <AIPanel />}
      </div>
      <StatusBar />
      {paletteOpen && <CommandPalette />}
      {settingsOpen && <SettingsModal />}
      {graphOpen && <GraphView />}
    </div>
  );
}
