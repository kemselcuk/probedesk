import type { PrismaClient } from '../../src/prisma/generated/client.js';
import { PLAN_TEST_EMAIL_PREFIX, deletePlanTestData } from './plan-helpers.js';

/**
 * Removes copy provenance before the shared plan cleanup removes targets,
 * revisions and users. The PlanCopyRequest foreign keys are RESTRICT, so a
 * leftover row would otherwise block cleanup of an earlier failed run.
 */
export async function deletePlanCopyTestData(
  prisma: PrismaClient,
): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: PLAN_TEST_EMAIL_PREFIX } },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);
  const plans = await prisma.testPlan.findMany({
    where: { createdById: { in: userIds } },
    select: { id: true },
  });
  const planIds = plans.map((plan) => plan.id);

  await prisma.planCopyRequest.deleteMany({
    where: {
      OR: [
        { requestedById: { in: userIds } },
        { targetPlanId: { in: planIds } },
        { sourceVersion: { planId: { in: planIds } } },
      ],
    },
  });

  await deletePlanTestData(prisma);
}

export const PLAN_COPY_FAILURE_FUNCTION =
  'probedesk_test_force_plan_copy_failure';
export const PLAN_COPY_FAILURE_TRIGGER =
  'probedesk_test_force_plan_copy_failure';

/**
 * Installs a temporary trigger that aborts every PlanCopyRequest insert. The
 * test uses it to prove that a failure after the plan, revision, identity and
 * step inserts rolls the whole transaction back.
 */
export async function installPlanCopyFailureTrigger(
  prisma: PrismaClient,
): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION "${PLAN_COPY_FAILURE_FUNCTION}"()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RAISE EXCEPTION 'forced plan copy failure';
    END;
    $$
  `);
  await prisma.$executeRawUnsafe(`
    DROP TRIGGER IF EXISTS "${PLAN_COPY_FAILURE_TRIGGER}"
    ON "plan_copy_requests"
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER "${PLAN_COPY_FAILURE_TRIGGER}"
    BEFORE INSERT ON "plan_copy_requests"
    FOR EACH ROW
    EXECUTE FUNCTION "${PLAN_COPY_FAILURE_FUNCTION}"()
  `);
}

export async function removePlanCopyFailureTrigger(
  prisma: PrismaClient,
): Promise<void> {
  await prisma.$executeRawUnsafe(`
    DROP TRIGGER IF EXISTS "${PLAN_COPY_FAILURE_TRIGGER}"
    ON "plan_copy_requests"
  `);
  await prisma.$executeRawUnsafe(
    `DROP FUNCTION IF EXISTS "${PLAN_COPY_FAILURE_FUNCTION}"()`,
  );
}
