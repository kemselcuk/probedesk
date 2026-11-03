import { PrismaPg } from '@prisma/adapter-pg';
import {
  PlanRevisionState,
  PrismaClient,
  Role,
} from '../src/prisma/generated/client.js';
import type { PlanRevision, TestPlan } from '../src/prisma/generated/client.js';
import {
  createPlanTestProfile,
  createPlanTestUser,
  deletePlanTestData,
} from './support/plan-helpers.js';
import type { TestUser } from './support/auth-helpers.js';

function readPrismaErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }

  return undefined;
}

describe('plan schema constraints (e2e)', () => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  let prisma: PrismaClient;
  let planner: TestUser;
  let viewer: TestUser;
  let profileId: string;

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error(
        'TEST_DATABASE_URL must be set for the plan schema integration test.',
      );
    }

    prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: testDatabaseUrl,
        application_name: 'probedesk-plan-schema-e2e',
        connectionTimeoutMillis: 2000,
      }),
    });

    await deletePlanTestData(prisma);
    planner = await createPlanTestUser(prisma, Role.PLANNER);
    viewer = await createPlanTestUser(prisma, Role.VIEWER);
    profileId = (await createPlanTestProfile(prisma)).id;
  });

  afterAll(async () => {
    if (!prisma) {
      return;
    }

    await deletePlanTestData(prisma);
    await prisma.$disconnect();
  });

  async function createPlan(): Promise<TestPlan> {
    return prisma.testPlan.create({
      data: { createdById: planner.id, deviceProfileId: profileId },
    });
  }

  async function createDraft(
    planId: string,
    name = 'New plan',
  ): Promise<PlanRevision> {
    return prisma.planRevision.create({
      data: {
        planId,
        state: PlanRevisionState.DRAFT,
        name,
        editRevision: 1,
      },
    });
  }

  /**
   * Published revisions cannot be inserted directly after the integrity
   * migration. The helper uses the same DRAFT -> PUBLISHED transition as the
   * publish service, including a valid step and a Planner publisher.
   */
  async function createPublished(
    planId: string,
    versionNumber: number,
    publisherId = planner.id,
  ): Promise<PlanRevision> {
    const draft = await createDraft(planId, `Version ${versionNumber}`);
    const identity = await createIdentity(planId);
    await createStep(planId, draft.id, identity, 1);

    return prisma.planRevision.update({
      where: { id: draft.id },
      data: {
        state: PlanRevisionState.PUBLISHED,
        versionNumber,
        publishedById: publisherId,
        publishedAt: new Date(),
      },
    });
  }

  async function publishRevision(
    revisionId: string,
    versionNumber: number,
    options: { publisherId?: string; publishedAt?: Date } = {},
  ): Promise<PlanRevision> {
    return prisma.planRevision.update({
      where: { id: revisionId },
      data: {
        state: PlanRevisionState.PUBLISHED,
        versionNumber,
        publishedById: options.publisherId ?? planner.id,
        publishedAt: options.publishedAt ?? new Date(),
      },
    });
  }

  async function createIdentity(planId: string): Promise<string> {
    const identity = await prisma.stepIdentity.create({ data: { planId } });
    return identity.id;
  }

  async function createStep(
    planId: string,
    revisionId: string,
    logicalStepId: string,
    position: number,
  ): Promise<string> {
    const step = await prisma.planStep.create({
      data: {
        planId,
        revisionId,
        logicalStepId,
        position,
        name: 'Output voltage',
        unit: 'V',
        minimum: '4.75',
        maximum: '5.25',
        sampleCount: 100,
        intervalMs: 250,
      },
    });
    return step.id;
  }

  it('rejects duplicate published version numbers inside one plan but allows them across plans', async () => {
    const plan = await createPlan();
    await createPublished(plan.id, 1);

    try {
      await createPublished(plan.id, 1);
      expect.unreachable('a duplicate version number should be rejected');
    } catch (error) {
      expect(readPrismaErrorCode(error)).toBe('P2002');
    }

    const otherPlan = await createPlan();
    const otherVersion = await createPublished(otherPlan.id, 1);
    expect(otherVersion.versionNumber).toBe(1);
  });

  it('allows many published versions but at most one open draft per plan', async () => {
    const plan = await createPlan();
    const first = await createPublished(plan.id, 1);
    const second = await createPublished(plan.id, 2);
    expect([first.versionNumber, second.versionNumber]).toEqual([1, 2]);

    await createDraft(plan.id);

    try {
      await createDraft(plan.id);
      expect.unreachable('a second draft should be rejected');
    } catch (error) {
      expect(readPrismaErrorCode(error)).toBe('P2002');
    }
  });

  it('rejects duplicate positions and duplicate logical steps inside one revision', async () => {
    const plan = await createPlan();
    const revision = await createDraft(plan.id);
    const firstIdentity = await createIdentity(plan.id);
    const secondIdentity = await createIdentity(plan.id);

    await createStep(plan.id, revision.id, firstIdentity, 1);

    try {
      await createStep(plan.id, revision.id, secondIdentity, 1);
      expect.unreachable('a duplicate position should be rejected');
    } catch (error) {
      expect(readPrismaErrorCode(error)).toBe('P2002');
    }

    try {
      await createStep(plan.id, revision.id, firstIdentity, 2);
      expect.unreachable('a duplicate logical step should be rejected');
    } catch (error) {
      expect(readPrismaErrorCode(error)).toBe('P2002');
    }
  });

  it('preserves a logical step identity in a later revision of the same plan', async () => {
    const plan = await createPlan();
    const identity = await createIdentity(plan.id);
    const published = await createDraft(plan.id);

    await createStep(plan.id, published.id, identity, 1);
    await publishRevision(published.id, 1);

    const draft = await createDraft(plan.id);
    await createStep(plan.id, draft.id, identity, 1);

    const rows = await prisma.planStep.findMany({
      where: { planId: plan.id, logicalStepId: identity },
      orderBy: { revisionId: 'asc' },
      select: { revisionId: true, position: true },
    });

    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.revisionId))).toEqual(
      new Set([draft.id, published.id]),
    );
    expect(rows.every((row) => row.position === 1)).toBe(true);
  });

  it('rejects a step that references another plan step identity', async () => {
    const planA = await createPlan();
    const planB = await createPlan();
    const revisionB = await createDraft(planB.id);
    const identityA = await createIdentity(planA.id);

    try {
      await createStep(planB.id, revisionB.id, identityA, 1);
      expect.unreachable(
        'a cross-plan logical step identity should be rejected',
      );
    } catch (error) {
      expect(readPrismaErrorCode(error)).toBe('P2003');
    }
  });

  it('rejects a step that pairs a revision with another plan id', async () => {
    const planA = await createPlan();
    const planB = await createPlan();
    const revisionA = await createDraft(planA.id);
    const identityB = await createIdentity(planB.id);

    try {
      await createStep(planB.id, revisionA.id, identityB, 1);
      expect.unreachable('a cross-plan revision should be rejected');
    } catch (error) {
      expect(readPrismaErrorCode(error)).toBe('P2003');
    }
  });

  it('stores limits as NUMERIC(18,6) and reads them back with six decimals', async () => {
    const plan = await createPlan();
    const revision = await createDraft(plan.id);
    const identity = await createIdentity(plan.id);
    const stepId = await createStep(plan.id, revision.id, identity, 1);

    const rows = await prisma.$queryRaw<
      Array<{ minimum: string; maximum: string }>
    >`
      SELECT "minimum"::text AS "minimum", "maximum"::text AS "maximum"
      FROM "plan_steps"
      WHERE "id" = ${stepId}::uuid
    `;

    expect(rows).toEqual([{ minimum: '4.750000', maximum: '5.250000' }]);
  });

  it('keeps revision, identity and plan history under restrictive foreign keys', async () => {
    const plan = await createPlan();
    const revision = await createDraft(plan.id);
    const identity = await createIdentity(plan.id);
    await createStep(plan.id, revision.id, identity, 1);

    try {
      await prisma.stepIdentity.delete({ where: { id: identity } });
      expect.unreachable('deleting a referenced step identity should fail');
    } catch (error) {
      expect(readPrismaErrorCode(error)).toBe('P2003');
    }

    try {
      await prisma.planRevision.delete({ where: { id: revision.id } });
      expect.unreachable('deleting a revision with steps should fail');
    } catch (error) {
      expect(readPrismaErrorCode(error)).toBe('P2003');
    }

    try {
      await prisma.testPlan.delete({ where: { id: plan.id } });
      expect.unreachable('deleting a plan with revisions should fail');
    } catch (error) {
      expect(readPrismaErrorCode(error)).toBe('P2003');
    }
  });

  it('rejects a draft with a version number and a published transition without publisher metadata', async () => {
    const plan = await createPlan();

    try {
      await prisma.planRevision.create({
        data: {
          planId: plan.id,
          state: PlanRevisionState.DRAFT,
          name: 'Invalid draft',
          versionNumber: 1,
        },
      });
      expect.unreachable('a draft version number should be rejected');
    } catch (error) {
      expect(readPrismaErrorCode(error)).toBe('P2039');
    }

    const draft = await createDraft(plan.id);
    const identity = await createIdentity(plan.id);
    await createStep(plan.id, draft.id, identity, 1);

    try {
      await prisma.planRevision.update({
        where: { id: draft.id },
        data: {
          state: PlanRevisionState.PUBLISHED,
          versionNumber: 1,
        },
      });
      expect.unreachable('published metadata should be required');
    } catch (error) {
      expect(readPrismaErrorCode(error)).toBe('P2039');
    }

    const unchanged = await prisma.planRevision.findUniqueOrThrow({
      where: { id: draft.id },
    });
    expect(unchanged.state).toBe(PlanRevisionState.DRAFT);
  });

  it('rejects a direct INSERT of a PUBLISHED revision', async () => {
    const plan = await createPlan();

    await expect(
      prisma.$executeRaw`
        INSERT INTO "plan_revisions" (
          "planId", "state", "name", "versionNumber", "publishedById",
          "publishedAt"
        ) VALUES (
          ${plan.id}::uuid, 'PUBLISHED', 'Direct published revision', 1,
          ${planner.id}::uuid, now()
        )
      `,
    ).rejects.toThrow(
      /Published plan revisions can only be created by publishing a draft/,
    );

    expect(
      await prisma.planRevision.count({
        where: { planId: plan.id, state: PlanRevisionState.PUBLISHED },
      }),
    ).toBe(0);
  });

  it('rejects empty, whitespace-only and overlong revision names at the database', async () => {
    const plan = await createPlan();
    const draft = await createDraft(plan.id, 'Valid revision name');

    for (const invalidName of ['', '   ', 'x'.repeat(101)]) {
      await expect(
        prisma.$executeRaw`
          UPDATE "plan_revisions"
          SET "name" = ${invalidName}
          WHERE "id" = ${draft.id}::uuid
        `,
      ).rejects.toThrow(/plan_revisions_name_check/);
    }

    const stored = await prisma.planRevision.findUniqueOrThrow({
      where: { id: draft.id },
    });
    expect(stored.name).toBe('Valid revision name');
  });

  it('rejects TRUNCATE on plan_steps and on plan_revisions CASCADE', async () => {
    const plan = await createPlan();
    const draft = await createDraft(plan.id);
    const identity = await createIdentity(plan.id);
    await createStep(plan.id, draft.id, identity, 1);

    await expect(
      prisma.$executeRawUnsafe('TRUNCATE TABLE "plan_steps"'),
    ).rejects.toThrow(/TRUNCATE is not allowed/);
    await expect(
      prisma.$executeRawUnsafe('TRUNCATE TABLE "plan_revisions" CASCADE'),
    ).rejects.toThrow(/TRUNCATE is not allowed/);

    expect(
      await prisma.planRevision.count({ where: { planId: plan.id } }),
    ).toBe(1);
    expect(await prisma.planStep.count({ where: { planId: plan.id } })).toBe(1);
  });

  it('rejects a DRAFT to PUBLISHED transition without steps', async () => {
    const plan = await createPlan();
    const draft = await createDraft(plan.id);

    await expect(publishRevision(draft.id, 1)).rejects.toThrow(
      /A published revision must contain at least one step/,
    );

    const stored = await prisma.planRevision.findUniqueOrThrow({
      where: { id: draft.id },
    });
    expect(stored.state).toBe(PlanRevisionState.DRAFT);
    expect(stored.versionNumber).toBeNull();
  });

  it('rejects a DRAFT to PUBLISHED transition with a non-Planner publisher', async () => {
    const plan = await createPlan();
    const draft = await createDraft(plan.id);
    const identity = await createIdentity(plan.id);
    await createStep(plan.id, draft.id, identity, 1);

    await expect(
      publishRevision(draft.id, 1, { publisherId: viewer.id }),
    ).rejects.toThrow(/A published revision must name a Planner as publisher/);

    const stored = await prisma.planRevision.findUniqueOrThrow({
      where: { id: draft.id },
    });
    expect(stored.state).toBe(PlanRevisionState.DRAFT);
  });

  it('rejects a baseVersionId that belongs to another plan', async () => {
    const planA = await createPlan();
    const publishedA = await createPublished(planA.id, 1);
    const planB = await createPlan();
    const draftB = await createDraft(planB.id);

    await expect(
      prisma.$executeRaw`
        UPDATE "plan_revisions"
        SET "baseVersionId" = ${publishedA.id}::uuid
        WHERE "id" = ${draftB.id}::uuid
      `,
    ).rejects.toThrow(/plan_revisions_baseVersionId_planId_fkey/);

    const stored = await prisma.planRevision.findUniqueOrThrow({
      where: { id: draftB.id },
    });
    expect(stored.baseVersionId).toBeNull();
  });

  it('rejects a baseVersionId that points at a DRAFT revision', async () => {
    const plan = await createPlan();
    const draft = await createDraft(plan.id);

    await expect(
      prisma.$executeRaw`
        UPDATE "plan_revisions"
        SET "baseVersionId" = ${draft.id}::uuid
        WHERE "id" = ${draft.id}::uuid
      `,
    ).rejects.toThrow(
      /baseVersionId must reference a published revision of the same plan/,
    );

    const stored = await prisma.planRevision.findUniqueOrThrow({
      where: { id: draft.id },
    });
    expect(stored.baseVersionId).toBeNull();
  });
});
