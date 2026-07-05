import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api';
import { useStore, type Settings } from '../state/store';

type ProviderCfg = Settings['providers'][number];

export function SettingsModal() {
  const settings = useStore(s => s.settings);
  const updateSettings = useStore(s => s.updateSettings);
  const set = useStore(s => s.set);
  const [providers, setProviders] = useState<ProviderCfg[]>(settings?.providers ?? []);
  const [models, setModels] = useState<Record<string, string[]>>({});
  const [pingStatus, setPingStatus] = useState<Record<string, 'checking' | 'ok' | 'fail'>>({});
  const [pingError, setPingError] = useState<Record<string, string>>({});
  const [newKey, setNewKey] = useState({ name: '', value: '' });
  const [workspaceInput, setWorkspaceInput] = useState('');

  useEffect(() => {
    if (settings) setProviders(settings.providers);
  }, [settings]);

  if (!settings) return null;

  const saveProviders = async (next: ProviderCfg[]) => {
    setProviders(next);
    // Never let activeProvider dangle: if the current active provider was
    // removed, point it at the first remaining one so AI requests don't start
    // failing with an "unknown provider" error.
    const patch: Partial<Settings> = { providers: next as Settings['providers'] };
    if (!next.some(p => p.id === settings.activeProvider)) {
      patch.activeProvider = next[0]?.id ?? '';
    }
    await updateSettings(patch);
  };

  const fetchModels = async (id: string) => {
    const res = await apiGet<{ models: string[]; error?: string }>(`/api/ai/models?providerId=${encodeURIComponent(id)}`);
    setModels(m => ({ ...m, [id]: res.models }));
    if (res.error) alert(`Could not list models: ${res.error}`);
  };

  const testConnection = async (id: string) => {
    setPingStatus(s => ({ ...s, [id]: 'checking' }));
    try {
      const res = await apiGet<{ ok: boolean; error?: string }>(`/api/ai/ping?providerId=${encodeURIComponent(id)}`);
      setPingStatus(s => ({ ...s, [id]: res.ok ? 'ok' : 'fail' }));
      setPingError(e => ({ ...e, [id]: res.error ?? '' }));
    } catch (err) {
      setPingStatus(s => ({ ...s, [id]: 'fail' }));
      setPingError(e => ({ ...e, [id]: (err as Error).message }));
    }
  };

  const addProvider = () => {
    const id = window.prompt('Provider name (e.g. "openrouter", "my-anthropic"):');
    if (!id) return;
    void saveProviders([...providers, { id, kind: 'openai-compatible', baseUrl: 'http://localhost:1234/v1', model: '' }]);
  };

  const switchWorkspace = async () => {
    if (!workspaceInput.trim()) return;
    await apiPost('/api/workspace', { path: workspaceInput.trim() });
    location.reload();
  };

  return (
    <div className="modal-backdrop" onClick={() => set('settingsOpen', false)}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <header>
          Settings
          <button onClick={() => set('settingsOpen', false)}>×</button>
        </header>
        <div className="modal-body">
          <h4 style={{ marginTop: 0 }}>AI model</h4>
          <div className="form-inline">
            <label>Active provider</label>
            <select
              value={settings.activeProvider}
              onChange={e => void updateSettings({ activeProvider: e.target.value })}
            >
              {providers.map(p => <option key={p.id} value={p.id}>{p.id}</option>)}
            </select>
            <button onClick={addProvider}>＋ Add provider</button>
          </div>

          {providers.map((p, i) => (
            <details key={p.id} style={{ marginBottom: 8, border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px' }}>
              <summary style={{ cursor: 'pointer' }}>
                <b>{p.id}</b> <span className="badge">{p.kind}</span> {p.model && <code style={{ fontSize: 11 }}>{p.model}</code>}
                {pingStatus[p.id] && (
                  <span style={{ marginLeft: 8, color: pingStatus[p.id] === 'ok' ? 'var(--accent)' : pingStatus[p.id] === 'fail' ? 'var(--danger)' : 'var(--fg-dim)' }}>
                    {pingStatus[p.id] === 'checking' ? '● checking…' : pingStatus[p.id] === 'ok' ? '● connected' : '● unreachable'}
                  </span>
                )}
              </summary>
              <div style={{ paddingTop: 8 }}>
                <div className="form-inline">
                  <button onClick={() => void testConnection(p.id)}>Test connection</button>
                  {pingStatus[p.id] === 'fail' && pingError[p.id] && <span style={{ color: 'var(--danger)', fontSize: 11.5 }}>{pingError[p.id]}</span>}
                </div>
                <div className="form-row">
                  <label>Kind</label>
                  <select value={p.kind} onChange={e => void saveProviders(providers.map((q, j) => j === i ? { ...q, kind: e.target.value } : q))}>
                    <option value="ollama">Ollama (native API)</option>
                    <option value="openai-compatible">OpenAI-compatible (LM Studio, llama.cpp, vLLM, OpenRouter, OpenAI)</option>
                    <option value="anthropic">Anthropic-compatible</option>
                    <option value="gemini">Google Gemini-compatible</option>
                  </select>
                </div>
                <div className="form-row">
                  <label>Base URL</label>
                  <input value={p.baseUrl} onChange={e => void saveProviders(providers.map((q, j) => j === i ? { ...q, baseUrl: e.target.value } : q))} />
                </div>
                <div className="form-row">
                  <label>Model <button style={{ fontSize: 11 }} onClick={() => void fetchModels(p.id)}>List available</button></label>
                  {models[p.id]?.length ? (
                    <select value={p.model} onChange={e => void saveProviders(providers.map((q, j) => j === i ? { ...q, model: e.target.value } : q))}>
                      {!models[p.id].includes(p.model) && <option value={p.model}>{p.model}</option>}
                      {models[p.id].map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  ) : (
                    <input value={p.model} onChange={e => void saveProviders(providers.map((q, j) => j === i ? { ...q, model: e.target.value } : q))} />
                  )}
                </div>
                <div className="form-row">
                  <label>API key reference (name of a stored secret; leave blank for local servers)</label>
                  <input value={p.apiKeyRef ?? ''} onChange={e => void saveProviders(providers.map((q, j) => j === i ? { ...q, apiKeyRef: e.target.value || undefined } : q))} />
                </div>
                <button className="danger" onClick={() => void saveProviders(providers.filter((_, j) => j !== i))}>Remove provider</button>
              </div>
            </details>
          ))}

          <h4>API keys (stored encrypted, never in plain text)</h4>
          <div className="form-inline">
            <input placeholder="Key name (e.g. openrouter)" value={newKey.name} onChange={e => setNewKey(k => ({ ...k, name: e.target.value }))} />
            <input placeholder="Key value" type="password" value={newKey.value} onChange={e => setNewKey(k => ({ ...k, value: e.target.value }))} />
            <button
              className="primary"
              onClick={async () => {
                await apiPost('/api/settings/secret', newKey);
                setNewKey({ name: '', value: '' });
                alert('Saved. Reference it from a provider\'s "API key reference" field.');
              }}
            >
              Save key
            </button>
          </div>

          <h4>Behavior</h4>
          <div className="form-inline">
            <input type="checkbox" id="beg" checked={settings.beginnerMode} onChange={e => void updateSettings({ beginnerMode: e.target.checked })} />
            <label htmlFor="beg">Beginner mode — the AI explains everything in plain language for non-programmers</label>
          </div>
          <div className="form-inline">
            <input type="checkbox" id="ac" checked={settings.autocomplete} onChange={e => void updateSettings({ autocomplete: e.target.checked })} />
            <label htmlFor="ac">Inline AI autocomplete while typing</label>
          </div>
          <div className="form-inline">
            <label>Agent max steps per run (yours to raise as high as you like)</label>
            <input
              type="number" min={1} style={{ width: 90 }}
              value={settings.agentMaxSteps}
              onChange={e => void updateSettings({ agentMaxSteps: Number(e.target.value) || 50 })}
            />
          </div>

          <h4>Self-healing verification</h4>
          <div className="form-inline">
            <input type="checkbox" id="av" checked={settings.autoVerify} onChange={e => void updateSettings({ autoVerify: e.target.checked })} />
            <label htmlFor="av">After the agent edits files, automatically run typecheck/lint/test/build and ask it to fix failures</label>
          </div>
          <div className="form-inline">
            <label>Max auto-fix attempts before giving up and asking you</label>
            <input
              type="number" min={0} max={10} style={{ width: 70 }}
              value={settings.autoHealAttempts}
              onChange={e => void updateSettings({ autoHealAttempts: Number(e.target.value) || 0 })}
            />
          </div>

          <h4>Confirmation prompts</h4>
          {(Object.entries({
            fileDelete: 'Before deleting files or folders',
            terminalExec: 'Before the agent runs terminal commands',
            gitReset: 'Before git reset',
            dependencyInstall: 'Before installing dependencies',
          }) as [keyof Settings['approvals'], string][]).map(([key, label]) => (
            <div className="form-inline" key={key}>
              <input
                type="checkbox" id={key}
                checked={settings.approvals[key]}
                onChange={e => void updateSettings({ approvals: { ...settings.approvals, [key]: e.target.checked } })}
              />
              <label htmlFor={key}>{label}</label>
            </div>
          ))}

          <h4>Workspace</h4>
          <div className="form-inline">
            <input style={{ flex: 1 }} placeholder="Absolute path to a project folder…" value={workspaceInput} onChange={e => setWorkspaceInput(e.target.value)} />
            <button className="primary" onClick={() => void switchWorkspace()}>Open</button>
          </div>
        </div>
      </div>
    </div>
  );
}
