import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ApiException } from '../common/errors/api.exception.js';
import { ValidationFailedException } from '../common/errors/validation.exception.js';
import type { FieldError } from '../common/errors/field-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  PlanRevisionState,
  Role,
  type Prisma,
} from '../prisma/generated/client.js';
import { DeviceProfileDto } from '../device-profiles/dto/device-profile.dto.js';
import { CreatePlanDto } from './dto/create-plan.dto.js';
import {
  DraftRevisionDto,
  PlanDetailDto,
  PlanListItemDto,
  PlanStepDto,
  PublishedRevisionDto,
  PublishedVersionListItemDto,
  PublishedVersionSummaryDto,
} from './dto/plan-response.dto.js';
import { PublishDraftDto } from './dto/publish-draft.dto.js';
import { SaveDraftDto } from './dto/save-draft.dto.js';
import {
  assertDraftLimits,
  assertPublishableName,
  assertPublishableSteps,
  type StoredStepForPublish,
} from './plan-limits.js';
import { formatScaledDecimal } from './plan-decimal.js';

interface StepShape {
  id: string;
  logicalStepId: string;
  position: number;
  name: string;
  unit: string;
  minimum: Prisma.Decimal;
  maximum: Prisma.Decimal;
  sampleCount: number;
  intervalMs: number;
}

interface RevisionShape {
  id: string;
  planId: string;
  state: PlanRevisionState;
  name: string;
  versionNumber: number | null;
  editRevision: number;
  baseVersionId: string | null;
  publishedAt: Date | null;
}

interface PlanShape {
  id: string;
  createdAt: Date;
  deviceProfile: {
    id: string;
    code: string;
    name: string;
    description: string | null;
  };
}

