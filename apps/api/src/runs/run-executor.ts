import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  RunEventType,
  RunOutcome,
  RunScenario,
  RunStatus,
  RunStepStatus,
} from '../prisma/generated/client.js';
import type { Prisma } from '../prisma/generated/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  SIMULATOR_VERSION,
  SimulatorInputError,
  simulate,
  type SimulationInput,
  type SimulatorStepDefinition,
} from '../simulator/index.js';
import {
  advanceFailureProgress,
  calculateStatistics,
  evaluateMeasurementValue,
  MeasurementValidationError,
  parseMeasurementDecimal,
  parseToleranceBounds,
  runOutcome,
  stepOutcome,
  type StepStatistics,
} from './measurement-evaluation.js';
import { RUN_EVENT_SCHEMA_VERSION } from './run-domain.js';
import {
  RUN_SCHEDULER,
  type RunScheduler,
  type RunTimer,
} from './run-scheduler.js';

/**
 * Run execution is decoupled from the HTTP request that created it. The start
 * request commits the snapshot and returns; this executor then claims the run
 * through the scheduler. Each persistence step is its own short transaction
 * that locks the TestRun row, re-checks RUNNING and writes counters, samples and
 * the event together. No transaction stays open while a timer waits.
 */
const TRANSACTION_OPTIONS = { timeout: 10_000, maxWait: 5_000 } as const;
const START_DELAY_MS = 0;

type TechnicalReasonCode =
  | 'SIMULATOR_INPUT_INVALID'
  | 'SIMULATOR_OUTPUT_INVALID'
  | 'SIMULATOR_VERSION_MISMATCH'
  | 'EXECUTION_STATE_INVALID'
  | 'EXECUTION_FAILED';

interface LoadedRunStep {
  id: string;
  logicalStepId: string;
  position: number;
  name: string;
  unit: string;
  minimum: string;
  maximum: string;
  sampleCount: number;
  intervalMs: number;
  status: RunStepStatus;
  outcome: RunOutcome | null;
  recordedCount: number;
  outOfToleranceCount: number;
  firstFailureSampleIndex: number | null;
  startedAt: Date | null;
}

interface LoadedRun {
  id: string;
  scenario: RunScenario;
  seed: bigint;
  errorProbability: string | null;
  failureStepId: string | null;
  simulatorVersion: string;
  status: RunStatus;
  expectedSampleCount: number;
  recordedSampleCount: number;
  startedAt: Date;
  steps: LoadedRunStep[];
}

interface PlannedSample {
  sampleIndex: number;
  value: string;
  scaledValue: bigint;
  isWithinTolerance: boolean;
}

interface PlannedStep {
  step: LoadedRunStep;
  samples: PlannedSample[];
}

interface ExecutionState {
  timer: RunTimer | null;
  rejectWait: ((error: Error) => void) | null;
  stopped: boolean;
}

/** The run reached a terminal/other status before this write. Nothing is owed. */
class RunStoppedError extends Error {
  override readonly name = 'RunStoppedError';
}

/** The persisted counters disagree with the executor's sequential model. */
class RunExecutionStateError extends Error {
  override readonly name = 'RunExecutionStateError';
}

/** The stored snapshot cannot be executed by the current simulator version. */
class RunPreparationError extends Error {
  override readonly name = 'RunPreparationError';

  constructor(
    readonly reasonCode: TechnicalReasonCode,
    message: string,
  ) {
    super(message);
  }
}

