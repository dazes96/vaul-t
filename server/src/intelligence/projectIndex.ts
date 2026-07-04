import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { detectProject, languageForExt, type ProjectInfo } from './detect.js';
import { isCodeFile } from './textfiles.js';
import { extractSymbols, extractImports, type CodeSymbol } from './symbols.js';
import { walkFiles, mapPool, type WalkedFile } from './walk.js';

export interface FileEntry {
  path: string;
  size: number;
  mtimeMs: number;
  lang: string | null;
  symbols: CodeSymbol[];
  imports: string[];        // raw specifiers
  deps: string[];           // resolved workspace-relative paths this file imports
}

const MAX_SYMBOL_BYTES = 400_000;   // don't parse enormous files
const RESOLVE_EXT = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.php', '.py'];

/**
 * The living understanding of one project: every file, the symbols it defines,
 * and the import graph between files. Built once asynchronously, then patched
 * incrementally by the file watcher (add/update/remove a single file without
 * re-walking the whole tree).
 *
 * This is the shared substrate for retrieval, the project map, and the future
 * code-graph memory — everything that makes Emerald understand projects rather
 * than files reads from here.
 */
export class ProjectIndex {
  readonly root: string;
  builtAt = 0;
  private files = new Map<string, FileEntry>();
  /** lowercased symbol name -> set of file paths that define it */
  private symbolIndex = new Map<string, Set<string>>();
  /** file -> files it imports (resolved) */
  private outEdges = new Map<string, Set<string>>();
  /** file -> files that import it */
  private inEdges = new Map<string, Set<string>>();
  info: ProjectInfo = { frameworks: [], languages: {}, packageManager: null, buildTools: [], dependencies: [] };

  constructor(root: string) { this.root = root; }

  // --- Build & incremental maintenance -------------------------------------

  async build(): Promise<void> {
    const walked: WalkedFile[] = [];
    for await (const f of walkFiles(this.root)) walked.push(f);

    // Read + parse files with bounded concurrency so we never block the loop.
    const entries = await mapPool(walked, 24, (f) => this.makeEntry(f));

    this.files.clear();
    this.symbolIndex.clear();
    this.outEdges.clear();
    this.inEdges.clear();
    for (const e of entries) this.insert(e);
    this.recomputeAllEdges();
    this.info = detectProject(this.root, [...this.files.keys()]);
    this.builtAt = Date.now();
  }

  /** Add or update a single file. Called by the watcher on add/change. */
  async updateFile(relPath: string): Promise<void> {
    let st;
    try { st = await fsp.stat(path.join(this.root, relPath)); }
    catch { return this.removeFile(relPath); }
    if (!st.isFile()) return;
    const entry = await this.makeEntry({ path: relPath, size: st.size, mtimeMs: st.mtimeMs });
    this.removeFromIndexes(relPath);
    this.insert(entry);
    this.recomputeEdgesFor(relPath);
    this.builtAt = Date.now();
  }

  /** Remove a single file. Called by the watcher on unlink. */
  removeFile(relPath: string): void {
    this.removeFromIndexes(relPath);
    this.files.delete(relPath);
    this.builtAt = Date.now();
  }

  private async makeEntry(f: WalkedFile): Promise<FileEntry> {
    const lang = languageForExt(path.extname(f.path));
    let symbols: CodeSymbol[] = [];
    let imports: string[] = [];
    if (isCodeFile(f.path) && f.size <= MAX_SYMBOL_BYTES) {
      try {
        const content = await fsp.readFile(path.join(this.root, f.path), 'utf8');
        symbols = extractSymbols(f.path, content);
        imports = extractImports(f.path, content);
      } catch { /* unreadable/binary — leave empty */ }
    }
    return { path: f.path, size: f.size, mtimeMs: f.mtimeMs, lang, symbols, imports, deps: [] };
  }

  private insert(e: FileEntry): void {
    this.files.set(e.path, e);
    for (const s of e.symbols) {
      const key = s.name.toLowerCase();
      let set = this.symbolIndex.get(key);
      if (!set) this.symbolIndex.set(key, set = new Set());
      set.add(e.path);
    }
  }

  private removeFromIndexes(relPath: string): void {
    const old = this.files.get(relPath);
    if (old) {
      for (const s of old.symbols) {
        const key = s.name.toLowerCase();
        const set = this.symbolIndex.get(key);
        if (set) { set.delete(relPath); if (set.size === 0) this.symbolIndex.delete(key); }
      }
    }
    // Drop this file's outgoing edges and the reverse links they created.
    const out = this.outEdges.get(relPath);
    if (out) for (const dep of out) this.inEdges.get(dep)?.delete(relPath);
    this.outEdges.delete(relPath);
  }

