import { Inject, Injectable } from '@nestjs/common';
import { ValidationFailedException } from '../common/errors/validation.exception.js';
import { Prisma, RunStatus } from '../prisma/generated/client.js';
import type { TestRunGetPayload } from '../prisma/generated/models/TestRun.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { RunRequestedByDto } from './dto/run-snapshot.dto.js';
import {
  RunFirstFailureDto,
  RunHistoryItemDto,
  RunHistoryPageDto,
} from './dto/run-history.dto.js';
import {
  DEFAULT_RUN_HISTORY_LIMIT,
  DEFAULT_RUN_HISTORY_PAGE,
  type ListRunsQueryDto,
} from './dto/list-runs-query.dto.js';

/**
 * History reads are repeatable so `total` and the page of rows describe the
 * same committed state even while a run or another request writes.
 */
const HISTORY_TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  timeout: 10_000,
  maxWait: 5_000,
} as const;

/**
 * Only copied run/step fields and counters are selected. Measurements are
 * deliberately absent: the history list must never load sample arrays.
 */
const HISTORY_SELECT = {
  id: true,
  planId: true,
  planRevisionId: true,
  planNameSnapshot: true,
  versionNumberSnapshot: true,
  scenario: true,
  seed: true,
  status: true,
  outcome: true,
  startedAt: true,
  finishedAt: true,
  requestedBy: {
    select: { id: true, email: true, role: true },
  },
  steps: {
    orderBy: { position: 'asc' },
    select: {
      position: true,
      name: true,
      logicalStepId: true,
      sampleCount: true,
      recordedCount: true,
      outOfToleranceCount: true,
      firstFailureSampleIndex: true,
    },
  },
} satisfies Prisma.TestRunSelect;

type HistoryRow = TestRunGetPayload<{ select: typeof HISTORY_SELECT }>;

/**
 * Paginated run history. Counts, the aggregate out-of-tolerance count and the
 * first failure are derived from the immutable step rows copied when the run
 * started; the live plan is never consulted.
 */
@Injectable()
export class RunHistoryService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(query: ListRunsQueryDto): Promise<RunHistoryPageDto> {
    const page = query.page ?? DEFAULT_RUN_HISTORY_PAGE;
    const limit = query.limit ?? DEFAULT_RUN_HISTORY_LIMIT;
    const where = buildWhere(query);

    return this.prisma.$transaction(async (tx) => {
      const total = await tx.testRun.count({ where });
      const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

      if (totalPages === 0 || page > totalPages) {
        return { items: [], page, limit, total, totalPages };
      }

      const rows = await tx.testRun.findMany({
        where,
        // UUID ordering as a tie-break makes pagination stable when multiple
        // runs share one startedAt value.
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: HISTORY_SELECT,
      });

      return {
        items: rows.map(toHistoryItem),
        page,
        limit,
        total,
        totalPages,
      };
    }, HISTORY_TRANSACTION_OPTIONS);
  }
}

function buildWhere(query: ListRunsQueryDto): Prisma.TestRunWhereInput {
  const where: Prisma.TestRunWhereInput = {};

  if (query.planId !== undefined) {
    where.planId = query.planId;
  }
  if (query.status !== undefined) {
    where.status = query.status;
  }
  if (query.outcome !== undefined) {
    where.outcome = query.outcome;
  }

  const from = parseBoundary(query.from, 'from');
  const to = parseBoundary(query.to, 'to');

  if (from !== undefined || to !== undefined) {
    where.startedAt = {
      ...(from === undefined ? {} : { gte: from }),
      ...(to === undefined ? {} : { lt: to }),
    };
  }

  return where;
}

/**
 * ValidationPipe already enforces the accepted shape. This second check keeps
 * a malformed value from silently becoming an Invalid Date if a caller invokes
 * the service without the HTTP pipeline.
 */
function parseBoundary(
  value: string | undefined,
  field: string,
): Date | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationFailedException([
      {
        path: field,
        code: 'INVALID_VALUE',
        message: `${field} must be a valid ISO-8601 date`,
      },
    ]);
  }

  return parsed;
}

function toHistoryItem(run: HistoryRow): RunHistoryItemDto {
  let expectedSampleCount = 0;
  let recordedSampleCount = 0;
  let outOfToleranceCount = 0;
  let firstFailure: RunFirstFailureDto | null = null;

  // Steps are already ordered by position. The first step with a recorded
  // out-of-tolerance sample is the earliest failure; its stored sample index
  // preserves the earliest failure inside that step.
  for (const step of run.steps) {
    expectedSampleCount += step.sampleCount;
    recordedSampleCount += step.recordedCount;
    outOfToleranceCount += step.outOfToleranceCount;

    if (firstFailure === null && step.firstFailureSampleIndex !== null) {
      firstFailure = {
        stepPosition: step.position,
        stepName: step.name,
        logicalStepId: step.logicalStepId,
        sampleIndex: step.firstFailureSampleIndex,
      };
    }
  }

  return {
    id: run.id,
    planId: run.planId,
    planVersionId: run.planRevisionId,
    planName: run.planNameSnapshot,
    versionNumber: run.versionNumberSnapshot,
    scenario: run.scenario,
    seed: readSeed(run.seed),
    status: run.status,
    outcome: run.outcome,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    expectedSampleCount,
    recordedSampleCount,
    outOfToleranceCount,
    firstFailure,
    partial:
      run.status !== RunStatus.COMPLETED ||
      recordedSampleCount < expectedSampleCount,
    requestedBy: toRequestedBy(run.requestedBy),
  };
}

function toRequestedBy(user: {
  id: string;
  email: string;
  role: RunRequestedByDto['role'];
}): RunRequestedByDto {
  return { id: user.id, email: user.email, role: user.role };
}

function readSeed(seed: bigint): number {
  const value = Number(seed);

  // The database constrains the seed to uint32; fail closed if a corrupt row
  // could not be represented exactly in JSON.
  if (!Number.isSafeInteger(value)) {
    throw new Error('The stored run seed is outside the JSON integer range.');
  }

  return value;
}
