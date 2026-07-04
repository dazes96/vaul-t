import { useState } from 'react';
import { apiGet, apiPost } from '../api';
import { useStore } from '../state/store';

interface Result { path: string; line: number; text: string }

export function SearchPanel() {
  const [query, setQuery] = useState('');
  const [replaceWith, setReplaceWith] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [searched, setSearched] = useState(false);
  const openFile = useStore(s => s.openFile);

  const search = async () => {
    if (!query) return;
    const res = await apiGet<{ results: Result[] }>(`/api/search?q=${encodeURIComponent(query)}`);
    setResults(res.results);
    setSearched(true);
  };

  const replaceAll = async () => {
    const files = [...new Set(results.map(r => r.path))];
    if (!files.length) return;
    if (!window.confirm(`Replace "${query}" with "${replaceWith}" in ${files.length} file(s)?`)) return;
    await apiPost('/api/search/replace', { find: query, replace: replaceWith, files });
    await search();
  };

  return (
    <>
      <h3>Search</h3>
      <div className="panel-body" style={{ padding: '0 10px' }}>
        <input
          style={{ width: '100%', marginBottom: 6 }}
          placeholder="Search in files… (Enter)"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && void search()}
        />
        <input
          style={{ width: '100%', marginBottom: 6 }}
          placeholder="Replace with…"
          value={replaceWith}
          onChange={e => setReplaceWith(e.target.value)}
        />
        {results.length > 0 && (
          <button onClick={() => void replaceAll()} style={{ marginBottom: 8 }}>
            Replace all ({results.length} matches)
          </button>
        )}
        {searched && results.length === 0 && <div style={{ color: 'var(--fg-dim)' }}>No matches.</div>}
        {results.map((r, i) => (
          <div key={i} className="search-result" onClick={() => void openFile(r.path)}>
            <div className="loc">{r.path}:{r.line}</div>
            <div className="text">{r.text}</div>
          </div>
        ))}
      </div>
    </>
  );
}
