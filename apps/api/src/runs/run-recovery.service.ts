import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import {
  Prisma,
  RunEventType,
  RunStatus,
  RunStepStatus,
} from '../prisma/generated/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  RUN_EVENT_SCHEMA_VERSION,
  RUN_INTERRUPTED_REASON_CODE,
} from './run-domain.js';

const TRANSACTION_OPTIONS = { timeout: 10_000, maxWait: 5_000 } as const;

/**
 * Closes runs left RUNNING by a previous API process. The supported deployment
 * has one API process, so every RUNNING row found during startup is orphaned.
 *
 * Recovery is deliberately conservative: it never resumes a run, never
 * deletes measurements and never changes an already terminal row. The active
 * step becomes INTERRUPTED, steps that never started become NOT_RUN, and one
 * run.interrupted event is appended per recovered run.
 *
 * Readiness calls ensureCompleted() after the database and migration checks.
 * The first successful pass is cached; a failed pass is retried on the next
 * readiness request so a database that comes back can finish reconciliation
 * without a restart. Until then readiness and new run starts stay unavailable.
 *
 * A cached success is invalidated by `markDirty()`. The executor calls it when
 * a technical failure could not be persisted (for example during a database
 * outage), which leaves a RUNNING row behind. Readiness and starts then run
 * recovery again instead of trusting the stale success forever.
 */
@Injectable()
export class RunRecoveryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RunRecoveryService.name);
  private completed = false;
  private dirty = false;
  private generation = 0;
  private inFlight: Promise<boolean> | null = null;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    const ready = await this.ensureCompleted();
    if (!ready) {
      this.logger.warn(
        'Startup recovery is incomplete; readiness remains unavailable.',
      );
    }
  }

  /** True once every leftover RUNNING run has been reconciled. */
  get isComplete(): boolean {
    return this.completed && !this.dirty;
  }

  /** True when a later success must not be treated as the cached final pass. */
  get isDirty(): boolean {
    return this.dirty;
  }

  /**
   * Invalidates a cached success because this process knows it left a RUNNING
   * row that no recovery pass has reconciled yet. Any recovery already in
   * flight cannot clear this generation.
   */
  markDirty(): void {
    this.dirty = true;
    this.completed = false;
    this.generation += 1;
  }

  /**
   * Runs recovery at most once concurrently and returns whether it is
   * complete. It never rejects: callers only choose between ready and 503, and
   * the driver error text is never logged or returned.
   */
  ensureCompleted(): Promise<boolean> {
    if (this.completed && !this.dirty) {
      return Promise.resolve(true);
    }

    if (!this.inFlight) {
      this.inFlight = this.recover()
        .catch(() => {
          this.logger.warn(
            'Startup recovery failed; readiness remains unavailable.',
          );
          return false;
        })
        .finally(() => {
          this.inFlight = null;
        });
    }

    return this.inFlight;
  }

  private async recover(): Promise<boolean> {
    const generation = this.generation;

    try {
      await this.prisma.assertMigrationsApplied();
    } catch {
      // Readiness already explains an unmigrated or unreachable database. The
      // recovery pass only reports that it is not complete.
      return false;
    }

    let runningRuns: Array<{ id: string }>;
    try {
      runningRuns = await this.prisma.testRun.findMany({
        where: { status: RunStatus.RUNNING },
        select: { id: true },
        orderBy: { startedAt: 'asc' },
      });
    } catch (error) {
      if (isMissingSchemaObject(error)) {
        // The migration manifest can be marked applied while a test database
        // has no run tables. There cannot be old runs without those tables.
        // A dirty mark that arrived during this pass still wins.
        return this.finishPass(generation);
      }
      return false;
    }

    for (const run of runningRuns) {
      await this.recoverRun(run.id);
    }

    return this.finishPass(generation);
  }

  /**
   * Caches the pass only when no dirty mark or newer pass invalidated it while
   * it was running. A database that came back is thereby reconciled before
   * readiness or a new start is allowed.
   */
  private finishPass(generation: number): boolean {
    if (this.generation !== generation) {
      this.dirty = true;
      this.completed = false;
      return false;
    }

    this.completed = true;
    this.dirty = false;
    return true;
  }

  private async recoverRun(runId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Lock first, then timestamp: the interrupted run's finishedAt and the
      // event time follow commit order (B7). A run finalized by another actor
      // is left exactly as committed.
      const current = await tx.$queryRaw<
        Array<{ status: RunStatus; startedAt: Date }>
      >`
        SELECT "status", "startedAt"
        FROM "test_runs"
        WHERE "id" = ${runId}::uuid
        FOR UPDATE
      `;
      const row = current[0];
      if (!row || row.status !== RunStatus.RUNNING) {
        return;
      }

      const finishedAt = terminalTimestamp(row.startedAt);
      const transitioned = await tx.testRun.updateMany({
        where: { id: runId, status: RunStatus.RUNNING },
        data: {
          eventSequence: { increment: 1 },
          status: RunStatus.INTERRUPTED,
          outcome: null,
          finishedAt,
          reasonCode: RUN_INTERRUPTED_REASON_CODE,
        },
      });
      if (transitioned.count !== 1) {
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

      const interruptedSteps = await tx.runStep.updateMany({
        where: { runId, status: RunStepStatus.RUNNING },
        data: {
          status: RunStepStatus.INTERRUPTED,
          outcome: null,
          finishedAt,
        },
      });
      const notRunSteps = await tx.runStep.updateMany({
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
          type: RunEventType.RUN_INTERRUPTED,
          schemaVersion: RUN_EVENT_SCHEMA_VERSION,
          occurredAt: finishedAt,
          payload: {
            status: RunStatus.INTERRUPTED,
            reasonCode: RUN_INTERRUPTED_REASON_CODE,
            recordedSampleCount: run.recordedSampleCount,
            expectedSampleCount: run.expectedSampleCount,
            interruptedStepCount: interruptedSteps.count,
            notRunStepCount: notRunSteps.count,
            finishedAt: finishedAt.toISOString(),
          },
        },
      });
    }, TRANSACTION_OPTIONS);
  }
}

/** A terminal timestamp must never precede the run's start timestamp. */
function terminalTimestamp(startedAt: Date): Date {
  const now = new Date();
  return now.getTime() >= startedAt.getTime() ? now : startedAt;
}

function isMissingSchemaObject(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2021' || error.code === 'P2022')
  );
}