@Injectable()
export class PlansService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Creates the plan row and its first empty draft in one transaction. */
  async create(
    plannerId: string,
    dto: CreatePlanDto,
  ): Promise<PlanDetailDto> {
    const { plan, draft } = await this.prisma.$transaction(async (tx) => {
      const profile = await tx.deviceProfile.findUnique({
        where: { id: dto.profileId },
      });

      if (!profile) {
        throw new ValidationFailedException([
          {
            path: 'profileId',
            code: 'INVALID_VALUE',
            message: 'profileId does not reference an existing device profile',
          },
        ]);
      }

      const createdPlan = await tx.testPlan.create({
        data: {
          deviceProfileId: profile.id,
          createdById: plannerId,
        },
        include: { deviceProfile: true },
      });

      const createdDraft = await tx.planRevision.create({
        data: {
          planId: createdPlan.id,
          state: PlanRevisionState.DRAFT,
          name: dto.name,
          editRevision: 1,
        },
        include: { steps: true },
      });

      return { plan: createdPlan, draft: createdDraft };
    });

    return this.toPlanDetail(plan, draft, null, true);
  }

  /**
   * Role-aware list. A Planner sees every plan and its draft name. Operator and
   * Viewer only receive plans with a published revision; draft-only plans are
   * absent and no draft field is emitted.
   */
  async list(role: Role): Promise<PlanListItemDto[]> {
    const isPlanner = role === Role.PLANNER;
    const plans = await this.prisma.testPlan.findMany({
      where: isPlanner
        ? undefined
        : { revisions: { some: { state: PlanRevisionState.PUBLISHED } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        deviceProfile: true,
        revisions: {
          where: isPlanner
            ? undefined
            : { state: PlanRevisionState.PUBLISHED },
          select: {
            id: true,
            name: true,
            state: true,
            versionNumber: true,
            editRevision: true,
            publishedAt: true,
          },
        },
      },
    });

    return plans.map((plan) => {
      const published = latestPublished(plan.revisions);
      const draft = isPlanner
        ? plan.revisions.find(
            (revision) => revision.state === PlanRevisionState.DRAFT,
          )
        : undefined;
      const name = resolvePlanName(draft?.name, published?.name);

      return {
        id: plan.id,
        name,
        profile: toDeviceProfile(plan.deviceProfile),
        latestPublishedVersion: published
          ? toPublishedVersionSummary(published)
          : null,
        ...(isPlanner
          ? {
              draft: draft
                ? { id: draft.id, editRevision: draft.editRevision }
                : null,
            }
          : {}),
      };
    });
  }

  /**
   * Role-aware detail. Non-Planner callers cannot distinguish a missing plan
   * from a draft-only plan: both produce the same 404, and no draft key is
   * emitted.
   */
  async getById(role: Role, planId: string): Promise<PlanDetailDto> {
    const isPlanner = role === Role.PLANNER;
    const plan = await this.prisma.testPlan.findFirst({
      where: isPlanner
        ? { id: planId }
        : {
            id: planId,
            revisions: { some: { state: PlanRevisionState.PUBLISHED } },
          },
      include: {
        deviceProfile: true,
        revisions: {
          where: isPlanner
            ? undefined
            : { state: PlanRevisionState.PUBLISHED },
          select: {
            id: true,
            name: true,
            state: true,
            versionNumber: true,
            editRevision: true,
            baseVersionId: true,
            publishedAt: true,
          },
        },
      },
    });

    if (!plan) {
      throw notFound();
    }

    const publishedSummary = latestPublished(plan.revisions);
    const published = publishedSummary
      ? await this.prisma.planRevision.findUnique({
          where: { id: publishedSummary.id },
          include: { steps: { orderBy: { position: 'asc' } } },
        })
      : null;

    const draft = isPlanner
      ? await this.prisma.planRevision.findFirst({
          where: { planId, state: PlanRevisionState.DRAFT },
          include: { steps: { orderBy: { position: 'asc' } } },
        })
      : null;

    return this.toPlanDetail(plan, draft, published, isPlanner);
  }

  /**
   * Atomically replaces a draft. The plan row is locked before the revision is
   * read, so two saves with the same expectedRevision serialize: the first
   * commits, the second observes the incremented revision and returns 409
   * without touching a row.
   */
  async saveDraft(
    planId: string,
    dto: SaveDraftDto,
  ): Promise<DraftRevisionDto> {
    assertDraftLimits(dto);

    const revision = await this.prisma.$transaction(
      async (tx) => {
        await this.lockPlan(tx, planId);

        const draft = await tx.planRevision.findFirst({
          where: { planId, state: PlanRevisionState.DRAFT },
        });

        if (!draft) {
          throw noOpenDraft();
        }

        if (draft.editRevision !== dto.expectedRevision) {
          throw staleRevision(draft.editRevision);
        }

        const existingIds = dto.steps.flatMap((step) =>
          step.logicalStepId ? [step.logicalStepId] : [],
        );
        await this.assertStepIdentitiesBelongToPlan(
          tx,
          planId,
          dto,
          existingIds,
        );

        const newIdsByIndex = new Map<number, string>();
        for (const [index, step] of dto.steps.entries()) {
          if (!step.logicalStepId) {
            newIdsByIndex.set(index, randomUUID());
          }
        }

        if (newIdsByIndex.size > 0) {
          await tx.stepIdentity.createMany({
            data: [...newIdsByIndex.values()].map((id) => ({
              id,
              planId,
            })),
          });
        }

        await tx.planStep.deleteMany({ where: { revisionId: draft.id } });

        if (dto.steps.length > 0) {
          await tx.planStep.createMany({
            data: dto.steps.map((step, index) => ({
              revisionId: draft.id,
              planId,
              logicalStepId: step.logicalStepId ?? newIdsByIndex.get(index)!,
              position: index + 1,
              name: step.name,
              unit: step.unit,
              minimum: step.minimum,
              maximum: step.maximum,
              sampleCount: step.sampleCount,
              intervalMs: step.intervalMs,
            })),
          });
        }

        return tx.planRevision.update({
          where: { id: draft.id },
          data: {
            name: dto.name,
            editRevision: { increment: 1 },
          },
          include: { steps: { orderBy: { position: 'asc' } } },
        });
      },
      { timeout: 10_000, maxWait: 5_000 },
    );

    return toDraftRevision(revision);
  }

  /**
   * Publishes the open draft atomically. The plan row is locked first, so two
   * concurrent publishes or a publish racing a save serialize. Version numbers
   * are assigned from the locked plan's highest published number and the partial
   * unique index in the database is the final backstop.
   *
   * The stored steps are re-read after the state transition. Any direct SQL
   * write that slipped in before the revision row lock is visible in that read
   * and aborts the transaction instead of publishing unreviewed content.
   */
  async publishDraft(
    plannerId: string,
    planId: string,
    dto: PublishDraftDto,
  ): Promise<PublishedRevisionDto> {
    const revision = await this.prisma.$transaction(
      async (tx) => {
        await this.lockPlan(tx, planId);

        const draft = await tx.planRevision.findFirst({
          where: { planId, state: PlanRevisionState.DRAFT },
          include: { steps: { orderBy: { position: 'asc' } } },
        });

        if (!draft) {
          throw noOpenDraft();
        }

        if (draft.editRevision !== dto.expectedRevision) {
          throw staleRevision(draft.editRevision);
        }

        assertPublishableName(draft.name);
        assertPublishableSteps(toStoredSteps(draft.steps));
        const snapshot = draft.steps.map(toStepSnapshot);

        const aggregate = await tx.planRevision.aggregate({
          where: { planId, versionNumber: { not: null } },
          _max: { versionNumber: true },
        });
        const versionNumber = (aggregate._max.versionNumber ?? 0) + 1;
        const publishedAt = new Date();

        const updated = await tx.planRevision.updateMany({
          where: {
            id: draft.id,
            planId,
            state: PlanRevisionState.DRAFT,
            editRevision: dto.expectedRevision,
          },
          data: {
            state: PlanRevisionState.PUBLISHED,
            versionNumber,
            publishedById: plannerId,
            publishedAt,
          },
        });

        if (updated.count !== 1) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            'DRAFT_CONFLICT',
            'The draft changed before it could be published. Reload it and try again.',
            { details: { reason: 'DRAFT_CHANGED' } },
          );
        }

        const stored = await tx.planRevision.findUniqueOrThrow({
          where: { id: draft.id },
          include: { steps: { orderBy: { position: 'asc' } } },
        });

        if (
          stored.name !== draft.name ||
          !sameStepContent(snapshot, stored.steps)
        ) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            'DRAFT_CONFLICT',
            'The draft changed while it was being published. Reload it and try again.',
            { details: { reason: 'DRAFT_CHANGED' } },
          );
        }

        assertPublishableName(stored.name);
        assertPublishableSteps(toStoredSteps(stored.steps));
        return stored;
      },
      { timeout: 10_000, maxWait: 5_000 },
    );

    return toPublishedRevision(revision);
  }

  /**
   * Creates the next draft as a copy of the latest published version. The plan
   * lock serializes two draft-creation requests, so the partial unique index is
   * never the user-visible conflict path for this endpoint.
   */
  async createDraft(planId: string): Promise<DraftRevisionDto> {
    const draft = await this.prisma.$transaction(
      async (tx) => {
        await this.lockPlan(tx, planId);

        const openDraft = await tx.planRevision.findFirst({
          where: { planId, state: PlanRevisionState.DRAFT },
          select: { id: true, editRevision: true },
        });

        if (openDraft) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            'DRAFT_CONFLICT',
            'This plan already has an open draft.',
            {
              details: {
                reason: 'OPEN_DRAFT_EXISTS',
                currentRevision: openDraft.editRevision,
              },
            },
          );
        }

        const latest = await tx.planRevision.findFirst({
          where: { planId, state: PlanRevisionState.PUBLISHED },
          orderBy: [{ versionNumber: 'desc' }, { id: 'desc' }],
          include: { steps: { orderBy: { position: 'asc' } } },
        });

        if (!latest) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            'DRAFT_CONFLICT',
            'This plan does not have a published version to copy.',
            { details: { reason: 'NO_PUBLISHED_VERSION' } },
          );
        }

        const created = await tx.planRevision.create({
          data: {
            planId,
            state: PlanRevisionState.DRAFT,
            name: latest.name,
            editRevision: 1,
            baseVersionId: latest.id,
          },
        });

        if (latest.steps.length > 0) {
          await tx.planStep.createMany({
            data: latest.steps.map((step) => ({
              revisionId: created.id,
              planId,
              logicalStepId: step.logicalStepId,
              position: step.position,
              name: step.name,
              unit: step.unit,
              minimum: step.minimum,
              maximum: step.maximum,
              sampleCount: step.sampleCount,
              intervalMs: step.intervalMs,
            })),
          });
        }

        return tx.planRevision.findUniqueOrThrow({
          where: { id: created.id },
          include: { steps: { orderBy: { position: 'asc' } } },
        });
      },
      { timeout: 10_000, maxWait: 5_000 },
    );

    return toDraftRevision(draft);
  }

  /**
   * Published versions for one plan, newest first. A plan that only has a draft
   * is a 404 for Operator and Viewer so its existence is not disclosed.
   */
  async listVersions(
    role: Role,
    planId: string,
  ): Promise<PublishedVersionListItemDto[]> {
    const isPlanner = role === Role.PLANNER;
    const plan = await this.prisma.testPlan.findFirst({
      where: isPlanner
        ? { id: planId }
        : {
            id: planId,
            revisions: { some: { state: PlanRevisionState.PUBLISHED } },
          },
      select: { id: true },
    });

    if (!plan) {
      throw notFound();
    }

    const versions = await this.prisma.planRevision.findMany({
      where: { planId, state: PlanRevisionState.PUBLISHED },
      orderBy: [{ versionNumber: 'desc' }, { id: 'desc' }],
      include: {
        publishedBy: { select: { id: true, email: true, role: true } },
      },
    });

    return versions.map(toPublishedVersionListItem);
  }

  /** Reads one published revision with ordered steps; drafts are always 404. */
  async getPublishedVersion(versionId: string): Promise<PublishedRevisionDto> {
    const revision = await this.prisma.planRevision.findFirst({
      where: { id: versionId, state: PlanRevisionState.PUBLISHED },
      include: { steps: { orderBy: { position: 'asc' } } },
    });

    if (!revision) {
      throw notFound();
    }

    return toPublishedRevision(revision);
  }

  /**
   * Every draft mutation locks the plan row before touching revisions or steps.
   * This single lock order is what makes save/publish/new-draft serialize.
   */
  private async lockPlan(
    tx: Prisma.TransactionClient,
    planId: string,
  ): Promise<void> {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "test_plans" WHERE "id" = ${planId}::uuid FOR UPDATE
    `;

    if (locked.length === 0) {
      throw notFound();
    }
  }

  /**
   * Every submitted logicalStepId must already belong to this plan, and each may
   * appear at most once in the request. Both failures are field-level 400s with
   * the submitted array index, never a cross-plan lookup or silent replacement.
   */
  private async assertStepIdentitiesBelongToPlan(
    tx: Prisma.TransactionClient,
    planId: string,
    dto: SaveDraftDto,
    existingIds: readonly string[],
  ): Promise<void> {
    const errors: FieldError[] = [];
    const seen = new Set<string>();

    for (const [index, step] of dto.steps.entries()) {
      if (!step.logicalStepId) {
        continue;
      }

      if (seen.has(step.logicalStepId)) {
        errors.push({
          path: `steps.${index}.logicalStepId`,
          code: 'INVALID_VALUE',
          message: 'logicalStepId must not appear twice in the same request',
        });
      } else {
        seen.add(step.logicalStepId);
      }
    }

    if (existingIds.length > 0) {
      const identities = await tx.stepIdentity.findMany({
        where: { planId, id: { in: [...new Set(existingIds)] } },
        select: { id: true },
      });
      const owned = new Set(identities.map((identity) => identity.id));

      for (const [index, step] of dto.steps.entries()) {
        if (step.logicalStepId && !owned.has(step.logicalStepId)) {
          errors.push({
            path: `steps.${index}.logicalStepId`,
            code: 'INVALID_VALUE',
            message:
              'logicalStepId does not belong to this plan or does not exist',
          });
        }
      }
    }

    if (errors.length > 0) {
      throw new ValidationFailedException(errors);
    }
  }

  private toPlanDetail(
    plan: PlanShape,
    draft: (RevisionShape & { steps: StepShape[] }) | null,
    published: (RevisionShape & { steps: StepShape[] }) | null,
    includeDraft: boolean,
  ): PlanDetailDto {
    const name = resolvePlanName(draft?.name, published?.name);

    return {
      id: plan.id,
      name,
      profile: toDeviceProfile(plan.deviceProfile),
      createdAt: plan.createdAt.toISOString(),
      latestPublishedVersion: published
        ? toPublishedVersionSummary(published)
        : null,
      ...(includeDraft
        ? { draft: draft ? toDraftRevision(draft) : null }
        : {}),
      published: published ? toPublishedRevision(published) : null,
    };
  }
}

function notFound(): ApiException {
  return new ApiException(
    HttpStatus.NOT_FOUND,
    'NOT_FOUND',
    'The requested resource was not found.',
  );
}

function noOpenDraft(): ApiException {
  return new ApiException(
    HttpStatus.CONFLICT,
    'DRAFT_CONFLICT',
    'This plan does not have an open draft.',
    { details: { reason: 'NO_OPEN_DRAFT' } },
  );
}

function staleRevision(currentRevision: number): ApiException {
  return new ApiException(
    HttpStatus.CONFLICT,
    'DRAFT_CONFLICT',
    'The draft was changed by another save. Reload it and try again.',
    { details: { currentRevision } },
  );
}

function toStoredSteps(steps: readonly StepShape[]): StoredStepForPublish[] {
  return steps.map((step) => ({
    logicalStepId: step.logicalStepId,
    position: step.position,
    name: step.name,
    unit: step.unit,
    minimum: formatScaledDecimal(step.minimum),
    maximum: formatScaledDecimal(step.maximum),
    sampleCount: step.sampleCount,
    intervalMs: step.intervalMs,
  }));
}

function toStepSnapshot(step: StepShape): string {
  return JSON.stringify([
    step.id,
    step.logicalStepId,
    step.position,
    step.name,
    step.unit,
    formatScaledDecimal(step.minimum),
    formatScaledDecimal(step.maximum),
    step.sampleCount,
    step.intervalMs,
  ]);
}

function sameStepContent(
  before: readonly string[],
  after: readonly StepShape[],
): boolean {
  return (
    before.length === after.length &&
    after.every((step, index) => toStepSnapshot(step) === before[index])
  );
}

function toPublishedVersionListItem(revision: {
  id: string;
  versionNumber: number | null;
  name: string;
  publishedAt: Date | null;
  publishedBy: { id: string; email: string; role: Role } | null;
}): PublishedVersionListItemDto {
  if (
    revision.versionNumber === null ||
    revision.publishedAt === null ||
    revision.publishedBy === null
  ) {
    throw new Error('A published revision must have version metadata.');
  }

  return {
    id: revision.id,
    versionNumber: revision.versionNumber,
    name: revision.name,
    publishedAt: revision.publishedAt.toISOString(),
    publishedBy: {
      id: revision.publishedBy.id,
      email: revision.publishedBy.email,
      role: revision.publishedBy.role,
    },
  };
}

function latestPublished<
  T extends { state: PlanRevisionState; versionNumber: number | null },
>(revisions: readonly T[]): T | undefined {
  let latest: T | undefined;

  for (const revision of revisions) {
    if (revision.state !== PlanRevisionState.PUBLISHED) {
      continue;
    }

    if (
      !latest ||
      (revision.versionNumber ?? 0) > (latest.versionNumber ?? 0)
    ) {
      latest = revision;
    }
  }

  return latest;
}

const FALLBACK_PLAN_NAME = 'Untitled plan';

/**
 * Chooses the displayed plan name from the role-appropriate revisions. The
 * database check constraint makes blank revision names impossible, but legacy
 * or corrupt rows must not turn one plan into a 500 for the whole list or the
 * detail response.
 */
function resolvePlanName(
  ...candidates: Array<string | null | undefined>
): string {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return FALLBACK_PLAN_NAME;
}

function toDeviceProfile(profile: PlanShape['deviceProfile']): DeviceProfileDto {
  return {
    id: profile.id,
    code: profile.code,
    name: profile.name,
    description: profile.description,
  };
}

function toPublishedVersionSummary(revision: {
  id: string;
  versionNumber: number | null;
  publishedAt: Date | null;
}): PublishedVersionSummaryDto {
  if (revision.versionNumber === null || revision.publishedAt === null) {
    throw new Error('A published revision must have a version and timestamp.');
  }

  return {
    id: revision.id,
    versionNumber: revision.versionNumber,
    publishedAt: revision.publishedAt.toISOString(),
  };
}

function toPlanStep(step: StepShape): PlanStepDto {
  return {
    logicalStepId: step.logicalStepId,
    position: step.position,
    name: step.name,
    unit: step.unit,
    minimum: formatScaledDecimal(step.minimum),
    maximum: formatScaledDecimal(step.maximum),
    sampleCount: step.sampleCount,
    intervalMs: step.intervalMs,
  };
}

function toDraftRevision(
  revision: RevisionShape & { steps: StepShape[] },
): DraftRevisionDto {
  return {
    id: revision.id,
    planId: revision.planId,
    state: 'DRAFT',
    name: revision.name,
    editRevision: revision.editRevision,
    versionNumber: null,
    baseVersionId: revision.baseVersionId,
    steps: revision.steps.map(toPlanStep),
  };
}

function toPublishedRevision(
  revision: RevisionShape & { steps: StepShape[] },
): PublishedRevisionDto {
  if (revision.versionNumber === null || revision.publishedAt === null) {
    throw new Error('A published revision must have a version and timestamp.');
  }

  return {
    id: revision.id,
    planId: revision.planId,
    state: 'PUBLISHED',
    name: revision.name,
    versionNumber: revision.versionNumber,
    baseVersionId: revision.baseVersionId,
    publishedAt: revision.publishedAt.toISOString(),
    steps: revision.steps.map(toPlanStep),
  };
}