  // --- Import graph ---------------------------------------------------------

  private resolveImport(fromFile: string, spec: string): string | null {
    if (!spec.startsWith('.')) return null; // bare package import — not a project file
    const baseDir = path.posix.dirname(fromFile);
    const target = path.posix.normalize(`${baseDir}/${spec}`);
    for (const ext of RESOLVE_EXT) {
      const cand = target + ext;
      if (this.files.has(cand)) return cand;
    }
    for (const ext of RESOLVE_EXT.filter(Boolean)) {
      const cand = path.posix.normalize(`${target}/index${ext}`);
      if (this.files.has(cand)) return cand;
    }
    return null;
  }

  private recomputeEdgesFor(relPath: string): void {
    const entry = this.files.get(relPath);
    if (!entry) return;
    const deps = new Set<string>();
    for (const spec of entry.imports) {
      const resolved = this.resolveImport(relPath, spec);
      if (resolved && resolved !== relPath) deps.add(resolved);
    }
    entry.deps = [...deps];
    this.outEdges.set(relPath, deps);
    for (const dep of deps) {
      let set = this.inEdges.get(dep);
      if (!set) this.inEdges.set(dep, set = new Set());
      set.add(relPath);
    }
  }

  private recomputeAllEdges(): void {
    this.inEdges.clear();
    for (const relPath of this.files.keys()) this.recomputeEdgesFor(relPath);
  }

  // --- Read API -------------------------------------------------------------

  get fileCount(): number { return this.files.size; }
  get symbolCount(): number { let n = 0; for (const e of this.files.values()) n += e.symbols.length; return n; }
  get edgeCount(): number { let n = 0; for (const s of this.outEdges.values()) n += s.size; return n; }

  allFiles(): FileEntry[] { return [...this.files.values()]; }
  getFile(relPath: string): FileEntry | undefined { return this.files.get(relPath); }
  filePaths(): string[] { return [...this.files.keys()]; }
  symbolLookup(nameLower: string): string[] { return [...(this.symbolIndex.get(nameLower) ?? [])]; }
  importsOf(relPath: string): string[] { return [...(this.outEdges.get(relPath) ?? [])]; }
  importedBy(relPath: string): string[] { return [...(this.inEdges.get(relPath) ?? [])]; }

  /** Neighbours in the dependency graph, both directions — "related files." */
  neighbours(relPath: string): string[] {
    return [...new Set([...this.importsOf(relPath), ...this.importedBy(relPath)])];
  }

  /** Compact markdown project map, given to the model as architecture memory. */
  get map(): string {
    const lines: string[] = [
      `# Project map: ${path.basename(this.root)}`,
      '',
      `- Frameworks: ${this.info.frameworks.join(', ') || 'none detected'}`,
      `- Languages: ${Object.entries(this.info.languages).sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l} (${n})`).join(', ') || 'none'}`,
      `- Package manager: ${this.info.packageManager ?? 'none detected'}`,
      `- Build tools: ${this.info.buildTools.join(', ') || 'none detected'}`,
      `- Indexed: ${this.fileCount} files, ${this.symbolCount} symbols, ${this.edgeCount} import edges`,
      '',
      '## Structure',
    ];
    const dirs = new Map<string, string[]>();
    for (const p of [...this.files.keys()].slice(0, 800)) {
      const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '.';
      (dirs.get(dir) ?? dirs.set(dir, []).get(dir)!).push(p.slice(p.lastIndexOf('/') + 1));
    }
    for (const [dir, names] of [...dirs.entries()].sort()) {
      lines.push(`- \`${dir}/\`: ${names.slice(0, 40).join(', ')}${names.length > 40 ? `, +${names.length - 40} more` : ''}`);
    }

    // Key symbols: the most import-connected files and what they define.
    const hubs = [...this.files.values()]
      .map(e => ({ e, degree: (this.inEdges.get(e.path)?.size ?? 0) }))
      .filter(x => x.e.symbols.length)
      .sort((a, b) => b.degree - a.degree)
      .slice(0, 15);
    if (hubs.length) {
      lines.push('', '## Key modules (most depended-on)');
      for (const { e, degree } of hubs) {
        const names = e.symbols.slice(0, 8).map(s => s.name).join(', ');
        lines.push(`- \`${e.path}\`${degree ? ` (imported by ${degree})` : ''}: ${names}`);
      }
    }
    return lines.join('\n');
  }
}
