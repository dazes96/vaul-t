import { useEffect, useMemo, useRef, useState } from 'react';
import { apiGet } from '../api';
import { useStore } from '../state/store';

interface Item {
  label: string;
  detail?: string;
  run(): void;
}

/**
 * Ctrl+P palette: type to jump to any file, or type ">" for commands.
 * Plugins contribute commands via the server /api/plugins registry.
 */
export function CommandPalette() {
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const set = useStore(s => s.set);
  const openFile = useStore(s => s.openFile);
  const updateSettings = useStore(s => s.updateSettings);
  const settings = useStore(s => s.settings);

  useEffect(() => {
    inputRef.current?.focus();
    // Flat file list straight from the index — no fragile map-markdown parsing.
    void apiGet<string[]>('/api/index/files').then(setFiles).catch(() => setFiles([]));
  }, []);

  const close = () => set('paletteOpen', false);

  const commands: Item[] = useMemo(() => [
    { label: '> Toggle theme', run: () => void updateSettings({ theme: settings?.theme === 'light' ? 'dark' : 'light' }) },
    { label: '> Toggle beginner mode', run: () => void updateSettings({ beginnerMode: !settings?.beginnerMode }) },
    { label: '> Toggle autocomplete', run: () => void updateSettings({ autocomplete: !settings?.autocomplete }) },
    { label: '> Open settings', run: () => set('settingsOpen', true) },
    { label: '> Toggle terminal panel', run: () => set('bottomVisible', !useStore.getState().bottomVisible) },
    { label: '> Toggle AI panel', run: () => set('aiVisible', !useStore.getState().aiVisible) },
    { label: '> Run verification (typecheck/lint/test/build)', run: () => { set('bottomVisible', true); set('bottomTab', 'verify'); } },
    { label: '> Open Tasks panel', run: () => { set('bottomVisible', true); set('bottomTab', 'tasks'); } },
    { label: '> Open Change History / Checkpoints', run: () => set('sidePanel', 'history') },
    { label: '> Open Project Memory', run: () => set('sidePanel', 'memory') },
    { label: '> Show Project Graph', run: () => set('graphOpen', true) },
    { label: '> Toggle auto-verify after agent edits', run: () => void updateSettings({ autoVerify: !settings?.autoVerify }) },
  ], [settings, set, updateSettings]);

  const items: Item[] = useMemo(() => {
    const q = query.toLowerCase();
    if (q.startsWith('>')) {
      return commands.filter(c => c.label.toLowerCase().includes(q.slice(1).trim()));
    }
    return files
      .filter(f => f.toLowerCase().includes(q))
      .slice(0, 30)
      .map(f => ({ label: f.split('/').pop() ?? f, detail: f, run: () => void openFile(f) }));
  }, [query, files, commands, openFile]);

  useEffect(() => setSelected(0), [query]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') setSelected(s => Math.min(s + 1, items.length - 1));
    else if (e.key === 'ArrowUp') setSelected(s => Math.max(s - 1, 0));
    else if (e.key === 'Enter' && items[selected]) { items[selected].run(); close(); }
  };

  return (
    <div className="palette-backdrop" onClick={close}>
      <div className="palette" onClick={e => e.stopPropagation()}>
        <input
          ref={inputRef}
          placeholder="Type a file name, or > for commands…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="results">
          {items.map((it, i) => (
            <div
              key={it.detail ?? it.label}
              className={`result ${i === selected ? 'selected' : ''}`}
              onClick={() => { it.run(); close(); }}
            >
              <span>{it.label}</span>
              {it.detail && <span className="dim">{it.detail}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
