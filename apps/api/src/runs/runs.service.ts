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
import { RunExecutor } from './run-executor.js';
import { RunRecoveryService } from './run-recovery.service.js';
import { RUN_SCHEDULER, type RunScheduler } from './run-scheduler.js';
import {
  buildRunSnapshot,
  RunSnapshotValidationError,
  type RunSnapshotContext,
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
import type { RunDeviceSnapshot } from './run-metadata.js';

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

/**
 * A unique violation can mean that a concurrent winner terminalized before the
 * loser re-read the active row. The loser retries its create transaction so the
 * start request still resolves to 409 or 202 instead of an internal error.
 */
const MAX_START_ATTEMPTS = 3;

@Injectable()
export class RunsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RunExecutor) private readonly runExecutor: RunExecutor,
    @Inject(RunRecoveryService)
    private readonly runRecovery: RunRecoveryService,
    @Inject(RUN_SCHEDULER) private readonly scheduler: RunScheduler,
  ) {}

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
      deviceId: dto.deviceId,
      batchNumber: dto.batchNumber,
    });
    const requestHash = hashRunStartRequest(request);

    // Startup reconciliation must finish before any new work is accepted. A
    // stale RUNNING row would otherwise look like RUN_ALREADY_ACTIVE forever.
    if (!(await this.runRecovery.ensureCompleted())) {
      throw serviceUnavailable();
    }

    // The existing key is checked before plan validation so a retry after the
    // run became terminal (or after the plan changed) still returns that run.
    const existing = await this.findByKey(requestedById, idempotencyKey);
    if (existing) {
      return replayExisting(existing, requestHash);
    }

    const source = await this.loadPublishedSource(request.planVersionId);
    const startedAt = this.scheduler.now();

    let uniqueFailure: unknown = null;

    for (let attempt = 1; attempt <= MAX_START_ATTEMPTS; attempt += 1) {
      try {
        const created = await this.createRun(source, request, {
          requestedById,
          idempotencyKey,
          requestHash,
          startedAt,
        });

        // The snapshot is committed; execution must not be awaited here. A
        // failed/terminated HTTP connection cannot stop the scheduled run.
        this.runExecutor.start(created.id);

        return { replayed: false, response: toResponse(created) };
      } catch (error) {
        if (!isUniqueConstraintViolation(error)) {
          throw error;
        }

        uniqueFailure = error;

        // A concurrent request with the same key may have committed first;
        // that is a successful replay, not an active-run conflict. Otherwise
        // the RUNNING partial unique index rejected this start.
        const raced = await this.findByKey(requestedById, idempotencyKey);
        if (raced) {
          return replayExisting(raced, requestHash);
        }

        const active = await this.findActiveRun();
        if (active) {
          throw runAlreadyActive(active.id);
        }

        // The winner became terminal between its unique-index insert and this
        // request's failure, so no active row is visible. The index slot is
        // free again; retry instead of surfacing a race as a 500.
      }
    }

    // Three consecutive unique violations with no idempotency record and no
    // active run means the database state contradicts the index. Surface the
    // original unexpected error rather than inventing a contract response.
    throw uniqueFailure;
  }

  private async createRun(
    source: RunSnapshotSource,
    request: NormalizedRunStart,
    context: RunSnapshotContext,
  ): Promise<{ id: string; status: RunStatus; outcome: RunOutcome | null }> {
    return this.prisma.$transaction(
      async (tx) => {
        // The device row is locked FOR SHARE for the whole run insert. Device
        // update/archive use FOR UPDATE on the same row, so the two operations
        // serialize and the snapshot cannot be captured from a stale row.
        const requestDeviceId = request.deviceId ?? null;
        const device =
          requestDeviceId === null
            ? null
            : await lockRunDevice(tx, requestDeviceId, source.profile.id);
        const snapshot = buildSnapshot(source, request, context);

        const run = await tx.testRun.create({
          data: {
            ...snapshot.run,
            deviceId: device?.id ?? null,
            // A nullable JSON column must receive SQL NULL, not JSON null, for
            // a device-less run; the database metadata check depends on it.
            deviceSnapshot: device ?? Prisma.DbNull,
            batchNumber: request.batchNumber ?? null,
            batchNumberKey: request.batchNumberKey ?? null,
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
            occurredAt: context.startedAt,
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
  }

  private async findActiveRun(): Promise<{ id: string } | null> {
    return this.prisma.testRun.findFirst({
      where: { status: RunStatus.RUNNING },
      select: { id: true },
      orderBy: { startedAt: 'desc' },
    });
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
  context: RunSnapshotContext,
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
      context,
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

interface LockedRunDeviceRow {
  id: string;
  name: string;
  serialNumber: string;
  deviceProfileId: string;
  archivedAt: Date | null;
}

/**
 * Locks the device row FOR SHARE inside the run-create transaction and applies
 * the metadata preconditions against the locked version. It shares the lock
 * protocol with DevicesService, which uses FOR UPDATE for update/archive.
 */
async function lockRunDevice(
  tx: Prisma.TransactionClient,
  deviceId: string,
  expectedProfileId: string,
): Promise<RunDeviceSnapshot> {
  const rows = await tx.$queryRaw<LockedRunDeviceRow[]>`
    SELECT
      "id",
      "name",
      "serialNumber",
      "deviceProfileId",
      "archivedAt"
    FROM "devices"
    WHERE "id" = ${deviceId}::uuid
    FOR SHARE
  `;
  const device = rows[0];

  if (!device) {
    throw notFound();
  }

  if (device.archivedAt !== null) {
    throw new ApiException(
      HttpStatus.CONFLICT,
      'DEVICE_ARCHIVED',
      'The selected device is archived and cannot start a new run.',
    );
  }

  if (device.deviceProfileId !== expectedProfileId) {
    throw new ApiException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'DEVICE_PROFILE_MISMATCH',
      'The selected device profile does not match the published plan profile.',
    );
  }

  return {
    id: device.id,
    name: device.name,
    serialNumber: device.serialNumber,
    deviceProfileId: device.deviceProfileId,
  };
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

/** Readiness (database, migrations and startup recovery) is not complete. */
function serviceUnavailable(): ApiException {
  return new ApiException(
    HttpStatus.SERVICE_UNAVAILABLE,
    'SERVICE_UNAVAILABLE',
    'The service is not ready to accept new runs.',
    { details: { checks: { startup: 'pending' } } },
  );
}
