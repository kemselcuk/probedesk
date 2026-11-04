import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ApiException } from '../common/errors/api.exception.js';
import { ValidationFailedException } from '../common/errors/validation.exception.js';
import { Prisma } from '../prisma/generated/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { isTerminalRunStatus } from '../runs/run-domain.js';
import {
  RUN_SNAPSHOT_SELECT,
  type RunSnapshotRow,
} from '../runs/run-snapshot-read.js';
import { buildRunComparison } from './comparison-builder.js';
import type { ComparisonQueryDto } from './dto/comparison-query.dto.js';
import type { RunComparisonDto } from './dto/comparison.dto.js';

/**
 * Both rows, their steps and measurements are read in one REPEATABLE READ
 * transaction. The terminal/plan checks therefore describe exactly the data
 * returned, even when another request or the executor is writing.
 */
const COMPARISON_TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  timeout: 10_000,
  maxWait: 5_000,
} as const;

@Injectable()
export class ComparisonsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async compare(query: ComparisonQueryDto): Promise<RunComparisonDto> {
    // UUIDs are case-insensitive on the wire, but PostgreSQL returns the
    // canonical lowercase form. Normalise both before the Map lookup, the
    // same-run check and the response comparisons.
    const leftRunId = query.leftRunId.toLowerCase();
    const rightRunId = query.rightRunId.toLowerCase();

    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.testRun.findMany({
        where: { id: { in: [leftRunId, rightRunId] } },
        select: RUN_SNAPSHOT_SELECT,
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      const left = byId.get(leftRunId);
      const right = byId.get(rightRunId);

      // Unknown ids are indistinguishable from inaccessible ones.
      if (!left || !right) {
        throw notFound();
      }

      // Terminality is checked before the identity/plan rules so a RUNNING
      // self-comparison also reports RUN_NOT_TERMINAL.
      if (
        !isTerminalRunStatus(left.status) ||
        !isTerminalRunStatus(right.status)
      ) {
        throw runNotTerminal(left, right);
      }

      if (leftRunId === rightRunId) {
        throw sameRun();
      }

      if (left.planId !== right.planId) {
        throw planMismatch(left, right);
      }

      return buildRunComparison(left, right);
    }, COMPARISON_TRANSACTION_OPTIONS);
  }
}

function notFound(): ApiException {
  return new ApiException(
    HttpStatus.NOT_FOUND,
    'NOT_FOUND',
    'The requested resource was not found.',
  );
}

function runNotTerminal(
  left: RunSnapshotRow,
  right: RunSnapshotRow,
): ApiException {
  return new ApiException(
    HttpStatus.CONFLICT,
    'RUN_NOT_TERMINAL',
    'Both runs must reach a terminal status before they can be compared.',
    {
      details: {
        leftStatus: left.status,
        rightStatus: right.status,
      },
    },
  );
}

function sameRun(): ApiException {
  return new ValidationFailedException([
    {
      path: 'rightRunId',
      code: 'INVALID_VALUE',
      message: 'rightRunId must differ from leftRunId',
    },
  ]);
}

function planMismatch(
  left: RunSnapshotRow,
  right: RunSnapshotRow,
): ApiException {
  return new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'COMPARISON_PLAN_MISMATCH',
    'Both runs must belong to the same plan.',
    {
      details: {
        leftPlanId: left.planId,
        rightPlanId: right.planId,
      },
    },
  );
}
