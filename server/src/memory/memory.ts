import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { dataDir } from '../util/paths.js';
import { writeFileAtomic } from '../util/atomic.js';

/**
 * Local, per-project memory — the IDE's long-term understanding of ONE
 * project. It is a plain JSON file under the data dir, keyed by a hash of the
 * workspace path, so it is:
 *   - local-only (never leaves your machine)
 *   - inspectable and editable (it's just JSON, and the Memory panel edits it)
 *   - project-specific (one file per workspace)
 *   - safe to reset (delete the file / hit Reset)
 *
 * Crucially, memory is never dumped wholesale into a prompt: `memoryContext()`
 * filters the per-item lists by relevance to the current query/task before
 * anything is sent to a model (see the relevance note there).
 */
export interface ImportantFile { path: string; note: string }
export interface KnownBug { id: string; note: string; resolved: boolean; time: number }
export interface PriorFix { id: string; time: number; summary: string; files: string[] }
export interface Decision { id: string; time: number; note: string }

export interface ProjectMemory {
  workspace: string;
  updatedAt: number;
  architecture: string;            // free-text, user- and agent-editable
  conventions: string[];           // e.g. "prefer named exports", "2-space indent"
  preferences: string[];           // how the user likes to work
  importantFiles: ImportantFile[];
  knownBugs: KnownBug[];
  priorFixes: PriorFix[];
  decisions: Decision[];
  detected: { frameworks: string[]; languages: string[]; packageManager: string | null };
}

function emptyMemory(workspace: string): ProjectMemory {
  return {
    workspace,
    updatedAt: Date.now(),
    architecture: '',
    conventions: [],
    preferences: [],
    importantFiles: [],
    knownBugs: [],
    priorFixes: [],
    decisions: [],
    detected: { frameworks: [], languages: [], packageManager: null },
  };
}

function memoryDir(): string {
  const d = path.join(dataDir(), 'memory');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function memoryFile(workspace: string): string {
  const key = crypto.createHash('sha1').update(path.resolve(workspace)).digest('hex').slice(0, 16);
  return path.join(memoryDir(), `${key}.json`);
}

export function loadMemory(workspace: string): ProjectMemory {
  try {
    const raw = JSON.parse(fs.readFileSync(memoryFile(workspace), 'utf8'));
    return { ...emptyMemory(workspace), ...raw, detected: { ...emptyMemory(workspace).detected, ...raw.detected } };
  } catch {
    return emptyMemory(workspace);
  }
}

export function saveMemory(mem: ProjectMemory): void {
  mem.updatedAt = Date.now();
  writeFileAtomic(memoryFile(mem.workspace), JSON.stringify(mem, null, 2));
}

export function resetMemory(workspace: string): void {
  try { fs.unlinkSync(memoryFile(workspace)); } catch { /* nothing to reset */ }
}

/** Merge a partial edit (from the Memory panel) into the stored memory. */
export function patchMemory(workspace: string, patch: Partial<ProjectMemory>): ProjectMemory {
  const mem = loadMemory(workspace);
  const merged: ProjectMemory = { ...mem, ...patch, workspace };
  saveMemory(merged);
  return merged;
}

/** Keep the detection snapshot fresh from the live index (called opportunistically). */
export function refreshDetected(workspace: string, detected: ProjectMemory['detected']): void {
  const mem = loadMemory(workspace);
  const same = JSON.stringify(mem.detected) === JSON.stringify(detected);
  if (same) return;
  mem.detected = detected;
  saveMemory(mem);
}

const genId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Record what an agent run learned, so the next task benefits. Called after a
 * run that changed files. A resolved verification failure is captured as a
 * prior fix (and, when it was a genuine bug the agent healed, a resolved
 * known-bug note) so "self-healing results are saved into memory when useful."
 */
export function recordAgentRun(workspace: string, run: { task: string; files: string[]; verifyOk: boolean | null; healedLabel?: string }): void {
  if (run.files.length === 0) return;
  const mem = loadMemory(workspace);
  const summary = run.verifyOk === true ? run.task : run.verifyOk === false ? `${run.task} (left verification failing)` : run.task;
  mem.priorFixes.unshift({ id: genId(), time: Date.now(), summary, files: run.files });
  mem.priorFixes = mem.priorFixes.slice(0, 100);
  if (run.healedLabel && run.verifyOk === true) {
    mem.knownBugs.unshift({ id: genId(), note: `Auto-healed a ${run.healedLabel} failure while: ${run.task}`, resolved: true, time: Date.now() });
    mem.knownBugs = mem.knownBugs.slice(0, 100);
  }
  saveMemory(mem);
}

// Common words carry no relevance signal — without dropping them, any two
// sentences sharing "the"/"and"/etc. would spuriously "match", defeating the
// point of relevance filtering (a memory about a login form would surface for
// a question about button colors just because both contain "the").
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'has', 'have',
  'but', 'not', 'you', 'your', 'its', 'into', 'out', 'get', 'set', 'use', 'using',
  'add', 'new', 'can', 'will', 'should', 'would', 'change', 'update', 'updated',
  'fix', 'fixed', 'make', 'made', 'want', 'need', 'when', 'what', 'where', 'how',
  'why', 'who', 'all', 'any', 'some', 'more', 'less', 'off', 'wrong', 'now',
]);

