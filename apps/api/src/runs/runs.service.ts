import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ApiException } from '../common/errors/api.exception.js';
import { ValidationFailedException } from '../common/errors/validation.exception.js';
import {
  PlanRevisionState,
  Prisma,
  RunEventType,
  RunOutcome,
  RunStatus,
} from '../prisma/generated/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SIMULATOR_VERSION } from '../simulator/index.js';
import {
  RUN_EVALUATION_VERSION,
  RUN_EVENT_SCHEMA_VERSION,
} from './run-domain.js';
import {
  buildRunSnapshot,
  RunSnapshotValidationError,
  type RunSnapshotRows,
  type RunSnapshotSource,
} from './run-snapshot.js';
import {
  hashRunStartRequest,
  normalizeIdempotencyKey,
  normalizeRunStart,
  type NormalizedRunStart,
} from './run-start.js';
import { StartRunDto } from './dto/start-run.dto.js';
import { RunStartResponseDto } from './dto/run-start-response.dto.js';

export interface RunStartResult {
  /** True when an existing run was returned for an idempotent retry. */
  replayed: boolean;
  response: RunStartResponseDto;
}

interface ExistingRun {
  id: string;
  status: RunStatus;
  outcome: RunOutcome | null;
  requestHash: string;
}

/** The event sequence assigned to the first committed run event. */
const START_EVENT_SEQUENCE = 1;

@Injectable()
export class RunsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Starts one published revision, or replays an earlier start made with the
   * same user-scoped idempotency key.
   *
   * The run, all rule-copy steps and `run.started` are one transaction. The
   * partial unique index on RUNNING rows is the final guarantee against two
   * concurrent starts; a unique violation is resolved by re-reading the
   * idempotency record first and the active run second.
   */
  async start(
    requestedById: string,
    idempotencyKeyHeader: unknown,
    dto: StartRunDto,
  ): Promise<RunStartResult> {
    const idempotencyKey = normalizeIdempotencyKey(idempotencyKeyHeader);
    const request = normalizeRunStart({
      planVersionId: dto.planVersionId,
      scenario: dto.scenario,
      seed: dto.seed,
      failureStepId: dto.failureStepId,
      errorProbability: dto.errorProbability,
    });
    const requestHash = hashRunStartRequest(request);

    // The existing key is checked before plan validation so a retry after the
    // run became terminal (or after the plan changed) still returns that run.
    const existing = await this.findByKey(requestedById, idempotencyKey);
    if (existing) {
      return replayExisting(existing, requestHash);
    }

    const source = await this.loadPublishedSource(request.planVersionId);
    const startedAt = new Date();
    const snapshot = buildSnapshot(
      source,
      request,
      requestedById,
      idempotencyKey,
      requestHash,
      startedAt,
    );

    try {
      const created = await this.prisma.$transaction(
        async (tx) => {
          const run = await tx.testRun.create({
            data: {
              ...snapshot.run,
              // The run row and its first event commit together.
              eventSequence: START_EVENT_SEQUENCE,
              steps: { create: snapshot.steps },
            },
            select: { id: true, status: true, outcome: true },
          });

          await tx.runEvent.create({
            data: {
              runId: run.id,
              sequence: START_EVENT_SEQUENCE,
              type: RunEventType.RUN_STARTED,
              schemaVersion: RUN_EVENT_SCHEMA_VERSION,
              occurredAt: startedAt,
              payload: {
                status: RunStatus.RUNNING,
                planId: snapshot.run.planId,
                planVersionId: snapshot.run.planRevisionId,
                planName: snapshot.run.planNameSnapshot,
                versionNumber: snapshot.run.versionNumberSnapshot,
                scenario: snapshot.run.scenario,
                expectedSampleCount: snapshot.run.expectedSampleCount,
                stepCount: snapshot.steps.length,
              },
            },
          });

          return run;
        },
        { timeout: 10_000, maxWait: 5_000 },
      );

      return { replayed: false, response: toResponse(created) };
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) {
        throw error;
      }

      // A concurrent request with the same key may have committed first; that
      // is a successful replay, not an active-run conflict. Otherwise the
      // RUNNING partial unique index rejected this start.
      const raced = await this.findByKey(requestedById, idempotencyKey);
      if (raced) {
        return replayExisting(raced, requestHash);
      }

      const active = await this.prisma.testRun.findFirst({
        where: { status: RunStatus.RUNNING },
        select: { id: true },
        orderBy: { startedAt: 'desc' },
      });
      if (active) {
        throw runAlreadyActive(active.id);
      }

      throw error;
    }
  }

  private async findByKey(
    requestedById: string,
    idempotencyKey: string,
  ): Promise<ExistingRun | null> {
    return this.prisma.testRun.findFirst({
      where: { requestedById, idempotencyKey },
      select: {
        id: true,
        status: true,
        outcome: true,
        requestHash: true,
      },
    });
  }

  /** Loads only a PUBLISHED revision; drafts and unknown ids are the same 404. */
  private async loadPublishedSource(
    planVersionId: string,
  ): Promise<RunSnapshotSource> {
    const revision = await this.prisma.planRevision.findFirst({
      where: { id: planVersionId, state: PlanRevisionState.PUBLISHED },
      include: {
        plan: { include: { deviceProfile: true } },
        steps: { orderBy: { position: 'asc' } },
      },
    });

    if (!revision) {
      throw notFound();
    }

    if (revision.versionNumber === null) {
      // The database state check makes this unreachable; fail closed rather
      // than snapshot an impossible published revision.
      throw new Error('A published revision must have a version number.');
    }

    return {
      planId: revision.planId,
      revisionId: revision.id,
      planName: revision.name,
      versionNumber: revision.versionNumber,
      profile: {
        id: revision.plan.deviceProfile.id,
        code: revision.plan.deviceProfile.code,
        name: revision.plan.deviceProfile.name,
        description: revision.plan.deviceProfile.description,
      },
      steps: revision.steps.map((step) => ({
        logicalStepId: step.logicalStepId,
        position: step.position,
        name: step.name,
        unit: step.unit,
        minimum: step.minimum,
        maximum: step.maximum,
        sampleCount: step.sampleCount,
        intervalMs: step.intervalMs,
      })),
    };
  }
}

