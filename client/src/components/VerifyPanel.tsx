import { useEffect, useRef, useState } from 'react';
import { apiGet, streamSSE } from '../api';
import { useStore } from '../state/store';

interface VerifyStep { id: string; label: string; command: string; args: string[] }
interface StepResult { id: string; label: string; ok: boolean; output: string; durationMs: number; timedOut: boolean }

/**
 * Manual + automatic verification (Priority 5). The agent runs this
 * automatically after edits when Settings → "Auto-verify" is on; this panel
 * is also where you trigger it by hand and watch typecheck/lint/test/build
 * run live, one step at a time, stopping at the first failure.
 */
export function VerifyPanel() {
  const [steps, setSteps] = useState<VerifyStep[]>([]);
  const [results, setResults] = useState<Record<string, StepResult>>({});
  const [order, setOrder] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [noSteps, setNoSteps] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const set = useStore(s => s.set);
  const workspace = useStore(s => s.workspace);

  useEffect(() => {
    void apiGet<{ steps: VerifyStep[] }>('/api/verify/steps').then(r => setSteps(r.steps));
  }, [workspace]);

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [results]);

  async function run() {
    setRunning(true);
    setResults({});
    setOrder([]);
    setNoSteps(null);
    set('verifyStatus', 'running');
    try {
      await streamSSE('/api/verify/run', {}, (evt) => {
        if (evt.type === 'steps') setOrder((evt.steps as VerifyStep[]).map(s => s.id));
        else if (evt.type === 'step-result') {
          const r = evt.result as StepResult;
          setResults(prev => ({ ...prev, [r.id]: r }));
        } else if (evt.type === 'done') {
          const all = (evt.results as StepResult[]) ?? [];
          const failed = all.find(r => !r.ok);
          set('verifyStatus', all.length === 0 ? 'idle' : failed ? 'fail' : 'pass');
          if (all.length === 0 && evt.reason) setNoSteps(String(evt.reason));
        }
      });
    } catch (err) {
      set('verifyStatus', 'fail');
      setNoSteps((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const icon = (id: string) => {
    const r = results[id];
    if (!r) return running ? '…' : '·';
    if (r.timedOut) return '⏱';
    return r.ok ? '✓' : '✗';
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>
        <button className="primary" disabled={running || steps.length === 0} onClick={() => void run()}>
          {running ? 'Running…' : 'Run verification'}
        </button>
        {steps.length === 0 && !noSteps && (
          <span style={{ color: 'var(--fg-dim)', fontSize: 12.5 }}>No typecheck/lint/test/build scripts detected in package.json.</span>
        )}
        <div style={{ display: 'flex', gap: 10, marginLeft: 8 }}>
          {steps.map(s => (
            <span key={s.id} style={{ fontSize: 12.5, color: results[s.id] ? (results[s.id].ok ? 'var(--accent)' : 'var(--danger)') : 'var(--fg-dim)' }}>
              {icon(s.id)} {s.label}
            </span>
          ))}
        </div>
      </div>
      <div className="output-log" ref={logRef} style={{ flex: 1, overflow: 'auto' }}>
        {noSteps && <div style={{ color: 'var(--fg-dim)' }}>{noSteps}</div>}
        {order.map(id => {
          const r = results[id];
          if (!r) return null;
          return (
            <div key={id} style={{ marginBottom: 10 }}>
              <div style={{ color: r.ok ? 'var(--accent)' : 'var(--danger)', fontWeight: 600 }}>
                {r.ok ? '✓' : r.timedOut ? '⏱ timed out' : '✗'} {r.label} ({r.durationMs}ms)
              </div>
              <pre style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{r.output || '(no output)'}</pre>
            </div>
          );
        })}
        {!noSteps && order.length === 0 && !running && (
          <div style={{ color: 'var(--fg-dim)' }}>Run verification to typecheck, lint, test, and build this project.</div>
        )}
      </div>
    </div>
  );
}
