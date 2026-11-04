import {
  RunEventType,
  RunOutcome,
  RunScenario,
  RunStatus,
  RunStepStatus,
  type Prisma,
} from '../src/prisma/generated/client.js';
import {
  advanceFailureProgress,
  calculateStatistics,
  evaluateMeasurementValue,
  parseToleranceBounds,
  runOutcome,
  stepOutcome,
  type StepStatistics,
} from '../src/runs/measurement-evaluation.js';
import {
  RUN_CANCELLED_REASON_CODE,
  RUN_EVALUATION_VERSION,
  RUN_EVENT_SCHEMA_VERSION,
} from '../src/runs/run-domain.js';
import { hashRunStartRequest } from '../src/runs/run-start.js';
import {
  buildRunSnapshot,
  type RunProfileSnapshot,
  type RunSnapshotRows,
  type RunSnapshotSource,
} from '../src/runs/run-snapshot.js';
import {
  SIMULATOR_VERSION,
  simulate,
  type SimulationResult,
} from '../src/simulator/index.js';
import type { DemoRunSeed } from './seed-data.js';

/** One step of a published demo version, with canonical decimal strings. */
export interface DemoPublishedStep {
  logicalStepId: string;
  position: number;
  name: string;
  unit: string;
  minimum: string;
  maximum: string;
  sampleCount: number;
  intervalMs: number;
}

export interface DemoPublishedVersion {
  id: string;
  planId: string;
  planName: string;
  versionNumber: number;
  profile: RunProfileSnapshot;
  steps: readonly DemoPublishedStep[];
}

export interface SeededDemoRun {
  id: string;
  status: RunStatus;
  outcome: RunOutcome | null;
  expectedSampleCount: number;
  recordedSampleCount: number;
  eventSequence: number;
}

interface SeededSample {
  sampleIndex: number;
  value: string;
  scaledValue: bigint;
  isWithinTolerance: boolean;
}

interface SeededStep {
  row: RunSnapshotRows['steps'][number];
  samples: SeededSample[];
}

interface StepProgress {
  outOfToleranceCount: number;
  firstFailureSampleIndex: number | null;
}

/**
 * Creates one fully simulated terminal run inside the caller's transaction.
 *
 * The run row starts as RUNNING because the database only accepts measurements
 * for a running run. The simulator and evaluator produce every value, counter,
 * statistic and verdict; this module only persists their output and emits the
 * same event shapes as the live executor. Everything is committed together, so
 * a failed seed never leaves a half-written run behind.
 */
