import { useEffect, useMemo, useRef, useState } from 'react';
import { apiGet } from '../api';
import { useStore } from '../state/store';

type GraphType = 'imports' | 'components' | 'routes' | 'hooks' | 'focus';
interface GNode { id: string; label: string; kind: string; group: string; degree: number; file?: string }
interface GEdge { source: string; target: string }
interface Graph { type: GraphType; nodes: GNode[]; edges: GEdge[]; truncated: boolean; note?: string }

interface Positioned extends GNode { x: number; y: number }

const KIND_COLOR: Record<string, string> = {
  file: '#60a5fa', component: '#34d399', route: '#fbbf24', hook: '#f472b6', symbol: '#a78bfa',
};

const LABELS: Record<GraphType, string> = {
  imports: 'Imports', components: 'Components', routes: 'Routes', hooks: 'Hooks', focus: 'Focus',
};

/**
 * A dependency-free force-directed graph. The layout runs a fixed number of
 * simulation iterations synchronously on load (deterministic seed → stable
 * result), then renders static SVG — no animation loop to jank or leak. Simple
 * and reliable over fancy, per the brief. Nodes are draggable; wheel zooms.
 */
function layout(nodes: GNode[], edges: GEdge[], width: number, height: number): Positioned[] {
  const rng = mulberry32(42);
  const pos: Positioned[] = nodes.map((n) => ({ ...n, x: width / 2 + (rng() - 0.5) * width * 0.8, y: height / 2 + (rng() - 0.5) * height * 0.8 }));
  const byId = new Map(pos.map(p => [p.id, p]));
  const k = Math.sqrt((width * height) / Math.max(1, nodes.length)) * 0.6;

  const ITER = 260;
  for (let step = 0; step < ITER; step++) {
    const t = 1 - step / ITER;                 // cooling
    // Repulsion (O(n^2) — fine for the ≤120-node cap the server enforces).
    for (let i = 0; i < pos.length; i++) {
      let fx = 0, fy = 0;
      for (let j = 0; j < pos.length; j++) {
        if (i === j) continue;
        const dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y;
        const d2 = dx * dx + dy * dy || 0.01;
        const f = (k * k) / d2;
        fx += dx * f; fy += dy * f;
      }
      pos[i].x += Math.max(-30, Math.min(30, fx)) * t * 0.05;
      pos[i].y += Math.max(-30, Math.min(30, fy)) * t * 0.05;
    }
    // Spring attraction along edges.
    for (const e of edges) {
      const a = byId.get(e.source), b = byId.get(e.target);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const f = (d * d) / k * 0.0015 * t;
      const ox = (dx / d) * f, oy = (dy / d) * f;
      a.x += ox; a.y += oy; b.x -= ox; b.y -= oy;
    }
    // Gentle pull to center so disconnected nodes don't drift off-screen.
    for (const p of pos) { p.x += (width / 2 - p.x) * 0.005 * t; p.y += (height / 2 - p.y) * 0.005 * t; }
  }
  return pos;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function GraphView() {
  const set = useStore(s => s.set);
  const openFile = useStore(s => s.openFile);
  const [available, setAvailable] = useState<GraphType[]>(['imports']);
  const [type, setType] = useState<GraphType>('imports');
  const [graph, setGraph] = useState<Graph | null>(null);
  const [nodes, setNodes] = useState<Positioned[]>([]);
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const drag = useRef<{ id: string; ox: number; oy: number } | null>(null);
  const W = 900, H = 620;

  useEffect(() => { void apiGet<{ available: GraphType[] }>('/api/graph/available').then(r => setAvailable(r.available)); }, []);

  useEffect(() => {
    void apiGet<Graph>(`/api/graph?type=${type}`).then((g) => {
      setGraph(g);
      setNodes(layout(g.nodes, g.edges, W, H));
      setView({ scale: 1, tx: 0, ty: 0 });
    });
  }, [type]);

  const posById = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setView(v => ({ ...v, scale: Math.max(0.3, Math.min(3, v.scale * (e.deltaY < 0 ? 1.1 : 0.9))) }));
  };
  const onNodeDown = (e: React.MouseEvent, n: Positioned) => {
    e.stopPropagation();
    drag.current = { id: n.id, ox: e.clientX, oy: e.clientY };
  };
  const onMove = (e: React.MouseEvent) => {
    if (!drag.current) return;
    const dx = (e.clientX - drag.current.ox) / view.scale;
    const dy = (e.clientY - drag.current.oy) / view.scale;
    drag.current.ox = e.clientX; drag.current.oy = e.clientY;
    setNodes(ns => ns.map(n => n.id === drag.current!.id ? { ...n, x: n.x + dx, y: n.y + dy } : n));
  };
  const onUp = () => { drag.current = null; };

  const onNodeClick = (n: Positioned) => {
    const file = n.file ?? (n.kind === 'file' || n.kind === 'component' || n.kind === 'route' || n.kind === 'hook' ? n.id : undefined);
    if (file && !file.includes('#')) { void openFile(file); set('graphOpen', false); }
  };

  return (
    <div className="modal-backdrop" onClick={() => set('graphOpen', false)}>
      <div className="modal" style={{ width: 'min(1000px, 95vw)', maxWidth: 'none' }} onClick={e => e.stopPropagation()}>
        <header>
          Project Graph
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {available.map(t => (
              <button key={t} className={type === t ? 'primary' : ''} onClick={() => setType(t)}>{LABELS[t]}</button>
            ))}
            <button onClick={() => set('graphOpen', false)}>×</button>
          </span>
        </header>
        <div className="modal-body" style={{ padding: 0, position: 'relative' }}>
          {graph?.note && <div style={{ padding: 16, color: 'var(--fg-dim)' }}>{graph.note}</div>}
          {graph && graph.nodes.length > 0 && (
            <svg
              width="100%" height={H} viewBox={`0 0 ${W} ${H}`}
              onWheel={onWheel} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
              style={{ display: 'block', cursor: drag.current ? 'grabbing' : 'default', background: 'var(--bg)' }}
            >
              <g transform={`translate(${view.tx},${view.ty}) scale(${view.scale})`}>
                {graph.edges.map((e, i) => {
                  const a = posById.get(e.source), b = posById.get(e.target);
                  if (!a || !b) return null;
                  const lit = hover === e.source || hover === e.target;
                  return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={lit ? 'var(--accent)' : 'var(--border)'} strokeWidth={lit ? 1.5 : 0.7} />;
                })}
                {nodes.map(n => {
                  const rad = 4 + Math.min(10, n.degree * 1.5);
                  return (
                    <g key={n.id} transform={`translate(${n.x},${n.y})`}
                       onMouseDown={e => onNodeDown(e, n)} onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}
                       onClick={() => onNodeClick(n)} style={{ cursor: 'pointer' }}>
                      <circle r={rad} fill={KIND_COLOR[n.kind] ?? '#888'} stroke={hover === n.id ? 'var(--fg)' : 'none'} strokeWidth={1.5} />
                      {(hover === n.id || nodes.length <= 40 || n.degree >= 3) && (
                        <text x={rad + 3} y={4} fontSize={10} fill="var(--fg)" style={{ pointerEvents: 'none' }}>{n.label}</text>
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>
          )}
        </div>
        <footer style={{ justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--fg-dim)', fontSize: 12 }}>
            {graph ? `${graph.nodes.length} nodes · ${graph.edges.length} edges${graph.truncated ? ' (capped for readability)' : ''}` : ''}
            {'  ·  '}
            {Object.entries(KIND_COLOR).filter(([k]) => nodes.some(n => n.kind === k)).map(([k, c]) => (
              <span key={k} style={{ marginLeft: 8 }}><span style={{ color: c }}>●</span> {k}</span>
            ))}
          </span>
          <span style={{ color: 'var(--fg-dim)', fontSize: 12 }}>drag nodes · scroll to zoom · click to open file</span>
        </footer>
      </div>
    </div>
  );
}
