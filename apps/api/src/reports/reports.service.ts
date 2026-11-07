import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ApiException } from '../common/errors/api.exception.js';
import { Prisma, type RunStatus } from '../prisma/generated/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { isTerminalRunStatus } from '../runs/run-domain.js';
import { RUN_SNAPSHOT_SELECT } from '../runs/run-snapshot-read.js';
import type { RunReportDto } from './dto/run-report.dto.js';
import { buildRunReport } from './run-report.js';

/**
 * The whole report/export pair uses one short REPEATABLE READ transaction so
 * the run, copied rules, counters, summaries and samples describe a single
 * database snapshot. Terminal snapshot rows are immutable, and a still-RUNNING
 * row is rejected before any projection is built.
 */
const REPORT_TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  timeout: 10_000,
  maxWait: 5_000,
} as const;

@Injectable()
export class ReportsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Returns the versioned terminal-run projection. Unknown ids are a safe 404;
   * RUNNING is 409 RUN_NOT_TERMINAL. CANCELLED, INTERRUPTED and ERROR remain
   * readable with whatever partial data was actually committed.
   */
  async getRunReport(runId: string): Promise<RunReportDto> {
    // PostgreSQL UUID columns are case-insensitive, while the canonical row id
    // is lowercase. Normalising keeps the response and attachment filename
    // stable for an uppercase request.
    const canonicalRunId = runId.toLowerCase();

    return this.prisma.$transaction(async (tx) => {
      const run = await tx.testRun.findUnique({
        where: { id: canonicalRunId },
        select: RUN_SNAPSHOT_SELECT,
      });

      if (!run) {
        throw notFound();
      }

      if (!isTerminalRunStatus(run.status)) {
        throw runNotTerminal(run.status);
      }

      return buildRunReport(run, new Date());
    }, REPORT_TRANSACTION_OPTIONS);
  }
}

function notFound(): ApiException {
  return new ApiException(
    HttpStatus.NOT_FOUND,
    'NOT_FOUND',
    'The requested resource was not found.',
  );
}

function runNotTerminal(status: RunStatus): ApiException {
  return new ApiException(
    HttpStatus.CONFLICT,
    'RUN_NOT_TERMINAL',
    'The run must reach a terminal status before it can be reported or exported.',
    { details: { status } },
  );
}
