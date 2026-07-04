import path from 'node:path';

export type SymbolKind =
  | 'function' | 'class' | 'interface' | 'type' | 'enum'
  | 'const' | 'component' | 'hook' | 'route' | 'method';

export interface CodeSymbol {
  name: string;
  kind: SymbolKind;
  line: number;
}

/**
 * Symbol + import extraction.
 *
 * This is deliberately regex/heuristic based rather than a full AST parser:
 * it needs zero native compilation (works the same on Windows/Linux/macOS),
 * starts instantly, and is fast enough to run on every file save. It is not
 * 100% precise, and it is not meant to be — its job is to make retrieval and
 * the project map understand "what lives where," not to type-check.
 *
 * The extractor is language-dispatched and self-contained, so swapping in a
 * tree-sitter backend later means replacing this one module.
 */
export function extractSymbols(filePath: string, content: string): CodeSymbol[] {
  const ext = path.extname(filePath).toLowerCase();
  if (['.py'].includes(ext)) return pythonSymbols(content);
  if (['.php'].includes(ext)) return phpSymbols(content);
  // JS/TS family, plus the <script> content of .vue/.svelte (treated as JS).
  return jsSymbols(content, ext === '.tsx' || ext === '.jsx' || ext === '.vue' || ext === '.svelte');
}

function push(out: CodeSymbol[], name: string | undefined, kind: SymbolKind, line: number) {
  if (name && !out.some(s => s.name === name && s.kind === kind)) out.push({ name, kind, line });
}

function jsSymbols(content: string, jsxLikely: boolean): CodeSymbol[] {
  const out: CodeSymbol[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    const n = i + 1;

    let m: RegExpMatchArray | null;
    if ((m = t.match(/^(?:export\s+)?interface\s+(\w+)/))) push(out, m[1], 'interface', n);
    else if ((m = t.match(/^(?:export\s+)?type\s+(\w+)\s*[=<]/))) push(out, m[1], 'type', n);
    else if ((m = t.match(/^(?:export\s+)?(?:const\s+)?enum\s+(\w+)/))) push(out, m[1], 'enum', n);
    else if ((m = t.match(/^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/))) push(out, m[1], 'class', n);
    else if ((m = t.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*(\w+)/))) {
      push(out, m[1], /^[A-Z]/.test(m[1]) && jsxLikely ? 'component' : 'function', n);
    } else if ((m = t.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*[=:]/))) {
      const name = m[1];
      const isFn = /=>|=\s*(?:async\s*)?(?:function|\()/.test(t);
      const kind: SymbolKind = /^[A-Z]/.test(name) && jsxLikely && isFn ? 'component' : isFn ? 'function' : 'const';
      push(out, name, kind, n);
    }

    // HTTP routes: r.get('/path'), app.post('/x'), router.use('/y')
    const route = t.match(/\b(?:app|router|r)\.(get|post|put|patch|delete|all|use)\s*\(\s*['"`]([^'"`]+)/);
    if (route) push(out, `${route[1].toUpperCase()} ${route[2]}`, 'route', n);
  }
  return out;
}

function pythonSymbols(content: string): CodeSymbol[] {
  const out: CodeSymbol[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    let m: RegExpMatchArray | null;
    if ((m = t.match(/^(?:async\s+)?def\s+(\w+)/))) push(out, m[1], lines[i].startsWith(' ') || lines[i].startsWith('\t') ? 'method' : 'function', i + 1);
    else if ((m = t.match(/^class\s+(\w+)/))) push(out, m[1], 'class', i + 1);
  }
  return out;
}

function phpSymbols(content: string): CodeSymbol[] {
  const out: CodeSymbol[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    const n = i + 1;
    let m: RegExpMatchArray | null;
    if ((m = t.match(/^(?:abstract\s+|final\s+)?class\s+(\w+)/))) push(out, m[1], 'class', n);
    else if ((m = t.match(/^interface\s+(\w+)/))) push(out, m[1], 'interface', n);
    else if ((m = t.match(/^trait\s+(\w+)/))) push(out, m[1], 'class', n);
    else if ((m = t.match(/function\s+(\w+)\s*\(/))) push(out, m[1], /^\s/.test(lines[i]) ? 'method' : 'function', n);
    // WordPress hooks
    const hook = t.match(/\b(?:add_action|add_filter|do_action|apply_filters)\s*\(\s*['"]([^'"]+)/);
    if (hook) push(out, hook[1], 'hook', n);
  }
  return out;
}

/** Raw import/require specifiers, in source order. Resolution happens in the graph. */
export function extractImports(filePath: string, content: string): string[] {
  const ext = path.extname(filePath).toLowerCase();
  const specs: string[] = [];
  const add = (re: RegExp) => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) specs.push(m[1]);
  };
  if (['.py'].includes(ext)) {
    add(/^\s*from\s+([.\w]+)\s+import/gm);
    add(/^\s*import\s+([.\w]+)/gm);
  } else if (['.php'].includes(ext)) {
    add(/\b(?:require|require_once|include|include_once)\s*\(?\s*['"]([^'"]+)['"]/g);
  } else {
    add(/\bimport\s+(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]/g);
    add(/\bexport\s+[^'"]+?\s+from\s+['"]([^'"]+)['"]/g);
    add(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
    add(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
  }
  return [...new Set(specs)];
}

/** A compact one-line-per-symbol outline, used when a file is too big to inline. */
export function renderOutline(symbols: CodeSymbol[]): string {
  return symbols.map(s => `  ${s.kind} ${s.name} :${s.line}`).join('\n');
}