export async function createSeededDemoRun(
  tx: Prisma.TransactionClient,
  version: DemoPublishedVersion,
  requestedById: string,
  spec: DemoRunSeed,
  startedAt: Date,
): Promise<SeededDemoRun> {
  const failureStep =
    spec.failureStepName === null
      ? null
      : version.steps.find((step) => step.name === spec.failureStepName);

  if (spec.failureStepName !== null && failureStep === null) {
    throw new Error(
      `Demo run ${spec.idempotencyKey} names an unknown failure step.`,
    );
  }

  const failureStepId = failureStep?.logicalStepId ?? null;
  const requestHash = hashRunStartRequest({
    planVersionId: version.id,
    scenario: spec.scenario,
    seed: spec.seed,
    failureStepId,
    errorProbability: null,
  });
  const snapshot = buildRunSnapshot(
    toSnapshotSource(version),
    {
      scenario: spec.scenario,
      seed: BigInt(spec.seed),
      failureStepId,
      simulatorVersion: SIMULATOR_VERSION,
      evaluationVersion: RUN_EVALUATION_VERSION,
    },
    {
      requestedById,
      idempotencyKey: spec.idempotencyKey,
      requestHash,
      startedAt,
    },
  );
  const simulation = runSimulation(snapshot, spec);
  const plannedSteps = prepareSamples(snapshot, simulation);

  const run = await tx.testRun.create({
    data: {
      ...snapshot.run,
      // The first committed event is run.started at sequence 1.
      eventSequence: 1,
      steps: { create: snapshot.steps },
    },
    include: { steps: { orderBy: { position: 'asc' } } },
  });

  if (run.steps.length !== plannedSteps.length) {
    throw new Error('The seeded run snapshot lost a step.');
  }

  let sequence = 0;
  let recordedTotal = 0;
  let lastRecordedAt = startedAt;
  let cursor = startedAt;
  let cancelled = false;
  let cancelledStepCount = 0;
  const completedOutcomes: RunOutcome[] = [];

  const appendEvent = async (
    type: RunEventType,
    occurredAt: Date,
    payload: Prisma.InputJsonObject,
  ): Promise<void> => {
    sequence += 1;
    await tx.runEvent.create({
      data: {
        runId: run.id,
        sequence,
        type,
        schemaVersion: RUN_EVENT_SCHEMA_VERSION,
        occurredAt,
        payload,
      },
    });
  };

  await appendEvent(RunEventType.RUN_STARTED, startedAt, {
    status: RunStatus.RUNNING,
    planId: snapshot.run.planId,
    planVersionId: snapshot.run.planRevisionId,
    planName: snapshot.run.planNameSnapshot,
    versionNumber: snapshot.run.versionNumberSnapshot,
    scenario: snapshot.run.scenario,
    expectedSampleCount: snapshot.run.expectedSampleCount,
    stepCount: snapshot.steps.length,
  });

  for (const [index, plannedStep] of plannedSteps.entries()) {
    if (cancelled) {
      break;
    }

    const stepRow = run.steps[index]!;
    const stepStartedAt = cursor;
    await tx.runStep.update({
      where: { id: stepRow.id },
      data: { status: RunStepStatus.RUNNING, startedAt: stepStartedAt },
    });
    await appendEvent(RunEventType.STEP_STARTED, stepStartedAt, {
      stepId: stepRow.id,
      logicalStepId: stepRow.logicalStepId,
      position: stepRow.position,
      name: stepRow.name,
      unit: stepRow.unit,
      minimum: stepRow.minimum.toFixed(6),
      maximum: stepRow.maximum.toFixed(6),
      sampleCount: stepRow.sampleCount,
      intervalMs: stepRow.intervalMs,
      status: RunStepStatus.RUNNING,
      startedAt: stepStartedAt.toISOString(),
      recordedSampleCount: recordedTotal,
      expectedSampleCount: snapshot.run.expectedSampleCount,
    });

    const values: bigint[] = [];
    let progress: StepProgress = {
      outOfToleranceCount: 0,
      firstFailureSampleIndex: null,
    };
    let cancelThisStep = false;

    for (const sample of plannedStep.samples) {
      if (
        spec.cancelAfterSampleCount !== null &&
        recordedTotal >= spec.cancelAfterSampleCount
      ) {
        cancelThisStep = true;
        break;
      }

      const recordedAt = new Date(
        stepStartedAt.getTime() + (sample.sampleIndex + 1) * stepRow.intervalMs,
      );
      progress = advanceFailureProgress(
        progress,
        sample.sampleIndex,
        sample.isWithinTolerance,
      );

      await tx.measurement.create({
        data: {
          runId: run.id,
          runStepId: stepRow.id,
          sampleIndex: sample.sampleIndex,
          value: sample.value,
          isWithinTolerance: sample.isWithinTolerance,
          recordedAt,
          elapsedMs: (sample.sampleIndex + 1) * stepRow.intervalMs,
        },
      });

      values.push(sample.scaledValue);
      recordedTotal += 1;
      lastRecordedAt = recordedAt;

      await appendEvent(RunEventType.MEASUREMENT_RECORDED, recordedAt, {
        stepId: stepRow.id,
        logicalStepId: stepRow.logicalStepId,
        position: stepRow.position,
        sampleIndex: sample.sampleIndex,
        value: sample.value,
        isWithinTolerance: sample.isWithinTolerance,
        recordedAt: recordedAt.toISOString(),
        elapsedMs: (sample.sampleIndex + 1) * stepRow.intervalMs,
        recordedCount: sample.sampleIndex + 1,
        outOfToleranceCount: progress.outOfToleranceCount,
        firstFailureSampleIndex: progress.firstFailureSampleIndex,
        hasOutOfTolerance: progress.outOfToleranceCount > 0,
        recordedSampleCount: recordedTotal,
        expectedSampleCount: snapshot.run.expectedSampleCount,
      });
    }

    if (cancelThisStep) {
      await tx.runStep.update({
        where: { id: stepRow.id },
        data: {
          status: RunStepStatus.CANCELLED,
          outcome: null,
          recordedCount: values.length,
          outOfToleranceCount: progress.outOfToleranceCount,
          firstFailureSampleIndex: progress.firstFailureSampleIndex,
          finishedAt: lastRecordedAt,
        },
      });
      cancelled = true;
      cancelledStepCount = 1;
      cursor = lastRecordedAt;
      break;
    }

    if (values.length !== stepRow.sampleCount) {
      throw new Error('A seeded step did not record every expected sample.');
    }

    const statistics = calculateStatistics(values);
    const outcome = stepOutcome(progress.outOfToleranceCount, values.length);
    const finishedAt = new Date(
      stepStartedAt.getTime() + values.length * stepRow.intervalMs,
    );

    await tx.runStep.update({
      where: { id: stepRow.id },
      data: {
        status: RunStepStatus.COMPLETED,
        outcome,
        recordedCount: values.length,
        outOfToleranceCount: progress.outOfToleranceCount,
        firstFailureSampleIndex: progress.firstFailureSampleIndex,
        finishedAt,
        statistics: statisticsPayload(statistics),
      },
    });
    completedOutcomes.push(outcome);
    cursor = finishedAt;

    await appendEvent(RunEventType.STEP_COMPLETED, finishedAt, {
      stepId: stepRow.id,
      logicalStepId: stepRow.logicalStepId,
      position: stepRow.position,
      status: RunStepStatus.COMPLETED,
      outcome,
      recordedCount: values.length,
      outOfToleranceCount: progress.outOfToleranceCount,
      firstFailureSampleIndex: progress.firstFailureSampleIndex,
      hasOutOfTolerance: progress.outOfToleranceCount > 0,
      statistics: statisticsPayload(statistics),
      startedAt: stepStartedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      recordedSampleCount: recordedTotal,
      expectedSampleCount: snapshot.run.expectedSampleCount,
    });

    if (
      spec.cancelAfterSampleCount !== null &&
      recordedTotal >= spec.cancelAfterSampleCount
    ) {
      cancelled = true;
      cursor = finishedAt;
      break;
    }
  }

  if (cancelled) {
    const finishedAt = lastRecordedAt;
    const notRunSteps = await tx.runStep.updateMany({
      where: { runId: run.id, status: RunStepStatus.PENDING },
      data: { status: RunStepStatus.NOT_RUN, outcome: null },
    });

    await appendEvent(RunEventType.RUN_CANCELLED, finishedAt, {
      status: RunStatus.CANCELLED,
      reasonCode: RUN_CANCELLED_REASON_CODE,
      cancelledById: requestedById,
      recordedSampleCount: recordedTotal,
      expectedSampleCount: snapshot.run.expectedSampleCount,
      cancelledStepCount,
      notRunStepCount: notRunSteps.count,
      finishedAt: finishedAt.toISOString(),
    });

    await tx.testRun.update({
      where: { id: run.id },
      data: {
        status: RunStatus.CANCELLED,
        outcome: null,
        recordedSampleCount: recordedTotal,
        eventSequence: sequence,
        finishedAt,
        cancelledById: requestedById,
        reasonCode: RUN_CANCELLED_REASON_CODE,
      },
    });

    return {
      id: run.id,
      status: RunStatus.CANCELLED,
      outcome: null,
      expectedSampleCount: snapshot.run.expectedSampleCount,
      recordedSampleCount: recordedTotal,
      eventSequence: sequence,
    };
  }

  const outcome = runOutcome(
    completedOutcomes,
    recordedTotal,
    snapshot.run.expectedSampleCount,
  );
  const finishedAt = cursor;
  const passedStepCount = completedOutcomes.filter(
    (stepOutcome) => stepOutcome === RunOutcome.PASSED,
  ).length;

  await appendEvent(RunEventType.RUN_COMPLETED, finishedAt, {
    status: RunStatus.COMPLETED,
    outcome,
    recordedSampleCount: recordedTotal,
    expectedSampleCount: snapshot.run.expectedSampleCount,
    stepCount: completedOutcomes.length,
    passedStepCount,
    failedStepCount: completedOutcomes.length - passedStepCount,
    finishedAt: finishedAt.toISOString(),
  });

  await tx.testRun.update({
    where: { id: run.id },
    data: {
      status: RunStatus.COMPLETED,
      outcome,
      recordedSampleCount: recordedTotal,
      eventSequence: sequence,
      finishedAt,
    },
  });

  return {
    id: run.id,
    status: RunStatus.COMPLETED,
    outcome,
    expectedSampleCount: snapshot.run.expectedSampleCount,
    recordedSampleCount: recordedTotal,
    eventSequence: sequence,
  };
}