@Injectable()
export class RunExecutor implements OnModuleDestroy {
  private readonly logger = new Logger(RunExecutor.name);
  /** In-process cancellation registry: one execution state per run id. */
  private readonly executions = new Map<string, ExecutionState>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RUN_SCHEDULER) private readonly scheduler: RunScheduler,
  ) {}

  /**
   * Schedules one execution attempt. This method never awaits database work, so
   * an HTTP handler can return as soon as the run snapshot is committed.
   */
  start(runId: string): void {
    if (this.executions.has(runId)) {
      return;
    }

    const state: ExecutionState = {
      timer: null,
      rejectWait: null,
      stopped: false,
    };
    this.executions.set(runId, state);

    void this.runExecution(runId, state).finally(() => {
      this.executions.delete(runId);
    });
  }

  /** Number of in-process executions, including one paused in a test seam. */
  get activeExecutionCount(): number {
    return this.executions.size;
  }

  /**
   * Signals the in-process execution for this run to stop. The timer or the
   * pending wait is cancelled immediately; every database write still re-checks
   * the RUNNING status under the row lock, so a write already in flight either
   * committed before the cancel transaction or is rejected by it.
   */
  cancel(runId: string): boolean {
    const state = this.executions.get(runId);
    if (!state) {
      return false;
    }

    this.stopExecution(state);
    return true;
  }

  /**
   * Controlled shutdown stops timers and leaves the run data untouched for
   * startup recovery. It never writes a terminal status.
   */
  onModuleDestroy(): void {
    for (const state of this.executions.values()) {
      this.stopExecution(state);
    }
    this.executions.clear();
  }

  private async runExecution(
    runId: string,
    state: ExecutionState,
  ): Promise<void> {
    try {
      await this.execute(runId, state);
    } catch (error) {
      if (state.stopped || error instanceof RunStoppedError) {
        return;
      }

      await this.recordTechnicalFailure(runId, error);
    } finally {
      state.timer?.cancel();
      state.timer = null;
      state.rejectWait = null;
    }
  }

  private async execute(runId: string, state: ExecutionState): Promise<void> {
    // Starting is also scheduled, so a terminal status committed immediately
    // after POST observes no further writes from this executor.
    await this.wait(state, START_DELAY_MS);

    const run = await this.loadRun(runId);
    if (!run || run.status !== RunStatus.RUNNING) {
      return;
    }

    const plannedSteps = this.prepareRun(run);

    for (const plannedStep of plannedSteps) {
      if (state.stopped) {
        throw new RunStoppedError();
      }

      const startedAt = this.scheduler.now();
      const started = await this.beginStep(runId, plannedStep.step, startedAt);
      if (!started) {
        return;
      }

      const stepStartedMonotonic = this.scheduler.monotonicMs();
      for (const sample of plannedStep.samples) {
        await this.wait(state, plannedStep.step.intervalMs);

        if (state.stopped) {
          throw new RunStoppedError();
        }

        const recordedAt = this.scheduler.now();
        const elapsedMs = Math.max(
          0,
          Math.round(this.scheduler.monotonicMs() - stepStartedMonotonic),
        );
        const recorded = await this.recordSample(
          runId,
          plannedStep.step,
          sample,
          recordedAt,
          elapsedMs,
        );
        if (!recorded) {
          return;
        }

        // Shutdown or cancellation may have been signalled while this sample
        // was committing. The sample itself stays committed only if its
        // transaction won the row lock, but no further step may start.
        if (state.stopped) {
          throw new RunStoppedError();
        }
      }

      if (state.stopped) {
        throw new RunStoppedError();
      }

      const completed = await this.completeStep(runId, plannedStep.step);
      if (!completed) {
        return;
      }
    }

    if (state.stopped) {
      throw new RunStoppedError();
    }

    await this.completeRun(runId);
  }

  private async loadRun(runId: string): Promise<LoadedRun | null> {
    const run = await this.prisma.testRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        scenario: true,
        seed: true,
        errorProbability: true,
        failureStepId: true,
        simulatorVersion: true,
        status: true,
        expectedSampleCount: true,
        recordedSampleCount: true,
        startedAt: true,
        steps: {
          orderBy: { position: 'asc' },
          select: {
            id: true,
            logicalStepId: true,
            position: true,
            name: true,
            unit: true,
            minimum: true,
            maximum: true,
            sampleCount: true,
            intervalMs: true,
            status: true,
            outcome: true,
            recordedCount: true,
            outOfToleranceCount: true,
            firstFailureSampleIndex: true,
            startedAt: true,
          },
        },
      },
    });

    if (!run) {
      return null;
    }

    return {
      ...run,
      errorProbability: run.errorProbability?.toFixed(6) ?? null,
      steps: run.steps.map((step) => ({
        ...step,
        minimum: step.minimum.toFixed(6),
        maximum: step.maximum.toFixed(6),
      })),
    };
  }

  /**
   * Generates the complete deterministic sample sequence before the first
   * write. A simulator input/output problem is therefore a technical failure,
   * never a tolerance failure and never a partially generated step stream.
   */
  private prepareRun(run: LoadedRun): PlannedStep[] {
    if (run.simulatorVersion !== SIMULATOR_VERSION) {
      throw new RunPreparationError(
        'SIMULATOR_VERSION_MISMATCH',
        'The run was created with a different simulator version.',
      );
    }

    const definitions: SimulatorStepDefinition[] = run.steps.map((step) => ({
      logicalStepId: step.logicalStepId,
      name: step.name,
      unit: step.unit,
      minimum: step.minimum,
      maximum: step.maximum,
      sampleCount: step.sampleCount,
      intervalMs: step.intervalMs,
    }));

    let result: ReturnType<typeof simulate>;
    try {
      result = simulate(this.simulationInput(run, definitions));
    } catch (error) {
      if (error instanceof SimulatorInputError) {
        throw new RunPreparationError(
          'SIMULATOR_INPUT_INVALID',
          'The stored snapshot is not valid simulator input.',
        );
      }
      throw error;
    }

    if (result.simulatorVersion !== SIMULATOR_VERSION) {
      throw new RunPreparationError(
        'SIMULATOR_OUTPUT_INVALID',
        'The simulator returned an unexpected version marker.',
      );
    }

    if (result.steps.length !== run.steps.length) {
      throw new RunPreparationError(
        'SIMULATOR_OUTPUT_INVALID',
        'The simulator did not return every snapshot step.',
      );
    }

    let expectedSampleCount = 0;
    const planned = run.steps.map((step, stepIndex) => {
      const simulatedStep = result.steps[stepIndex];
      if (
        !simulatedStep ||
        simulatedStep.logicalStepId !== step.logicalStepId
      ) {
        throw new RunPreparationError(
          'SIMULATOR_OUTPUT_INVALID',
          'The simulator returned a different step order.',
        );
      }

      const bounds = parseToleranceBounds(step.minimum, step.maximum);
      const samples = simulatedStep.samples.map((sample, sampleIndex) => {
        if (sample.sampleIndex !== sampleIndex) {
          throw new RunPreparationError(
            'SIMULATOR_OUTPUT_INVALID',
            'The simulator skipped or duplicated a sample index.',
          );
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
        throw new RunPreparationError(
          'SIMULATOR_OUTPUT_INVALID',
          'The simulator returned a different sample count.',
        );
      }

      expectedSampleCount += samples.length;
      return { step, samples };
    });

    if (expectedSampleCount !== run.expectedSampleCount) {
      throw new RunPreparationError(
        'SIMULATOR_OUTPUT_INVALID',
        'The run expected sample count does not match its steps.',
      );
    }

    return planned;
  }

  private simulationInput(
    run: LoadedRun,
    steps: readonly SimulatorStepDefinition[],
  ): SimulationInput {
    const seed = Number(run.seed);

    switch (run.scenario) {
      case RunScenario.NORMAL:
        return { scenario: 'NORMAL', seed, steps };

      case RunScenario.FORCED_FAILURE:
        if (!run.failureStepId) {
          throw new RunPreparationError(
            'SIMULATOR_INPUT_INVALID',
            'A forced-failure run must name a failure step.',
          );
        }
        return {
          scenario: 'FORCED_FAILURE',
          seed,
          failureStepId: run.failureStepId,
          steps,
        };

      case RunScenario.RANDOM:
        if (!run.errorProbability) {
          throw new RunPreparationError(
            'SIMULATOR_INPUT_INVALID',
            'A random run must carry an error probability.',
          );
        }
        return {
          scenario: 'RANDOM',
          seed,
          errorProbability: run.errorProbability,
          steps,
        };

      default:
        throw new RunPreparationError(
          'SIMULATOR_INPUT_INVALID',
          'The run has an unknown scenario.',
        );
    }
  }

  private async beginStep(
    runId: string,
    step: LoadedRunStep,
    startedAt: Date,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.testRun.updateMany({
        where: { id: runId, status: RunStatus.RUNNING },
        data: { eventSequence: { increment: 1 } },
      });
      if (locked.count !== 1) {
        return false;
      }

      const run = await tx.testRun.findUniqueOrThrow({
        where: { id: runId },
        select: {
          eventSequence: true,
          recordedSampleCount: true,
          expectedSampleCount: true,
        },
      });

      const updated = await tx.runStep.updateMany({
        where: {
          id: step.id,
          runId,
          status: RunStepStatus.PENDING,
        },
        data: {
          status: RunStepStatus.RUNNING,
          startedAt,
        },
      });
      if (updated.count !== 1) {
        throw new RunExecutionStateError(
          'The next step is not in the PENDING state.',
        );
      }

      await tx.runEvent.create({
        data: {
          runId,
          sequence: run.eventSequence,
          type: RunEventType.STEP_STARTED,
          schemaVersion: RUN_EVENT_SCHEMA_VERSION,
          occurredAt: startedAt,
          payload: {
            stepId: step.id,
            logicalStepId: step.logicalStepId,
            position: step.position,
            name: step.name,
            unit: step.unit,
            minimum: step.minimum,
            maximum: step.maximum,
            sampleCount: step.sampleCount,
            intervalMs: step.intervalMs,
            status: RunStepStatus.RUNNING,
            startedAt: startedAt.toISOString(),
            recordedSampleCount: run.recordedSampleCount,
            expectedSampleCount: run.expectedSampleCount,
          },
        },
      });

      return true;
    }, TRANSACTION_OPTIONS);
  }

  private async recordSample(
    runId: string,
    step: LoadedRunStep,
    sample: PlannedSample,
    recordedAt: Date,
    elapsedMs: number,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.testRun.updateMany({
        where: { id: runId, status: RunStatus.RUNNING },
        data: {
          eventSequence: { increment: 1 },
          recordedSampleCount: { increment: 1 },
        },
      });
      if (locked.count !== 1) {
        return false;
      }

      const run = await tx.testRun.findUniqueOrThrow({
        where: { id: runId },
        select: {
          eventSequence: true,
          recordedSampleCount: true,
          expectedSampleCount: true,
        },
      });
      if (run.recordedSampleCount > run.expectedSampleCount) {
        throw new RunExecutionStateError(
          'A sample would exceed the expected sample count.',
        );
      }

      const current = await tx.runStep.findUniqueOrThrow({
        where: { id: step.id },
        select: {
          status: true,
          recordedCount: true,
          sampleCount: true,
          outOfToleranceCount: true,
          firstFailureSampleIndex: true,
        },
      });

      if (
        current.status !== RunStepStatus.RUNNING ||
        current.recordedCount !== sample.sampleIndex
      ) {
        throw new RunExecutionStateError(
          'The next sample index does not match the step counters.',
        );
      }

      const failure = advanceFailureProgress(
        {
          outOfToleranceCount: current.outOfToleranceCount,
          firstFailureSampleIndex: current.firstFailureSampleIndex,
        },
        sample.sampleIndex,
        sample.isWithinTolerance,
      );

      const updated = await tx.runStep.updateMany({
        where: {
          id: step.id,
          runId,
          status: RunStepStatus.RUNNING,
          recordedCount: sample.sampleIndex,
        },
        data: {
          recordedCount: { increment: 1 },
          outOfToleranceCount: failure.outOfToleranceCount,
          firstFailureSampleIndex: failure.firstFailureSampleIndex,
        },
      });
      if (updated.count !== 1) {
        throw new RunExecutionStateError(
          'The sample could not be written in sequence.',
        );
      }

      await tx.measurement.create({
        data: {
          runId,
          runStepId: step.id,
          sampleIndex: sample.sampleIndex,
          value: sample.value,
          isWithinTolerance: sample.isWithinTolerance,
          recordedAt,
          elapsedMs,
        },
      });

      await tx.runEvent.create({
        data: {
          runId,
          sequence: run.eventSequence,
          type: RunEventType.MEASUREMENT_RECORDED,
          schemaVersion: RUN_EVENT_SCHEMA_VERSION,
          occurredAt: recordedAt,
          payload: {
            stepId: step.id,
            logicalStepId: step.logicalStepId,
            position: step.position,
            sampleIndex: sample.sampleIndex,
            value: sample.value,
            isWithinTolerance: sample.isWithinTolerance,
            recordedAt: recordedAt.toISOString(),
            elapsedMs,
            recordedCount: sample.sampleIndex + 1,
            outOfToleranceCount: failure.outOfToleranceCount,
            firstFailureSampleIndex: failure.firstFailureSampleIndex,
            hasOutOfTolerance: failure.outOfToleranceCount > 0,
            recordedSampleCount: run.recordedSampleCount,
            expectedSampleCount: run.expectedSampleCount,
          },
        },
      });

      return true;
    }, TRANSACTION_OPTIONS);
  }

  private async completeStep(
    runId: string,
    step: LoadedRunStep,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.testRun.updateMany({
        where: { id: runId, status: RunStatus.RUNNING },
        data: { eventSequence: { increment: 1 } },
      });
      if (locked.count !== 1) {
        return false;
      }

      const run = await tx.testRun.findUniqueOrThrow({
        where: { id: runId },
        select: {
          eventSequence: true,
          recordedSampleCount: true,
          expectedSampleCount: true,
          startedAt: true,
        },
      });

      const current = await tx.runStep.findUniqueOrThrow({
        where: { id: step.id },
        select: {
          status: true,
          sampleCount: true,
          recordedCount: true,
          outOfToleranceCount: true,
          firstFailureSampleIndex: true,
          startedAt: true,
        },
      });

      if (
        current.status !== RunStepStatus.RUNNING ||
        current.recordedCount !== current.sampleCount
      ) {
        throw new RunExecutionStateError(
          'A step cannot complete before all of its samples exist.',
        );
      }

      const measurements = await tx.measurement.findMany({
        where: { runStepId: step.id },
        orderBy: { sampleIndex: 'asc' },
        select: {
          sampleIndex: true,
          value: true,
          isWithinTolerance: true,
        },
      });
      if (measurements.length !== current.sampleCount) {
        throw new RunExecutionStateError(
          'The stored measurement count does not match the step.',
        );
      }

      const scaledValues: bigint[] = [];
      let outOfToleranceCount = 0;
      let firstFailureSampleIndex: number | null = null;

      for (const [index, measurement] of measurements.entries()) {
        if (measurement.sampleIndex !== index) {
          throw new RunExecutionStateError(
            'The stored sample indexes are not a gap-free sequence.',
          );
        }

        const scaled = parseMeasurementDecimal(measurement.value.toFixed(6));
        if (scaled === null) {
          throw new RunExecutionStateError(
            'A stored measurement is outside the decimal contract.',
          );
        }
        scaledValues.push(scaled);

        if (!measurement.isWithinTolerance) {
          outOfToleranceCount += 1;
          firstFailureSampleIndex ??= index;
        }
      }

      if (
        outOfToleranceCount !== current.outOfToleranceCount ||
        firstFailureSampleIndex !== current.firstFailureSampleIndex
      ) {
        throw new RunExecutionStateError(
          'The preserved failure state does not match the stored samples.',
        );
      }

      const statistics = calculateStatistics(scaledValues);
      const outcome = stepOutcome(
        current.outOfToleranceCount,
        current.recordedCount,
      );
      const finishedAt = this.finishedAt(run.startedAt);

      await tx.runStep.update({
        where: { id: step.id },
        data: {
          status: RunStepStatus.COMPLETED,
          outcome,
          finishedAt,
          statistics: statisticsPayload(statistics),
        },
      });

      await tx.runEvent.create({
        data: {
          runId,
          sequence: run.eventSequence,
          type: RunEventType.STEP_COMPLETED,
          schemaVersion: RUN_EVENT_SCHEMA_VERSION,
          occurredAt: finishedAt,
          payload: {
            stepId: step.id,
            logicalStepId: step.logicalStepId,
            position: step.position,
            status: RunStepStatus.COMPLETED,
            outcome,
            recordedCount: current.recordedCount,
            outOfToleranceCount: current.outOfToleranceCount,
            firstFailureSampleIndex: current.firstFailureSampleIndex,
            hasOutOfTolerance: current.outOfToleranceCount > 0,
            statistics: statisticsPayload(statistics),
            startedAt: current.startedAt?.toISOString() ?? null,
            finishedAt: finishedAt.toISOString(),
            recordedSampleCount: run.recordedSampleCount,
            expectedSampleCount: run.expectedSampleCount,
          },
        },
      });

      return true;
    }, TRANSACTION_OPTIONS);
  }

  private async completeRun(runId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.testRun.updateMany({
        where: { id: runId, status: RunStatus.RUNNING },
        data: { eventSequence: { increment: 1 } },
      });
      if (locked.count !== 1) {
        return false;
      }

      const run = await tx.testRun.findUniqueOrThrow({
        where: { id: runId },
        select: {
          eventSequence: true,
          recordedSampleCount: true,
          expectedSampleCount: true,
          startedAt: true,
        },
      });
      const steps = await tx.runStep.findMany({
        where: { runId },
        orderBy: { position: 'asc' },
        select: {
          position: true,
          status: true,
          outcome: true,
          recordedCount: true,
          sampleCount: true,
        },
      });

      if (run.recordedSampleCount !== run.expectedSampleCount) {
        throw new RunExecutionStateError(
          'A run cannot complete with missing samples.',
        );
      }
      if (steps.length === 0) {
        throw new RunExecutionStateError(
          'A run must contain at least one step.',
        );
      }

      for (const step of steps) {
        if (
          step.status !== RunStepStatus.COMPLETED ||
          step.outcome === null ||
          step.recordedCount !== step.sampleCount
        ) {
          throw new RunExecutionStateError(
            'Every step must complete before the run can complete.',
          );
        }
      }

      const outcome = runOutcome(
        steps.map((step) => step.outcome),
        run.recordedSampleCount,
        run.expectedSampleCount,
      );
      const finishedAt = this.finishedAt(run.startedAt);
      const passedStepCount = steps.filter(
        (step) => step.outcome === RunOutcome.PASSED,
      ).length;

      await tx.testRun.update({
        where: { id: runId },
        data: {
          status: RunStatus.COMPLETED,
          outcome,
          finishedAt,
        },
      });

      await tx.runEvent.create({
        data: {
          runId,
          sequence: run.eventSequence,
          type: RunEventType.RUN_COMPLETED,
          schemaVersion: RUN_EVENT_SCHEMA_VERSION,
          occurredAt: finishedAt,
          payload: {
            status: RunStatus.COMPLETED,
            outcome,
            recordedSampleCount: run.recordedSampleCount,
            expectedSampleCount: run.expectedSampleCount,
            stepCount: steps.length,
            passedStepCount,
            failedStepCount: steps.length - passedStepCount,
            finishedAt: finishedAt.toISOString(),
          },
        },
      });

      return true;
    }, TRANSACTION_OPTIONS);
  }

  /**
   * Minimal technical-failure safety for P3-05. P3-08 owns shutdown recovery;
   * this path only prevents an unexpected throw from leaving RUNNING forever.
   */
  private async recordTechnicalFailure(
    runId: string,
    error: unknown,
  ): Promise<void> {
    const reasonCode = reasonCodeFor(error);
    this.logger.error(
      `Run ${runId} execution failed (${reasonCode}).`,
      undefined,
      RunExecutor.name,
    );

    try {
      await this.prisma.$transaction(async (tx) => {
        const existing = await tx.testRun.findUnique({
          where: { id: runId },
          select: { startedAt: true },
        });
        if (!existing) {
          return;
        }

        const finishedAt = this.finishedAt(existing.startedAt);
        const locked = await tx.testRun.updateMany({
          where: { id: runId, status: RunStatus.RUNNING },
          data: {
            eventSequence: { increment: 1 },
            status: RunStatus.ERROR,
            outcome: null,
            finishedAt,
            reasonCode,
          },
        });
        if (locked.count !== 1) {
          return;
        }

        const run = await tx.testRun.findUniqueOrThrow({
          where: { id: runId },
          select: {
            eventSequence: true,
            recordedSampleCount: true,
            expectedSampleCount: true,
          },
        });

        await tx.runStep.updateMany({
          where: { runId, status: RunStepStatus.RUNNING },
          data: {
            status: RunStepStatus.ERROR,
            outcome: null,
            finishedAt,
          },
        });
        await tx.runStep.updateMany({
          where: { runId, status: RunStepStatus.PENDING },
          data: {
            status: RunStepStatus.NOT_RUN,
            outcome: null,
          },
        });

        await tx.runEvent.create({
          data: {
            runId,
            sequence: run.eventSequence,
            type: RunEventType.RUN_ERRORED,
            schemaVersion: RUN_EVENT_SCHEMA_VERSION,
            occurredAt: finishedAt,
            payload: {
              status: RunStatus.ERROR,
              reasonCode,
              recordedSampleCount: run.recordedSampleCount,
              expectedSampleCount: run.expectedSampleCount,
              finishedAt: finishedAt.toISOString(),
            },
          },
        });
      }, TRANSACTION_OPTIONS);
    } catch {
      // A database that cannot record the failure leaves the row for P3-08
      // recovery. Never print driver errors: they may contain SQL or the DSN.
      this.logger.error(
        `Run ${runId} could not be marked ERROR; recovery is required.`,
        undefined,
        RunExecutor.name,
      );
    }
  }

  private wait(state: ExecutionState, delayMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (state.stopped) {
        reject(new RunStoppedError());
        return;
      }

      state.rejectWait = reject;
      state.timer = this.scheduler.setTimeout(() => {
        state.timer = null;
        state.rejectWait = null;

        if (state.stopped) {
          reject(new RunStoppedError());
          return;
        }

        resolve();
      }, delayMs);
    });
  }

  private stopExecution(state: ExecutionState): void {
    state.stopped = true;
    state.timer?.cancel();
    state.timer = null;
    state.rejectWait?.(new RunStoppedError());
    state.rejectWait = null;
  }

  /** A terminal timestamp must never precede the run's start timestamp. */
  private finishedAt(startedAt: Date): Date {
    const now = this.scheduler.now();
    return now.getTime() >= startedAt.getTime() ? now : startedAt;
  }
}

function statisticsPayload(statistics: StepStatistics): Prisma.InputJsonObject {
  return {
    minimum: statistics.minimum,
    maximum: statistics.maximum,
    average: statistics.average,
    sampleCount: statistics.sampleCount,
  };
}

function reasonCodeFor(error: unknown): TechnicalReasonCode {
  if (error instanceof RunPreparationError) {
    return error.reasonCode;
  }
  if (error instanceof MeasurementValidationError) {
    return error.code === 'INVALID_MEASUREMENT_VALUE'
      ? 'SIMULATOR_OUTPUT_INVALID'
      : 'EXECUTION_STATE_INVALID';
  }
  if (error instanceof SimulatorInputError) {
    return 'SIMULATOR_INPUT_INVALID';
  }
  if (error instanceof RunExecutionStateError) {
    return 'EXECUTION_STATE_INVALID';
  }

  return 'EXECUTION_FAILED';
}
