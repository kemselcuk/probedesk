import { randomUUID } from 'node:crypto';
import type {
  PrismaClient,
  Role,
} from '../../src/prisma/generated/client.js';
import { createTestUser, type TestUser } from './auth-helpers.js';

export const PLAN_TEST_EMAIL_PREFIX = 'plans-e2e-';
export const PLAN_TEST_PROFILE_CODE_PREFIX = 'plans-e2e-profile-';

export function uniquePlanTestEmail(): string {
  return `${PLAN_TEST_EMAIL_PREFIX}${randomUUID()}@example.test`;
}

export async function createPlanTestUser(
  prisma: PrismaClient,
  role: Role,
): Promise<TestUser> {
  return createTestUser(prisma, {
    role,
    email: uniquePlanTestEmail(),
    password: 'Plan-E2E-Password-9',
  });
}

export async function createPlanTestProfile(
  prisma: PrismaClient,
): Promise<{ id: string; code: string }> {
  const code = `${PLAN_TEST_PROFILE_CODE_PREFIX}${randomUUID()}`;
  return prisma.deviceProfile.create({
    data: {
      code,
      name: 'Plan E2E Device',
      description: 'Fixture profile',
    },
    select: { id: true, code: true },
  });
}

/**
 * Deletes every row created by the plans test suites. Order follows the
 * restrictive foreign keys: steps, revisions, identities, plans, sessions, users
 * and finally profiles. It only targets the dedicated test prefixes.
 */
export async function deletePlanTestData(prisma: PrismaClient): Promise<void> {
  const planWhere = {
    createdBy: { email: { startsWith: PLAN_TEST_EMAIL_PREFIX } },
  };
  const plans = await prisma.testPlan.findMany({
    where: planWhere,
    select: { id: true },
  });
  const planIds = plans.map((plan) => plan.id);

  await prisma.planStep.deleteMany({ where: { planId: { in: planIds } } });
  await prisma.planRevision.deleteMany({
    where: { planId: { in: planIds } },
  });
  await prisma.stepIdentity.deleteMany({
    where: { planId: { in: planIds } },
  });
  await prisma.testPlan.deleteMany({ where: { id: { in: planIds } } });
  await prisma.session.deleteMany({
    where: { user: { email: { startsWith: PLAN_TEST_EMAIL_PREFIX } } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: PLAN_TEST_EMAIL_PREFIX } },
  });
  await prisma.deviceProfile.deleteMany({
    where: { code: { startsWith: PLAN_TEST_PROFILE_CODE_PREFIX } },
  });
}
