export interface VerifyOutcome {
  ranSteps: boolean;
  ok: boolean;
  failedLabel?: string;
}

export interface RunSummaryInput {
  task: string;
  filesChanged: string[];
  verify: VerifyOutcome | null;   // null = auto-verify was off or nothing changed, so it never ran
  cancelled: boolean;
  stepsUsed: number;
  runId: string;
}

/**
 * Deterministic, always-present "what changed and why" summary — the model's
 * own final narration is shown too (in agent.ts), but this factual summary
 * never depends on the model remembering to explain itself. Pure function,
 * no I/O, so it's trivially unit-testable.
 */
export function buildRunSummary(input: RunSummaryInput): string {
  const lines: string[] = [];

  if (input.cancelled) {
    lines.push('⏹ Stopped by user before finishing.');
  }

  if (input.filesChanged.length === 0) {
    lines.push('No files were changed.');
  } else {
    lines.push(`Changed ${input.filesChanged.length} file${input.filesChanged.length === 1 ? '' : 's'}:`);
    for (const f of input.filesChanged) lines.push(`  • ${f}`);
  }

  if (input.verify) {
    if (!input.verify.ranSteps) {
      lines.push('No typecheck/lint/test/build scripts were detected, so verification was skipped.');
    } else if (input.verify.ok) {
      lines.push('✓ Verified: typecheck/lint/test/build all passed.');
    } else {
      lines.push(`✗ Verification is still failing (${input.verify.failedLabel}). Review the Verify panel for details.`);
    }
  }

  if (input.filesChanged.length > 0) {
    lines.push(`This run can be undone as one checkpoint from Change History (run ${input.runId}).`);
  }

  return lines.join('\n');
}
