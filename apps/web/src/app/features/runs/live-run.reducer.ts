import type {
  RunMeasurement,
  RunSnapshot,
  RunSnapshotStep,
  RunStepStatus,
} from './runs-api.types';
import type {
  RunEventEnvelope,
  RunEventStepStatistics,
  TerminalRunEventType,
} from '../../core/runs/run-event.types';
import { isTerminalRunEventType } from '../../core/runs/run-event.types';

/** The snapshot plus the event cursor it was read with. */
export interface LiveRunState {
  readonly run: RunSnapshot;
  readonly lastEventSequence: number;
}

export type RunEventApplication =
  | { readonly kind: 'applied'; readonly state: LiveRunState }
  | { readonly kind: 'duplicate'; readonly state: LiveRunState }
  | {
      readonly kind: 'gap';
      readonly state: LiveRunState;
      readonly expectedSequence: number;
    }
  | { readonly kind: 'foreign'; readonly state: LiveRunState }
  | { readonly kind: 'after-terminal'; readonly state: LiveRunState };

/**
 * Applies one committed event in strict sequence order.
 *
 * Duplicate sequence values (reconnect replay) are ignored. A forward gap is
 * reported to the caller, which must reconcile with a fresh snapshot instead of
 * guessing the missing samples. Events from another run never move this state.
 */
export function applyRunEvent(
  state: LiveRunState,
  event: RunEventEnvelope,
): RunEventApplication {
  if (event.runId !== state.run.id) {
    return { kind: 'foreign', state };
  }

  if (event.sequence <= state.lastEventSequence) {
    return { kind: 'duplicate', state };
  }

  if (event.sequence !== state.lastEventSequence + 1) {
    return {
      kind: 'gap',
      state,
      expectedSequence: state.lastEventSequence + 1,
    };
  }

  if (isTerminalRunStatus(state.run.status) && !isTerminalRunEventType(event.type)) {
    // A terminal record is immutable. A late measurement must not reopen it or
    // change its counters.
    return { kind: 'after-terminal', state };
  }

  const applied = applyEventToRun(state.run, event);
  const run: RunSnapshot = { ...applied, lastEventSequence: event.sequence };
  return {
    kind: 'applied',
    state: { run, lastEventSequence: event.sequence },
  };
}

/**
 * Merges an HTTP snapshot into the current live state.
 *
 * The snapshot is the source of truth for rules and step status; the merge is
 * deliberately monotonic for counters, outcomes, and failure markers so an
 * older response or a reconcile cannot erase a violation that was already
 * committed. A terminal run is never replaced by a non-terminal snapshot.
 */
export function mergeRunSnapshot(
  current: RunSnapshot | null,
  incoming: RunSnapshot,
): RunSnapshot {
  if (current === null || current.id !== incoming.id) {
    return incoming;
  }

  if (isTerminalRunStatus(current.status) && !isTerminalRunStatus(incoming.status)) {
    return current;
  }

  const previousSteps = new Map(
    current.steps.map((step) => [step.runStepId, step] as const),
  );
  const steps = incoming.steps.map((step) => {
    const previous = previousSteps.get(step.runStepId);
    return previous === undefined ? step : mergeStep(previous, step);
  });

  return {
    ...incoming,
    status: incoming.status,
    outcome: incoming.outcome ?? current.outcome,
    finishedAt: incoming.finishedAt ?? current.finishedAt,
    reasonCode: incoming.reasonCode ?? current.reasonCode,
    expectedSampleCount: incoming.expectedSampleCount,
    recordedSampleCount: Math.max(
      current.recordedSampleCount,
      incoming.recordedSampleCount,
    ),
    lastEventSequence: Math.max(
      current.lastEventSequence,
      incoming.lastEventSequence,
    ),
    steps,
  };
}

function applyEventToRun(
  run: RunSnapshot,
  event: RunEventEnvelope,
): RunSnapshot {
  switch (event.type) {
    case 'run.started':
      return run;
    case 'step.started':
      return {
        ...run,
        recordedSampleCount: Math.max(
          run.recordedSampleCount,
          event.payload.recordedSampleCount,
        ),
        expectedSampleCount: event.payload.expectedSampleCount,
        steps: updateStep(run.steps, event.payload.stepId, (step) => ({
          ...step,
          status: mergeStepStatus(step.status, event.payload.status),
        })),
      };
    case 'measurement.recorded':
      return {
        ...run,
        recordedSampleCount: Math.max(
          run.recordedSampleCount,
          event.payload.recordedSampleCount,
        ),
        expectedSampleCount: event.payload.expectedSampleCount,
        steps: updateStep(run.steps, event.payload.stepId, (step) => ({
          ...step,
          status: mergeStepStatus(step.status, 'RUNNING'),
          recordedCount: Math.max(step.recordedCount, event.payload.recordedCount),
          outOfToleranceCount: Math.max(
            step.outOfToleranceCount,
            event.payload.outOfToleranceCount,
          ),
          firstFailureSampleIndex: mergeFirstFailure(
            step.firstFailureSampleIndex,
            event.payload.firstFailureSampleIndex,
          ),
          hasOutOfTolerance:
            step.hasOutOfTolerance || event.payload.hasOutOfTolerance,
          measurements: mergeMeasurement(step.measurements, {
            sampleIndex: event.payload.sampleIndex,
            value: event.payload.value,
            isWithinTolerance: event.payload.isWithinTolerance,
            recordedAt: event.payload.recordedAt,
            elapsedMs: event.payload.elapsedMs,
          }),
        })),
      };
    case 'step.completed':
      return {
        ...run,
        recordedSampleCount: Math.max(
          run.recordedSampleCount,
          event.payload.recordedSampleCount,
        ),
        expectedSampleCount: event.payload.expectedSampleCount,
        steps: updateStep(run.steps, event.payload.stepId, (step) => ({
          ...step,
          status: mergeStepStatus(step.status, event.payload.status),
          outcome: event.payload.outcome ?? step.outcome,
          recordedCount: Math.max(step.recordedCount, event.payload.recordedCount),
          outOfToleranceCount: Math.max(
            step.outOfToleranceCount,
            event.payload.outOfToleranceCount,
          ),
          firstFailureSampleIndex: mergeFirstFailure(
            step.firstFailureSampleIndex,
            event.payload.firstFailureSampleIndex,
          ),
          hasOutOfTolerance:
            step.hasOutOfTolerance || event.payload.hasOutOfTolerance,
          statistics: mergeStatistics(step.statistics, event.payload.statistics),
        })),
      };
    case 'run.completed':
    case 'run.cancelled':
    case 'run.interrupted':
    case 'run.errored':
      return applyTerminalEvent(run, event);
  }
}

