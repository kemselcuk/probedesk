import type { RunHistoryItem, RunStatus } from '../runs/runs-api.types';
import { runStatusLabel } from '../runs/run-status';

export const MAX_COMPARE_RUNS = 2;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const OPTION_TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'UTC',
});

/** RUNNING is the only non-terminal status; every other status can be compared. */
export function isTerminalStatus(status: RunStatus): boolean {
  return status !== 'RUNNING';
}

export interface CompareSelectionValidation {
  readonly valid: boolean;
  readonly left: RunHistoryItem | null;
  readonly right: RunHistoryItem | null;
  /** English, actionable reason shown next to the Compare action. */
  readonly reason: string | null;
}

/**
 * UI guard for the two-run selection. It is never the only check: the API
 * repeats terminal, distinct-run, and same-plan validation and its 409/422/404
 * responses stay visible on the Compare screen.
 */
export function validateCompareSelection(
  selected: readonly RunHistoryItem[],
): CompareSelectionValidation {
  const distinct = selected.filter(
    (run, index) => selected.findIndex((entry) => entry.id === run.id) === index,
  );
  const left = distinct[0] ?? null;
  const right = distinct[1] ?? null;

  if (left === null) {
    return {
      valid: false,
      left: null,
      right: null,
      reason: 'Select two terminal runs to compare.',
    };
  }

  if (right === null) {
    return {
      valid: false,
      left,
      right: null,
      reason: 'Select one more terminal run to compare.',
    };
  }

  if (distinct.length > MAX_COMPARE_RUNS) {
    return {
      valid: false,
      left,
      right,
      reason: 'Select no more than two runs.',
    };
  }

  if (!isTerminalStatus(left.status) || !isTerminalStatus(right.status)) {
    return {
      valid: false,
      left,
      right,
      reason:
        'A running run cannot be compared. Wait until it reaches a terminal state and reload the history.',
    };
  }

  if (left.planId !== right.planId) {
    return {
      valid: false,
      left,
      right,
      reason: 'Choose two runs of the same plan; different plans cannot be compared.',
    };
  }

  return { valid: true, left, right, reason: null };
}

export type CompareQueryValidation =
  | { readonly kind: 'empty' }
  | { readonly kind: 'invalid'; readonly message: string }
  | { readonly kind: 'ready'; readonly leftRunId: string; readonly rightRunId: string };

/**
 * Validates a deep link locally before any request. Unknown but well-formed
 * ids still go to the API so its 404/409/422 responses are exercised and shown.
 */
export function validateCompareQuery(
  leftValue: string,
  rightValue: string,
): CompareQueryValidation {
  const left = leftValue.trim();
  const right = rightValue.trim();

  if (left.length === 0 && right.length === 0) {
    return { kind: 'empty' };
  }

  if (left.length === 0) {
    return {
      kind: 'invalid',
      message: 'This comparison link is missing leftRunId. Choose two runs below.',
    };
  }

  if (right.length === 0) {
    return {
      kind: 'invalid',
      message: 'This comparison link is missing rightRunId. Choose two runs below.',
    };
  }

  if (!UUID_PATTERN.test(left) || !UUID_PATTERN.test(right)) {
    return {
      kind: 'invalid',
      message: 'This comparison link does not contain valid run ids. Choose two runs below.',
    };
  }

  if (left === right) {
    return {
      kind: 'invalid',
      message: 'A run cannot be compared with itself. Choose two different runs below.',
    };
  }

  return { kind: 'ready', leftRunId: left, rightRunId: right };
}

/** Select label: version, plan, stored status, and start time in UTC. */
export function runOptionLabel(run: RunHistoryItem): string {
  const started = new Date(run.startedAt);
  const startedText = Number.isNaN(started.getTime())
    ? run.startedAt
    : `${OPTION_TIME_FORMATTER.format(started)} UTC`;

  return `Version ${run.versionNumber} · ${run.planName} · ${runStatusLabel(run.status, run.outcome)} · ${startedText}`;
}

export function runOptionState(run: RunHistoryItem): string | null {
  if (!isTerminalStatus(run.status)) {
    return 'Running — cannot be compared';
  }

  return null;
}
