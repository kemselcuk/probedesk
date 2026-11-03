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

  async function createDraft(planId: string): Promise<PlanRevision> {
    return prisma.planRevision.create({
      data: {
        planId,
        state: PlanRevisionState.DRAFT,
        name: 'New plan',
        editRevision: 1,
      },
    });
  }

  async function createPublished(
    planId: string,
    versionNumber: number,
  ): Promise<PlanRevision> {
    return prisma.planRevision.create({
      data: {
        planId,
        state: PlanRevisionState.PUBLISHED,
        name: `Version ${versionNumber}`,
        versionNumber,
        publishedById: planner.id,
        publishedAt: new Date(),
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
    const draft = await createDraft(plan.id);
    const published = await createPublished(plan.id, 1);
    const identity = await createIdentity(plan.id);

    await createStep(plan.id, draft.id, identity, 1);
    await createStep(plan.id, published.id, identity, 1);

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

  it('rejects a draft with a version number and a published revision without publisher metadata', async () => {
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

    try {
      await prisma.planRevision.create({
        data: {
          planId: plan.id,
          state: PlanRevisionState.PUBLISHED,
          name: 'Invalid published revision',
          versionNumber: 1,
        },
      });
      expect.unreachable('published metadata should be required');
    } catch (error) {
      expect(readPrismaErrorCode(error)).toBe('P2039');
    }
  });
});
