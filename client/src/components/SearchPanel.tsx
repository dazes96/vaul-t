import { useState } from 'react';
import { apiGet, apiPost } from '../api';
import { useStore } from '../state/store';

interface TextResult { path: string; line: number; text: string }
interface SmartResult { path: string; reason: string; score: number; symbols: string[] }

export function SearchPanel() {
  const [mode, setMode] = useState<'text' | 'smart'>('text');
  const [query, setQuery] = useState('');
  const [replaceWith, setReplaceWith] = useState('');
  const [textResults, setTextResults] = useState<TextResult[]>([]);
  const [smartResults, setSmartResults] = useState<SmartResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const openFile = useStore(s => s.openFile);

  const search = async () => {
    if (!query.trim()) return;
    setBusy(true);
    try {
      if (mode === 'text') {
        const res = await apiGet<{ results: TextResult[] }>(`/api/search?q=${encodeURIComponent(query)}`);
        setTextResults(res.results);
      } else {
        const res = await apiGet<{ results: SmartResult[] }>(`/api/search/smart?q=${encodeURIComponent(query)}`);
        setSmartResults(res.results);
      }
      setSearched(true);
    } finally {
      setBusy(false);
    }
  };

  const replaceAll = async () => {
    const files = [...new Set(textResults.map(r => r.path))];
    if (!files.length) return;
    if (!window.confirm(`Replace "${query}" with "${replaceWith}" in ${files.length} file(s)?`)) return;
    await apiPost('/api/search/replace', { find: query, replace: replaceWith, files });
    await search();
  };

  const results = mode === 'text' ? textResults : smartResults;

  return (
    <>
      <h3>Search</h3>
      <div className="panel-body" style={{ padding: '0 10px' }}>
        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
          <button className={mode === 'text' ? 'primary' : ''} style={{ flex: 1, fontSize: 12 }} onClick={() => { setMode('text'); setSearched(false); }}>Text</button>
          <button className={mode === 'smart' ? 'primary' : ''} style={{ flex: 1, fontSize: 12 }} onClick={() => { setMode('smart'); setSearched(false); }} title="Natural-language search ranked across symbols, paths, content, import graph, and recent edits">Smart</button>
        </div>
        <input
          style={{ width: '100%', marginBottom: 6 }}
          placeholder={mode === 'text' ? 'Exact text in files… (Enter)' : 'Describe what you\'re looking for… (Enter)'}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && void search()}
        />
        {mode === 'text' && (
          <input
            style={{ width: '100%', marginBottom: 6 }}
            placeholder="Replace with…"
            value={replaceWith}
            onChange={e => setReplaceWith(e.target.value)}
          />
        )}
        {mode === 'text' && textResults.length > 0 && (
          <button onClick={() => void replaceAll()} style={{ marginBottom: 8 }}>
            Replace all ({textResults.length} matches)
          </button>
        )}
        {busy && <div style={{ color: 'var(--fg-dim)' }}>Searching…</div>}
        {!busy && searched && results.length === 0 && <div style={{ color: 'var(--fg-dim)' }}>No matches.</div>}

        {mode === 'text' && textResults.map((r, i) => (
          <div key={i} className="search-result" onClick={() => void openFile(r.path)}>
            <div className="loc">{r.path}:{r.line}</div>
            <div className="text">{r.text}</div>
          </div>
        ))}

        {mode === 'smart' && smartResults.map((r, i) => (
          <div key={i} className="search-result" onClick={() => void openFile(r.path)} title={r.path}>
            <div className="loc">{r.path}</div>
            <div className="text">
              {r.reason}{r.symbols.length ? ` · ${r.symbols.join(', ')}` : ''}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
