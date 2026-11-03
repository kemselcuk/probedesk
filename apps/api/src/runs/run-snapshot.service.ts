import { Inject, Injectable } from '@nestjs/common';
import { Prisma, RunStatus } from '../prisma/generated/client.js';
import type { TestRunGetPayload } from '../prisma/generated/models/TestRun.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  RunActiveDto,
  type RunSnapshotDto,
} from './dto/run-snapshot.dto.js';
import {
  RUN_SNAPSHOT_SELECT,
  toRunSnapshotDto,
} from './run-snapshot-read.js';

/** A single run read must never take longer than a normal API request. */
const SNAPSHOT_TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  timeout: 10_000,
  maxWait: 5_000,
} as const;

/**
 * The idle/active summary read. It never loads step or measurement arrays.
 * Full snapshot reads share the immutable select in run-snapshot-read.ts.
 */
const ACTIVE_SELECT = {
  id: true,
  planNameSnapshot: true,
  versionNumberSnapshot: true,
  status: true,
  expectedSampleCount: true,
  recordedSampleCount: true,
  startedAt: true,
  scenario: true,
} satisfies Prisma.TestRunSelect;

type ActiveRow = TestRunGetPayload<{ select: typeof ACTIVE_SELECT }>;

@Injectable()
export class RunSnapshotService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Returns the single RUNNING run summary, or an explicit null when idle.
   * PostgreSQL holds at most one RUNNING row through its partial unique index.
   */
  async findActive(): Promise<RunActiveDto | null> {
    const run = await this.prisma.testRun.findFirst({
      where: { status: RunStatus.RUNNING },
      orderBy: { startedAt: 'desc' },
      select: ACTIVE_SELECT,
    });

    return run ? toActiveDto(run) : null;
  }

  /** Returns null for an unknown id; the controller maps that to a safe 404. */
  async findById(runId: string): Promise<RunSnapshotDto | null> {
    return this.prisma.$transaction(async (tx) => {
      const run = await tx.testRun.findUnique({
        where: { id: runId },
        select: RUN_SNAPSHOT_SELECT,
      });

      return run ? toRunSnapshotDto(run) : null;
    }, SNAPSHOT_TRANSACTION_OPTIONS);
  }
}

function toActiveDto(run: ActiveRow): RunActiveDto {
  return {
    runId: run.id,
    planName: run.planNameSnapshot,
    versionNumber: run.versionNumberSnapshot,
    status: run.status,
    expectedSampleCount: run.expectedSampleCount,
    recordedSampleCount: run.recordedSampleCount,
    startedAt: run.startedAt.toISOString(),
    scenario: run.scenario,
  };
}
