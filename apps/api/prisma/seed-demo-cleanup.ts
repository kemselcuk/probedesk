import type { PrismaClient } from '../src/prisma/generated/client.js';
import { DEMO_DEVICE_PROFILES, DEMO_USER_EMAILS } from './seed-data.js';

export interface DemoSeedCleanupSummary {
  runs: number;
  plans: number;
  users: number;
  profiles: number;
}

/**
 * Destructive fixture cleanup used by the guarded demo reset and by tests.
 *
 * It removes every plan created by a demo account and every run requested by a
 * demo account. Published history is only deletable after disabling the
 * immutability triggers as the schema owner; this helper restores them in a
 * finally block.
 */
export async function deleteDemoSeedFixture(
  prisma: PrismaClient,
): Promise<DemoSeedCleanupSummary> {
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "plan_steps" DISABLE TRIGGER USER',
  );
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "plan_revisions" DISABLE TRIGGER USER',
  );

  try {
    const users = await prisma.user.findMany({
      where: { email: { in: [...DEMO_USER_EMAILS] } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);

    const plans = await prisma.testPlan.findMany({
      where: { createdById: { in: userIds } },
      select: { id: true },
    });
    const planIds = plans.map((plan) => plan.id);

    const runs = await prisma.testRun.findMany({
      where: {
        OR: [{ planId: { in: planIds } }, { requestedById: { in: userIds } }],
      },
      select: { id: true },
    });
    const runIds = runs.map((run) => run.id);

    await prisma.measurement.deleteMany({
      where: { runId: { in: runIds } },
    });
    await prisma.runEvent.deleteMany({ where: { runId: { in: runIds } } });
    await prisma.runStep.deleteMany({ where: { runId: { in: runIds } } });
    await prisma.testRun.deleteMany({ where: { id: { in: runIds } } });

    await prisma.planStep.deleteMany({ where: { planId: { in: planIds } } });
    await prisma.planRevision.deleteMany({
      where: { planId: { in: planIds } },
    });
    await prisma.stepIdentity.deleteMany({
      where: { planId: { in: planIds } },
    });
    await prisma.testPlan.deleteMany({ where: { id: { in: planIds } } });

    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });

    const profiles = await prisma.deviceProfile.deleteMany({
      where: {
        code: { in: DEMO_DEVICE_PROFILES.map((profile) => profile.code) },
      },
    });

    return {
      runs: runIds.length,
      plans: planIds.length,
      users: userIds.length,
      profiles: profiles.count,
    };
  } finally {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "plan_revisions" ENABLE TRIGGER USER',
    );
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "plan_steps" ENABLE TRIGGER USER',
    );
  }
}