function applyTerminalEvent(
  run: RunSnapshot,
  event: RunEventEnvelope & { readonly type: TerminalRunEventType },
): RunSnapshot {
  const payload = event.payload;

  return {
    ...run,
    status: payload.status,
    outcome:
      'outcome' in payload ? payload.outcome : run.outcome,
    finishedAt: payload.finishedAt,
    reasonCode: 'reasonCode' in payload ? payload.reasonCode : run.reasonCode,
    recordedSampleCount: Math.max(
      run.recordedSampleCount,
      payload.recordedSampleCount,
    ),
    expectedSampleCount: payload.expectedSampleCount,
  };
}

function updateStep(
  steps: readonly RunSnapshotStep[],
  stepId: string,
  update: (step: RunSnapshotStep) => RunSnapshotStep,
): RunSnapshotStep[] {
  let changed = false;
  const next = steps.map((step) => {
    if (step.runStepId !== stepId) {
      return step;
    }

    changed = true;
    return update(step);
  });

  return changed ? next : [...steps];
}

function mergeStep(
  previous: RunSnapshotStep,
  incoming: RunSnapshotStep,
): RunSnapshotStep {
  return {
    ...incoming,
    status: mergeStepStatus(previous.status, incoming.status),
    outcome: incoming.outcome ?? previous.outcome,
    recordedCount: Math.max(previous.recordedCount, incoming.recordedCount),
    outOfToleranceCount: Math.max(
      previous.outOfToleranceCount,
      incoming.outOfToleranceCount,
    ),
    firstFailureSampleIndex: mergeFirstFailure(
      previous.firstFailureSampleIndex,
      incoming.firstFailureSampleIndex,
    ),
    hasOutOfTolerance:
      previous.hasOutOfTolerance || incoming.hasOutOfTolerance,
    statistics: mergeStatistics(previous.statistics, incoming.statistics),
    measurements: mergeMeasurements(
      previous.measurements,
      incoming.measurements,
    ),
  };
}

/**
 * Step status may only move forward. PENDING → RUNNING → a terminal stop;
 * a stale snapshot can never turn a completed step back into RUNNING.
 */
function mergeStepStatus(
  current: RunStepStatus,
  incoming: RunStepStatus,
): RunStepStatus {
  if (stepStatusRank(incoming) < stepStatusRank(current)) {
    return current;
  }

  return incoming;
}

function stepStatusRank(status: RunStepStatus): number {
  if (status === 'PENDING') {
    return 0;
  }

  if (status === 'RUNNING') {
    return 1;
  }

  return 2;
}

function mergeStatistics(
  current: RunEventStepStatistics,
  incoming: RunEventStepStatistics,
): RunEventStepStatistics {
  return incoming.sampleCount === null ? current : incoming;
}

function mergeFirstFailure(
  current: number | null,
  incoming: number | null,
): number | null {
  if (current === null) {
    return incoming;
  }

  if (incoming === null) {
    return current;
  }

  return Math.min(current, incoming);
}

function mergeMeasurement(
  measurements: readonly RunMeasurement[],
  incoming: RunMeasurement,
): RunMeasurement[] {
  const index = measurements.findIndex(
    (measurement) => measurement.sampleIndex === incoming.sampleIndex,
  );

  if (index === -1) {
    return [...measurements, incoming].sort(
      (left, right) => left.sampleIndex - right.sampleIndex,
    );
  }

  return measurements.map((measurement, position) =>
    position === index ? incoming : measurement,
  );
}

function mergeMeasurements(
  current: readonly RunMeasurement[],
  incoming: readonly RunMeasurement[],
): RunMeasurement[] {
  const byIndex = new Map<number, RunMeasurement>();
  for (const measurement of current) {
    byIndex.set(measurement.sampleIndex, measurement);
  }
  for (const measurement of incoming) {
    byIndex.set(measurement.sampleIndex, measurement);
  }

  return [...byIndex.values()].sort(
    (left, right) => left.sampleIndex - right.sampleIndex,
  );
}

export function isTerminalRunStatus(status: RunSnapshot['status']): boolean {
  return status !== 'RUNNING';
}
