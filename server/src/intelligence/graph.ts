import path from 'node:path';
import type { ProjectIndex } from './projectIndex.js';

/**
 * Visual project graphs, derived entirely from the existing ProjectIndex —
 * this module adds NO new parsing or file walking, it only reshapes what the
 * index already knows (files, symbols, import edges) into node/edge graphs the
 * client can draw. Keeping it a pure read-over-index means the graph is always
 * consistent with retrieval and the project map, and stays live via the same
 * file watcher.
 */
export type GraphType = 'imports' | 'components' | 'routes' | 'hooks' | 'focus';

export type NodeKind = 'file' | 'component' | 'route' | 'hook' | 'symbol';

export interface GraphNode {
  id: string;
  label: string;
  kind: NodeKind;
  group: string;        // top-level dir, for coloring/clustering
  degree: number;       // how connected — drives node size
  file?: string;        // the file to open when a non-file node is clicked
}

export interface GraphEdge { source: string; target: string }

export interface ProjectGraph {
  type: GraphType;
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;   // true if we capped the node count for readability
  note?: string;
}

const MAX_NODES = 120;   // keep graphs readable and the layout fast

function topDir(p: string): string {
  return p.includes('/') ? p.slice(0, p.indexOf('/')) : '.';
}

/** A file's node kind, inferred from the strongest symbol it defines. */
function fileKind(index: ProjectIndex, file: string): NodeKind {
  const e = index.getFile(file);
  if (!e) return 'file';
  if (e.symbols.some(s => s.kind === 'component')) return 'component';
  if (e.symbols.some(s => s.kind === 'route')) return 'route';
  if (e.symbols.some(s => s.kind === 'hook')) return 'hook';
  return 'file';
}

/** Import/dependency graph across files (optionally only "interesting" ones). */
function buildFileGraph(index: ProjectIndex, filter?: (file: string) => boolean): ProjectGraph {
  let files = index.filePaths().filter(p => index.getFile(p));
  if (filter) files = files.filter(filter);

  // Rank by connectivity so, when we cap, we keep the structurally important files.
  const degree = (f: string) => index.importsOf(f).length + index.importedBy(f).length;
  files.sort((a, b) => degree(b) - degree(a));
  const truncated = files.length > MAX_NODES;
  const kept = new Set(files.slice(0, MAX_NODES));

  const nodes: GraphNode[] = [...kept].map(f => ({
    id: f,
    label: f.slice(f.lastIndexOf('/') + 1),
    kind: fileKind(index, f),
    group: topDir(f),
    degree: degree(f),
  }));

  const edges: GraphEdge[] = [];
  for (const f of kept) {
    for (const dep of index.importsOf(f)) {
      if (kept.has(dep)) edges.push({ source: f, target: dep });
    }
  }
  return { type: 'imports', nodes, edges, truncated };
}

/** Symbols of a given kind become nodes linked to the file that defines them. */
function buildSymbolKindGraph(index: ProjectIndex, kind: 'route' | 'hook' | 'component'): ProjectGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const fileNodes = new Set<string>();
  let count = 0;

  for (const e of index.allFiles()) {
    const matched = e.symbols.filter(s => s.kind === kind);
    if (!matched.length) continue;
    if (!fileNodes.has(e.path)) {
      fileNodes.add(e.path);
      nodes.push({ id: e.path, label: e.path.slice(e.path.lastIndexOf('/') + 1), kind: 'file', group: topDir(e.path), degree: matched.length, file: e.path });
    }
    for (const s of matched) {
      if (count >= MAX_NODES) break;
      const id = `${e.path}#${s.kind}:${s.name}`;
      nodes.push({ id, label: s.name, kind, group: topDir(e.path), degree: 1, file: e.path });
      edges.push({ source: id, target: e.path });
      count++;
    }
  }

  const type: GraphType = kind === 'route' ? 'routes' : kind === 'hook' ? 'hooks' : 'components';
  const note = nodes.length === 0
    ? `No ${kind === 'route' ? 'routes' : kind === 'hook' ? 'WordPress/PHP hooks' : 'components'} detected in this project.`
    : undefined;
  return { type, nodes, edges, truncated: count >= MAX_NODES, note };
}

/** Neighbourhood of one file: it plus everything it imports and everything importing it. */
function buildFocusGraph(index: ProjectIndex, focus: string): ProjectGraph {
  if (!index.getFile(focus)) return { type: 'focus', nodes: [], edges: [], truncated: false, note: `File not indexed: ${focus}` };
  const related = new Set<string>([focus, ...index.neighbours(focus)]);
  const g = buildFileGraph(index, (f) => related.has(f));
  return { ...g, type: 'focus' };
}

export function buildGraph(index: ProjectIndex, type: GraphType, focus?: string): ProjectGraph {
  switch (type) {
    case 'components': return buildSymbolKindGraph(index, 'component');
    case 'routes': return buildSymbolKindGraph(index, 'route');
    case 'hooks': return buildSymbolKindGraph(index, 'hook');
    case 'focus': return focus ? buildFocusGraph(index, focus) : buildFileGraph(index);
    case 'imports':
    default: return buildFileGraph(index);
  }
}

/** Which graph types actually have data for this project — drives the UI's available tabs. */
export function availableGraphs(index: ProjectIndex): GraphType[] {
  const types: GraphType[] = ['imports'];
  const has = (kind: 'component' | 'route' | 'hook') => index.allFiles().some(e => e.symbols.some(s => s.kind === kind));
  if (has('component')) types.push('components');
  if (has('route')) types.push('routes');
  if (has('hook')) types.push('hooks');
  return types;
}
