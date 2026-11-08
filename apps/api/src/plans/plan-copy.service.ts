import { createHash, randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ApiException } from '../common/errors/api.exception.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PlanRevisionState, Prisma } from '../prisma/generated/client.js';
import { normalizeIdempotencyKey } from '../runs/run-start.js';
import { CopyPlanDto } from './dto/copy-plan.dto.js';
import { CopyPlanResponseDto } from './dto/copy-plan-response.dto.js';
import { formatScaledDecimal } from './plan-decimal.js';

interface CopyRecord {
  requestHash: string;
  sourceVersionId: string;
  targetPlanId: string;
}

export interface PlanCopyResult {
  replayed: boolean;
  response: CopyPlanResponseDto;
}

@Injectable()
export class PlanCopyService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Copies one published revision into a new independent plan, or replays the
   * earlier copy made by this user with the same Idempotency-Key.
   *
   * The key is read before the source is loaded so a completed retry keeps
   * returning its original target even after the source or target has moved on.
   * The plan, draft revision, fresh step identities, copied steps and
   * PlanCopyRequest commit in one transaction.
   */
  async copy(
    plannerId: string,
    sourceVersionIdInput: string,
    idempotencyKeyHeader: unknown,
    dto: CopyPlanDto,
  ): Promise<PlanCopyResult> {
    const idempotencyKey = normalizeIdempotencyKey(idempotencyKeyHeader);
    const sourceVersionId = sourceVersionIdInput.toLowerCase();
    const name = dto.name.trim();
    const requestHash = hashCopyRequest(sourceVersionId, name);

    const existing = await this.findByKey(plannerId, idempotencyKey);
    if (existing) {
      return this.replayExisting(existing, requestHash);
    }

    let created: {
      planId: string;
      draftRevisionId: string;
      sourceVersionId: string;
    };
    try {
      created = await this.prisma.$transaction(
        async (tx) => {
          const source = await tx.planRevision.findFirst({
            where: {
              id: sourceVersionId,
              state: PlanRevisionState.PUBLISHED,
            },
            include: {
              plan: { select: { deviceProfileId: true } },
              steps: { orderBy: { position: 'asc' } },
            },
          });

          if (!source) {
            throw notFound();
          }

          const plan = await tx.testPlan.create({
            data: {
              deviceProfileId: source.plan.deviceProfileId,
              createdById: plannerId,
            },
            select: { id: true },
          });

          const draft = await tx.planRevision.create({
            data: {
              planId: plan.id,
              state: PlanRevisionState.DRAFT,
              name,
              editRevision: 1,
              versionNumber: null,
              baseVersionId: null,
            },
            select: { id: true },
          });

          if (source.steps.length > 0) {
            const logicalStepIds = source.steps.map(() => randomUUID());

            await tx.stepIdentity.createMany({
              data: logicalStepIds.map((id) => ({ id, planId: plan.id })),
            });

            await tx.planStep.createMany({
              data: source.steps.map((step, index) => ({
                revisionId: draft.id,
                planId: plan.id,
                logicalStepId: logicalStepIds[index]!,
                position: step.position,
                name: step.name,
                unit: step.unit,
                minimum: formatScaledDecimal(step.minimum),
                maximum: formatScaledDecimal(step.maximum),
                sampleCount: step.sampleCount,
                intervalMs: step.intervalMs,
              })),
            });
          }

          await tx.planCopyRequest.create({
            data: {
              requestedById: plannerId,
              idempotencyKey,
              requestHash,
              sourceVersionId: source.id,
              targetPlanId: plan.id,
            },
          });

          return {
            planId: plan.id,
            draftRevisionId: draft.id,
            sourceVersionId: source.id,
          };
        },
        { timeout: 10_000, maxWait: 5_000 },
      );
    } catch (error) {
      // The unique key is the final arbiter between concurrent identical
      // requests. The losing transaction has rolled back its plan, revision,
      // identities and steps by the time this handler runs. Only that exact
      // constraint is treated as a replay; every other failure stays visible.
      if (!isCopyKeyConflict(error)) {
        throw error;
      }

      const raced = await this.findByKey(plannerId, idempotencyKey);
      if (!raced) {
        throw error;
      }

      return this.replayExisting(raced, requestHash);
    }

    return {
      replayed: false,
      response: {
        planId: created.planId,
        draftRevisionId: created.draftRevisionId,
        sourceVersionId: created.sourceVersionId,
        replayed: false,
      },
    };
  }

  private findByKey(
    requestedById: string,
    idempotencyKey: string,
  ): Promise<CopyRecord | null> {
    return this.prisma.planCopyRequest.findUnique({
      where: {
        requestedById_idempotencyKey: { requestedById, idempotencyKey },
      },
      select: {
        requestHash: true,
        sourceVersionId: true,
        targetPlanId: true,
      },
    });
  }

  private async replayExisting(
    existing: CopyRecord,
    requestHash: string,
  ): Promise<PlanCopyResult> {
    if (existing.requestHash !== requestHash) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'IDEMPOTENCY_CONFLICT',
        'The Idempotency-Key was already used with a different request.',
        { details: { reason: 'REQUEST_MISMATCH' } },
      );
    }

    // The copy request is the durable provenance record. The initial revision
    // is the only revision in the target plan without a base version; the id
    // stays stable after the draft is edited or published.
    const initialRevision = await this.prisma.planRevision.findFirst({
      where: { planId: existing.targetPlanId, baseVersionId: null },
      orderBy: { id: 'asc' },
      select: { id: true },
    });

    if (!initialRevision) {
      throw new Error(
        'A plan copy request must reference a plan with its initial revision.',
      );
    }

    return {
      replayed: true,
      response: {
        planId: existing.targetPlanId,
        draftRevisionId: initialRevision.id,
        sourceVersionId: existing.sourceVersionId,
        replayed: true,
      },
    };
  }
}

/**
 * Canonical copy request identity: the published source UUID and the trimmed,
 * case-sensitive target name. The version marker keeps an algorithm change
 * detectable instead of silently replaying an incompatible key.
 */
function hashCopyRequest(sourceVersionId: string, name: string): string {
  const canonical = JSON.stringify([
    'probedesk-plan-copy-v1',
    sourceVersionId,
    name,
  ]);

  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

const COPY_KEY_CONSTRAINT =
  'plan_copy_requests_requestedById_idempotencyKey_key';

function isCopyKeyConflict(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  ) {
    return false;
  }

  const meta = error.meta as
    | {
        target?: unknown;
        driverAdapterError?: {
          cause?: { constraint?: { index?: unknown } };
        };
      }
    | undefined;

  if (!meta) {
    return false;
  }

  if (Array.isArray(meta.target)) {
    return (
      meta.target.includes('requestedById') &&
      meta.target.includes('idempotencyKey')
    );
  }

  if (typeof meta.target === 'string') {
    return (
      meta.target === COPY_KEY_CONSTRAINT ||
      (meta.target.includes('requestedById') &&
        meta.target.includes('idempotencyKey'))
    );
  }

  // Prisma's PostgreSQL driver adapter reports the exact unique index under
  // the adapter error instead of populating meta.target.
  return (
    meta.driverAdapterError?.cause?.constraint?.index === COPY_KEY_CONSTRAINT
  );
}

function notFound(): ApiException {
  return new ApiException(
    HttpStatus.NOT_FOUND,
    'NOT_FOUND',
    'The requested resource was not found.',
  );
}
