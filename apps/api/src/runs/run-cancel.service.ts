import { Inject, Injectable } from '@nestjs/common';
import {
  RunEventType,
  RunStatus,
  RunStepStatus,
} from '../prisma/generated/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  RUN_CANCELLED_REASON_CODE,
  RUN_EVENT_SCHEMA_VERSION,
} from './run-domain.js';
import { RunExecutor } from './run-executor.js';
import { RunSnapshotService } from './run-snapshot.service.js';
import type { RunSnapshotDto } from './dto/run-snapshot.dto.js';

const TRANSACTION_OPTIONS = { timeout: 10_000, maxWait: 5_000 } as const;

/**
 * Cancels the one running run. The TestRun row is locked by a conditional
 * UPDATE, so a cancel racing completion, a sample write or another cancel sees
 * exactly the state committed by whichever transaction acquired the row first.
 *
 * A terminal run is never modified: the current snapshot is returned unchanged
 * and the operation is safe to repeat.
 */
@Injectable()
export class RunCancellationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RunExecutor) private readonly executor: RunExecutor,
    @Inject(RunSnapshotService)
    private readonly snapshotService: RunSnapshotService,
  ) {}

  /** Returns null only when the run id does not exist. */
  async cancel(
    runId: string,
    cancelledById: string,
  ): Promise<RunSnapshotDto | null> {
    await this.prisma.$transaction(async (tx) => {
      // Lock first, then timestamp. If a step completion or run finalization
      // already holds the row lock, this transaction waits for it and computes
      // finishedAt after that commit, so terminal timestamps and event times
      // follow commit order (B7). A run finalized by another actor is left
      // exactly as committed.
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
          status: RunStatus.CANCELLED,
          outcome: null,
          finishedAt,
          cancelledById,
          reasonCode: RUN_CANCELLED_REASON_CODE,
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

      // A step that has started is cancelled in place. Its already committed
      // samples and counters remain; an unfinished step has no statistics or
      // outcome. Steps that never started become NOT_RUN.
      const cancelledSteps = await tx.runStep.updateMany({
        where: { runId, status: RunStepStatus.RUNNING },
        data: {
          status: RunStepStatus.CANCELLED,
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
          type: RunEventType.RUN_CANCELLED,
          schemaVersion: RUN_EVENT_SCHEMA_VERSION,
          occurredAt: finishedAt,
          payload: {
            status: RunStatus.CANCELLED,
            reasonCode: RUN_CANCELLED_REASON_CODE,
            cancelledById,
            recordedSampleCount: run.recordedSampleCount,
            expectedSampleCount: run.expectedSampleCount,
            cancelledStepCount: cancelledSteps.count,
            notRunStepCount: notRunSteps.count,
            finishedAt: finishedAt.toISOString(),
          },
        },
      });
    }, TRANSACTION_OPTIONS);

    // The terminal state is committed, so no write from the old execution can
    // succeed any more. Stopping the timer/waiter is only about prompt cleanup.
    this.executor.cancel(runId);

    return this.snapshotService.findById(runId);
  }
}

/** A terminal timestamp must never precede the run's start timestamp. */
function terminalTimestamp(startedAt: Date): Date {
  const now = new Date();
  return now.getTime() >= startedAt.getTime() ? now : startedAt;
}
