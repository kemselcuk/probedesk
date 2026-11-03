import type {
  RunSnapshot,
  RunSnapshotStep,
  RunStatus,
  RunStepOutcome,
  RunStepStatus,
} from './runs-api.types';

export type RunStatusTone =
  | 'passed'
  | 'failed'
  | 'running'
  | 'cancelled'
  | 'interrupted'
  | 'error';

export type RunStatusIcon =
  | 'play'
  | 'check'
  | 'cross'
  | 'stop'
  | 'pause'
  | 'warning';

export interface RunStatusView {
  /** The visible text, so status is never communicated by colour alone. */
  readonly label: string;
  readonly detail: string;
  readonly tone: RunStatusTone;
  readonly icon: RunStatusIcon;
}

/**
 * Presentation only. The run status and outcome come from the server; this
 * function chooses the English label, icon, and explanation.
 */
export function runStatusView(
  status: RunStatus,
  outcome: RunSnapshot['outcome'],
): RunStatusView {
  if (status === 'RUNNING') {
    return {
      label: 'Running',
      detail: 'The run is still in progress. This snapshot is provisional.',
      tone: 'running',
      icon: 'play',
    };
  }

  if (status === 'COMPLETED') {
    if (outcome === 'PASSED') {
      return {
        label: 'Passed',
        detail: 'Every expected sample was recorded and every step passed.',
        tone: 'passed',
        icon: 'check',
      };
    }

    if (outcome === 'FAILED') {
      return {
        label: 'Failed',
        detail: 'The run completed and at least one step failed.',
        tone: 'failed',
        icon: 'cross',
      };
    }

    return {
      label: 'Completed',
      detail:
        'The run completed but the snapshot has no overall outcome. No verdict is inferred.',
      tone: 'cancelled',
      icon: 'check',
    };
  }

  switch (status) {
    case 'CANCELLED':
      return {
        label: 'Cancelled',
        detail:
          'The run was stopped by an operator. This is not a Passed or Failed result; recorded samples and completed step results are preserved.',
        tone: 'cancelled',
        icon: 'stop',
      };
    case 'INTERRUPTED':
      return {
        label: 'Interrupted',
        detail:
          'The server interrupted the run before it finished. This is not a Passed or Failed result; recorded samples and completed step results are preserved.',
        tone: 'interrupted',
        icon: 'pause',
      };
    case 'ERROR':
      return {
        label: 'Error',
        detail:
          'The run stopped because of a technical error. This is not a Passed or Failed result and not a tolerance verdict.',
        tone: 'error',
        icon: 'warning',
      };
  }
}

export function runStatusLabel(
  status: RunStatus,
  outcome: RunSnapshot['outcome'] = null,
): string {
  return runStatusView(status, outcome).label;
}

export function stepStatusLabel(status: RunStepStatus): string {
  switch (status) {
    case 'PENDING':
      return 'Pending';
    case 'RUNNING':
      return 'Running';
    case 'COMPLETED':
      return 'Completed';
    case 'CANCELLED':
      return 'Cancelled';
    case 'INTERRUPTED':
      return 'Interrupted';
    case 'ERROR':
      return 'Error';
    case 'NOT_RUN':
      return 'Not run';
  }
}

export function stepOutcomeLabel(outcome: RunStepOutcome): string | null {
  if (outcome === 'PASSED') {
    return 'Passed';
  }

  if (outcome === 'FAILED') {
    return 'Failed';
  }

  return null;
}

export function scenarioLabel(scenario: RunSnapshot['scenario']): string {
  switch (scenario) {
    case 'NORMAL':
      return 'Normal';
    case 'FORCED_FAILURE':
      return 'Forced failure';
    case 'RANDOM':
      return 'Random failure';
  }
}

/**
 * A RUNNING snapshot is provisional; a terminal run is partial only when fewer
 * samples were recorded than expected. A stopped terminal run can still have
 * every sample (for example a cancel during finalization), and that case must
 * not be described as missing data. Missing samples are never presented as zero.
 */
export function isPartialResult(snapshot: RunSnapshot): boolean {
  return (
    snapshot.status !== 'RUNNING' &&
    snapshot.recordedSampleCount < snapshot.expectedSampleCount
  );
}

/**
 * A CANCELLED, INTERRUPTED, or ERROR run that nevertheless recorded every
 * expected sample. The result is not presented as completed, so the screen
 * needs a separate, accurate explanation instead of the partial-results note.
 */
export function isStoppedAfterAllSamples(snapshot: RunSnapshot): boolean {
  return (
    (snapshot.status === 'CANCELLED' ||
      snapshot.status === 'INTERRUPTED' ||
      snapshot.status === 'ERROR') &&
    snapshot.recordedSampleCount >= snapshot.expectedSampleCount
  );
}

export function isStepPartial(step: RunSnapshotStep): boolean {
  return step.status !== 'COMPLETED' || step.recordedCount < step.sampleCount;
}

/** Recorded / expected with an integer percentage, or an honest empty label. */
export function progressLabel(recorded: number, expected: number): string {
  if (expected === 0) {
    return 'No samples were expected';
  }

  const percent = Math.min(100, Math.round((recorded / expected) * 100));
  return `${recorded} of ${expected} samples recorded (${percent}%)`;
}