function toSnapshotSource(version: DemoPublishedVersion): RunSnapshotSource {
  return {
    planId: version.planId,
    revisionId: version.id,
    planName: version.planName,
    versionNumber: version.versionNumber,
    profile: version.profile,
    steps: version.steps.map((step) => ({
      logicalStepId: step.logicalStepId,
      position: step.position,
      name: step.name,
      unit: step.unit,
      // buildRunSnapshot reads the canonical stored decimal through toFixed.
      minimum: { toFixed: () => step.minimum },
      maximum: { toFixed: () => step.maximum },
      sampleCount: step.sampleCount,
      intervalMs: step.intervalMs,
    })),
  };
}

function runSimulation(
  snapshot: RunSnapshotRows,
  spec: DemoRunSeed,
): SimulationResult {
  const steps = snapshot.steps.map((step) => ({
    logicalStepId: step.logicalStepId,
    name: step.name,
    unit: step.unit,
    minimum: step.minimum,
    maximum: step.maximum,
    sampleCount: step.sampleCount,
    intervalMs: step.intervalMs,
  }));

  if (spec.scenario === RunScenario.FORCED_FAILURE) {
    if (!snapshot.run.failureStepId) {
      throw new Error('A forced-failure demo run must name a failure step.');
    }

    return simulate({
      scenario: 'FORCED_FAILURE',
      seed: spec.seed,
      failureStepId: snapshot.run.failureStepId,
      steps,
    });
  }

  if (spec.scenario !== RunScenario.NORMAL) {
    throw new Error('The demo history only uses NORMAL and FORCED_FAILURE.');
  }

  return simulate({ scenario: 'NORMAL', seed: spec.seed, steps });
}