function tokenize(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2 && !STOPWORDS.has(t)));
}

function overlaps(a: Set<string>, text: string): boolean {
  const b = tokenize(text);
  for (const t of a) if (b.has(t)) return true;
  return false;
}

/**
 * Build the memory block to inject into a plan/chat prompt, filtered by
 * relevance to the query and any files the task is touching.
 *
 * Relevance policy: architecture, conventions, and preferences are global
 * guidance ("how this project is built / how I like to work") and are small,
 * so they are always included when set — that is the whole point of memory.
 * The unbounded, potentially-large lists (important files, known bugs, prior
 * fixes, decisions) are ALWAYS relevance-filtered: an item is included only if
 * its text overlaps the query, or (for files/fixes) it involves a file the
 * task is touching. Nothing from those lists is ever sent blindly.
 */
export function memoryContext(mem: ProjectMemory, query: string, touchedFiles: string[] = []): string {
  const q = tokenize(query);
  const touched = new Set(touchedFiles);
  const lines: string[] = [];

  if (mem.architecture.trim()) lines.push(`Architecture: ${mem.architecture.trim()}`);
  if (mem.conventions.length) lines.push(`Conventions: ${mem.conventions.join('; ')}`);
  if (mem.preferences.length) lines.push(`User preferences: ${mem.preferences.join('; ')}`);

  const files = mem.importantFiles.filter(f => touched.has(f.path) || overlaps(q, `${f.path} ${f.note}`)).slice(0, 8);
  if (files.length) lines.push('Important files:\n' + files.map(f => `  - ${f.path}: ${f.note}`).join('\n'));

  const bugs = mem.knownBugs.filter(b => !b.resolved && overlaps(q, b.note)).slice(0, 6);
  if (bugs.length) lines.push('Known open bugs:\n' + bugs.map(b => `  - ${b.note}`).join('\n'));

  const fixes = mem.priorFixes.filter(f => overlaps(q, f.summary) || f.files.some(p => touched.has(p))).slice(0, 6);
  if (fixes.length) lines.push('Relevant prior fixes:\n' + fixes.map(f => `  - ${f.summary} (${f.files.join(', ')})`).join('\n'));

  const decisions = mem.decisions.filter(d => overlaps(q, d.note)).slice(0, 6);
  if (decisions.length) lines.push('Relevant past decisions:\n' + decisions.map(d => `  - ${d.note}`).join('\n'));

  return lines.length ? `Project memory (filtered to this task):\n${lines.join('\n')}` : '';
}