function replayExisting(
  existing: ExistingRun,
  requestHash: string,
): RunStartResult {
  if (existing.requestHash !== requestHash) {
    throw new ApiException(
      HttpStatus.CONFLICT,
      'IDEMPOTENCY_CONFLICT',
      'The Idempotency-Key was already used with a different request.',
      { details: { reason: 'REQUEST_MISMATCH' } },
    );
  }

  return { replayed: true, response: toResponse(existing) };
}

function buildSnapshot(
  source: RunSnapshotSource,
  request: NormalizedRunStart,
  requestedById: string,
  idempotencyKey: string,
  requestHash: string,
  startedAt: Date,
): RunSnapshotRows {
  try {
    return buildRunSnapshot(
      source,
      {
        scenario: request.scenario,
        seed: BigInt(request.seed),
        errorProbability: request.errorProbability,
        failureStepId: request.failureStepId,
        simulatorVersion: SIMULATOR_VERSION,
        evaluationVersion: RUN_EVALUATION_VERSION,
      },
      { requestedById, idempotencyKey, requestHash, startedAt },
    );
  } catch (error) {
    if (error instanceof RunSnapshotValidationError) {
      throw new ValidationFailedException(
        error.issues.map((issue) => ({
          path: issue.path,
          code: 'INVALID_VALUE',
          message: issue.message,
        })),
      );
    }

    throw error;
  }
}

function toResponse(run: {
  id: string;
  status: RunStatus;
  outcome: RunOutcome | null;
}): RunStartResponseDto {
  return {
    runId: run.id,
    status: run.status,
    outcome: run.outcome,
    snapshotUrl: `/api/runs/${run.id}`,
    eventsUrl: `/api/runs/${run.id}/events`,
  };
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function notFound(): ApiException {
  return new ApiException(
    HttpStatus.NOT_FOUND,
    'NOT_FOUND',
    'The requested resource was not found.',
  );
}

function runAlreadyActive(activeRunId: string): ApiException {
  return new ApiException(
    HttpStatus.CONFLICT,
    'RUN_ALREADY_ACTIVE',
    'Another run is already active. Wait for it to finish before starting a new run.',
    { details: { activeRunId } },
  );
}
