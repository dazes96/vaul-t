/**
 * Specialist agents.
 *
 * This is a thin ROLE layer over the one transparent agent loop — not a swarm
 * and not separate processes. A role just (a) appends a focused instruction
 * block to the agent's system prompt and (b) decides whether the agent may
 * modify files. Everything else — planning, approval, diffs, checkpoints,
 * verification, cancellation, memory — is the same shared machinery, so a role
 * can never bypass a safety system. Read-only roles physically cannot write:
 * the agent loop refuses their write/delete/run_command actions and tells them
 * to report findings instead.
 */
export interface Specialist {
  id: string;
  label: string;
  description: string;
  /** Whether this role may modify the workspace. Read-only roles produce findings only. */
  writes: boolean;
  /** Appended to the base agent system prompt. */
  prompt: string;
}

const FINDINGS = `You are in a REVIEW role: you have ONLY read_file, list_dir, and search. You must NOT emit write_file, delete_file, or run_command — they will be refused. Do not attempt to fix anything. Investigate, then deliver findings as plain text, most important first, each with: what, where (file:line), why it matters, and a concrete suggested fix the user could apply. If you find nothing noteworthy, say so plainly.`;

export const SPECIALISTS: Specialist[] = [
  {
    id: 'coder',
    label: 'Coder',
    description: 'Proposes and applies code changes (with approval).',
    writes: true,
    prompt: `You are the CODER. Implement the requested change. Read before you write, keep changes minimal and consistent with the project conventions in memory, and remember every write is previewed and approved by the user and is undoable. After changes, verification runs automatically.`,
  },
  {
    id: 'planner',
    label: 'Planner',
    description: 'Breaks a task into an ordered plan. Does not edit.',
    writes: false,
    prompt: `You are the PLANNER. ${FINDINGS} Your deliverable is a clear, ordered, numbered plan to accomplish the task: the concrete steps, which files each step touches, and how to verify success. Read/search enough to make the plan specific and correct — do not hand-wave. Do not implement anything.`,
  },
  {
    id: 'architect',
    label: 'Architect',
    description: 'Evaluates structure and design. Does not edit.',
    writes: false,
    prompt: `You are the ARCHITECT. ${FINDINGS} Focus on structure and design: module boundaries, coupling, layering, where responsibilities live, and how data/imports flow (use the project map's "Key modules" and structure). Recommend concrete structural improvements and call out design risks.`,
  },
  {
    id: 'reviewer',
    label: 'Reviewer',
    description: 'Critiques code quality and correctness. Does not edit.',
    writes: false,
    prompt: `You are the REVIEWER. ${FINDINGS} Focus on correctness and quality: bugs, edge cases, unclear naming, dead code, inconsistent patterns, and error handling. Quote the offending line.`,
  },
  {
    id: 'security',
    label: 'Security',
    description: 'Audits for security risks. Does not edit.',
    writes: false,
    prompt: `You are the SECURITY reviewer. ${FINDINGS} Focus on: path/filesystem escapes, command injection and unsafe shell/exec, secret handling and leaks, unsafe deserialization/eval, SSRF/unvalidated network calls, and plugin/extension risk. Rank by severity (critical/high/medium/low).`,
  },
  {
    id: 'performance',
    label: 'Performance',
    description: 'Finds performance problems. Does not edit.',
    writes: false,
    prompt: `You are the PERFORMANCE reviewer. ${FINDINGS} Focus on: synchronous/blocking work on hot paths, unbounded or repeated I/O, indexing/parsing cost, unnecessary re-renders or large client work, and memory growth (leaks, unbounded caches/arrays).`,
  },
  {
    id: 'testing',
    label: 'Testing',
    description: 'Identifies missing tests and untested behavior. Does not edit.',
    writes: false,
    prompt: `You are the TESTING reviewer. ${FINDINGS} Identify behavior that is untested or under-tested, edge cases without coverage, and the highest-value tests to add. For each, name the file/function and describe the specific test to write (inputs → expected result). Do not write the tests — the user can switch to the Coder role to implement them.`,
  },
  {
    id: 'documentation',
    label: 'Documentation',
    description: 'Updates docs/comments when useful (with approval).',
    writes: true,
    prompt: `You are the DOCUMENTATION specialist. Update README/docs/comments ONLY where it genuinely helps a reader — do not add noise or restate what the code already says. Every edit is previewed and approved and is undoable. Prefer small, high-value edits; if nothing needs updating, say so instead of inventing changes.`,
  },
];

const byId = new Map(SPECIALISTS.map(s => [s.id, s]));

export function getSpecialist(id: string | undefined): Specialist {
  return (id && byId.get(id)) || byId.get('coder')!;
}

export function specialistList(): Array<Pick<Specialist, 'id' | 'label' | 'description' | 'writes'>> {
  return SPECIALISTS.map(({ id, label, description, writes }) => ({ id, label, description, writes }));
}