function prepareSamples(
  snapshot: RunSnapshotRows,
  simulation: SimulationResult,
): SeededStep[] {
  if (simulation.simulatorVersion !== SIMULATOR_VERSION) {
    throw new Error('The simulator returned an unexpected version marker.');
  }
  if (simulation.steps.length !== snapshot.steps.length) {
    throw new Error('The simulator did not return every snapshot step.');
  }

  return snapshot.steps.map((step, index) => {
    const simulatedStep = simulation.steps[index]!;
    if (simulatedStep.logicalStepId !== step.logicalStepId) {
      throw new Error('The simulator returned a different step order.');
    }

    const bounds = parseToleranceBounds(step.minimum, step.maximum);
    const samples = simulatedStep.samples.map((sample, sampleIndex) => {
      if (sample.sampleIndex !== sampleIndex) {
        throw new Error('The simulator skipped or duplicated a sample index.');
      }

      const evaluated = evaluateMeasurementValue(sample.value, bounds);
      return {
        sampleIndex,
        value: evaluated.value,
        scaledValue: evaluated.scaledValue,
        isWithinTolerance: evaluated.isWithinTolerance,
      };
    });

    if (samples.length !== step.sampleCount) {
      throw new Error('The simulator returned a different sample count.');
    }

    return { row: step, samples };
  });
}

function statisticsPayload(statistics: StepStatistics): Prisma.InputJsonObject {
  return {
    minimum: statistics.minimum,
    maximum: statistics.maximum,
    average: statistics.average,
    sampleCount: statistics.sampleCount,
  };
}
