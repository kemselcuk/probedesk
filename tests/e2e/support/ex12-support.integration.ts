import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import {
  PlanRevisionState,
  PrismaClient,
  Role,
} from "../../../apps/api/src/prisma/generated/client.js";
import { createPublishedRunFixture } from "../../../apps/api/test/support/run-helpers.js";
import {
  createRunMetadataTestDevice,
  createRunMetadataTestProfile,
  createRunMetadataTestUser,
  deleteRunMetadataTestData,
  seedMetadataRun,
} from "../../../apps/api/test/support/run-metadata-helpers.js";
import {
  cleanupE2eData,
  prepareE2eDatabase,
  requireE2eDatabaseUrl,
} from "./database.js";

/**
 * Real-PostgreSQL verification for the EX-12 E2E fixture/cleanup layer.
 *
 * This is not a Playwright spec: it needs no browser, API process or Angular
 * build. Run it against a freshly prepared dedicated `_test` database after
 * `node scripts/e2e-isolated.mjs prepare`:
 *
 *   npx tsx tests/e2e/support/ex12-support.integration.ts
 *
 * It proves baseline/preservation, FK order for devices and copy provenance,
 * zero active runs, explicit tracked-id cleanup, and restoration of the
 * immutability triggers both after success and after a forced failure.
 * It prints counts only, never connection strings, stored hashes or rows.
 */

const CLEANUP_TRIGGER_TABLES = [
  "run_events",
  "measurements",
  "run_steps",
  "test_runs",
  "plan_steps",
  "plan_revisions",
];
const DEMO_DEVICE_FIXTURE_ID = "5f0d3c1e-2a4b-4c6d-8e9f-000000000001";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertCleanupTriggersEnabled(
  client: Client,
  label: string,
): Promise<void> {
  const result = await client.query<{ tgname: string; tgenabled: string }>(
    `SELECT t.tgname, t.tgenabled
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
      WHERE c.relname = ANY($1::text[])
        AND NOT t.tgisinternal
      ORDER BY t.tgname`,
    [CLEANUP_TRIGGER_TABLES],
  );

  const disabled = result.rows.filter((row) => row.tgenabled !== "O");
  assert(
    disabled.length === 0,
    `${label}: cleanup left triggers disabled (${disabled
      .map((row) => row.tgname)
      .join(", ")}).`,
  );
}

async function installFailureTrigger(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    `
      CREATE OR REPLACE FUNCTION "ex12_support_fail_copy_delete"()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'ex12 support forced cleanup failure';
      END;
      $$
    `,
  );
  await prisma.$executeRawUnsafe(`
        DROP TRIGGER IF EXISTS "ex12_support_fail_copy_delete"
        ON "plan_copy_requests"
      `);
  await prisma.$executeRawUnsafe(`
        CREATE TRIGGER "ex12_support_fail_copy_delete"
        BEFORE DELETE ON "plan_copy_requests"
        FOR EACH ROW
        EXECUTE FUNCTION "ex12_support_fail_copy_delete"()
      `);
}

async function removeFailureTrigger(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    DROP TRIGGER IF EXISTS "ex12_support_fail_copy_delete"
    ON "plan_copy_requests"
  `);
  await prisma.$executeRawUnsafe(
    `DROP FUNCTION IF EXISTS "ex12_support_fail_copy_delete"()`,
  );
}

async function expectCleanupFailure(
  action: () => Promise<unknown>,
): Promise<void> {
  try {
    await action();
  } catch {
    return;
  }

  throw new Error(
    "Expected cleanup to fail while the forced trigger was active.",
  );
}

async function main(): Promise<void> {
  const connectionString = requireE2eDatabaseUrl();
  const baseline = await prepareE2eDatabase();
  assert(
    baseline.demoUsers === 3 &&
      baseline.demoProfiles === 1 &&
      baseline.demoDevices === 2,
    "The isolated database is not seeded with the three demo users, one profile and two demo devices.",
  );
  assert(
    baseline.activeRuns === 0,
    "The isolated database already has an active run.",
  );
  assert(
    baseline.planCopyRequests === 0,
    "The verification expects a clean copy-provenance baseline.",
  );

  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      application_name: "probedesk-ex12-support",
      connectionTimeoutMillis: 2000,
    }),
  });
  const triggerClient = new Client({
    connectionString,
    application_name: "probedesk-ex12-trigger-check",
    connectionTimeoutMillis: 5000,
  });

  const user = await createRunMetadataTestUser(prisma, Role.PLANNER);
  const profile = await createRunMetadataTestProfile(prisma);
  const source = await prisma.planRevision.findFirstOrThrow({
    where: {
      state: PlanRevisionState.PUBLISHED,
      plan: { createdBy: { email: "planner@probedesk.local" } },
    },
  });

  let trackedTarget: { id: string } | undefined;
  let trackedDevice: { id: string } | undefined;
  let unrelatedTarget: { id: string } | undefined;
  let unrelatedDevice: { id: string } | undefined;
  let unrelatedCopyId: string | undefined;

  try {
    await triggerClient.connect();
    await assertCleanupTriggersEnabled(triggerClient, "initial state");

    const device = await createRunMetadataTestDevice(prisma, {
      deviceProfileId: profile.id,
      createdById: user.id,
      name: `EX-12 tracked device ${randomUUID().slice(0, 8)}`,
      serialNumber: `EX12-TRACKED-${randomUUID().slice(0, 8)}`,
    });
    trackedDevice = device;
    const fixture = await createPublishedRunFixture(prisma, user.id, profile, {
      planName: `EX-12 tracked run plan ${randomUUID().slice(0, 8)}`,
    });
    await seedMetadataRun(prisma, {
      fixture,
      requestedById: user.id,
      startedAt: "2026-11-08T12:00:00.000Z",
      device: {
        id: device.id,
        name: device.name,
        serialNumber: device.serialNumber,
        deviceProfileId: profile.id,
      },
    });

    const target = await prisma.testPlan.create({
      data: { createdById: user.id, deviceProfileId: profile.id },
    });
    trackedTarget = target;
    await prisma.planCopyRequest.create({
      data: {
        requestedById: user.id,
        idempotencyKey: `ex12-tracked-${randomUUID()}`,
        requestHash: "ex12-support-tracked-request-hash",
        sourceVersionId: source.id,
        targetPlanId: target.id,
      },
    });

    const preservedDevice = await createRunMetadataTestDevice(prisma, {
      deviceProfileId: profile.id,
      createdById: user.id,
      name: `EX-12 preserved device ${randomUUID().slice(0, 8)}`,
      serialNumber: `EX12-PRESERVED-${randomUUID().slice(0, 8)}`,
    });
    unrelatedDevice = preservedDevice;
    const preservedTarget = await prisma.testPlan.create({
      data: { createdById: user.id, deviceProfileId: profile.id },
    });
    unrelatedTarget = preservedTarget;
    const preservedCopy = await prisma.planCopyRequest.create({
      data: {
        requestedById: user.id,
        idempotencyKey: `ex12-preserved-${randomUUID()}`,
        requestHash: "ex12-support-preserved-request-hash",
        sourceVersionId: source.id,
        targetPlanId: preservedTarget.id,
      },
    });
    unrelatedCopyId = preservedCopy.id;

    const summary = await cleanupE2eData({
      planIds: [target.id],
      deviceIds: [device.id],
      sessionBaseline: baseline.sessionIds,
      userEmails: [],
    });
    assert(
      summary.devices === 1,
      "Cleanup did not delete exactly the tracked device.",
    );
    assert(
      summary.planCopyRequests === 1,
      "Cleanup did not delete exactly the tracked copy request.",
    );
    assert(
      summary.runs === 1,
      "Cleanup did not delete the run that referenced the tracked device.",
    );
    assert(
      summary.remainingDeviceIds === 0,
      "A tracked device was left behind.",
    );
    assert(
      summary.remainingPlanCopyRequests === 0,
      "A tracked copy request was left behind.",
    );
    assert(summary.activeRunsAfter === 0, "Cleanup left an active run behind.");
    await assertCleanupTriggersEnabled(
      triggerClient,
      "after successful cleanup",
    );

    assert(
      (await prisma.device.count({ where: { id: device.id } })) === 0,
      "The tracked device still exists.",
    );
    assert(
      (await prisma.testPlan.count({ where: { id: target.id } })) === 0,
      "The tracked copy target plan still exists.",
    );
    assert(
      (await prisma.planCopyRequest.count({
        where: { targetPlanId: target.id },
      })) === 0,
      "Copy provenance for the tracked target still exists.",
    );

    assert(
      (await prisma.device.count({ where: { id: preservedDevice.id } })) === 1,
      "Cleanup deleted an unrelated preserved device.",
    );
    assert(
      (await prisma.testPlan.count({ where: { id: preservedTarget.id } })) ===
        1,
      "Cleanup deleted an unrelated preserved plan.",
    );
    assert(
      (await prisma.planCopyRequest.count({
        where: { id: preservedCopy.id },
      })) === 1,
      "Cleanup deleted unrelated copy provenance.",
    );

    const namedDevice = await createRunMetadataTestDevice(prisma, {
      deviceProfileId: profile.id,
      createdById: user.id,
      name: `EX-12 named device ${randomUUID().slice(0, 8)}`,
      serialNumber: `EX12-NAMED-${randomUUID().slice(0, 8)}`,
    });
    const namedSummary = await cleanupE2eData({
      deviceNames: [namedDevice.name],
      sessionBaseline: baseline.sessionIds,
      userEmails: [],
    });
    assert(
      namedSummary.devices === 1,
      "Cleanup did not resolve and delete the named device.",
    );
    assert(
      (await prisma.device.count({ where: { id: namedDevice.id } })) === 0,
      "The explicitly named device still exists.",
    );

    await expectCleanupFailure(() =>
      cleanupE2eData({
        deviceIds: [DEMO_DEVICE_FIXTURE_ID],
        sessionBaseline: baseline.sessionIds,
        userEmails: [],
      }),
    );
    assert(
      (await prisma.device.count({ where: { id: DEMO_DEVICE_FIXTURE_ID } })) ===
        1,
      "Cleanup must refuse to delete a shared demo device fixture.",
    );

    const failureTarget = await prisma.testPlan.create({
      data: { createdById: user.id, deviceProfileId: profile.id },
    });
    await prisma.planCopyRequest.create({
      data: {
        requestedById: user.id,
        idempotencyKey: `ex12-failure-${randomUUID()}`,
        requestHash: "ex12-support-failure-request-hash",
        sourceVersionId: source.id,
        targetPlanId: failureTarget.id,
      },
    });

    await installFailureTrigger(prisma);
    try {
      await expectCleanupFailure(() =>
        cleanupE2eData({
          planIds: [failureTarget.id],
          sessionBaseline: baseline.sessionIds,
          userEmails: [],
        }),
      );
    } finally {
      await removeFailureTrigger(prisma);
    }

    await assertCleanupTriggersEnabled(triggerClient, "after forced failure");
    assert(
      (await prisma.testPlan.count({ where: { id: failureTarget.id } })) === 1,
      "A failed cleanup should roll back the tracked target plan.",
    );
    assert(
      (await prisma.planCopyRequest.count({
        where: { targetPlanId: failureTarget.id },
      })) === 1,
      "A failed cleanup should roll back the copy provenance.",
    );

    const retried = await cleanupE2eData({
      planIds: [failureTarget.id],
      sessionBaseline: baseline.sessionIds,
      userEmails: [],
    });
    assert(
      retried.planCopyRequests === 1,
      "The retried cleanup did not remove the forced-failure provenance.",
    );
    await assertCleanupTriggersEnabled(triggerClient, "after retried cleanup");

    await prisma.planCopyRequest.deleteMany({
      where: { id: { in: [preservedCopy.id] } },
    });
    await deleteRunMetadataTestData(prisma);

    const after = await prepareE2eDatabase();
    assert(after.plans === 1, "The demo plan baseline was not restored.");
    assert(after.runs === 4, "The demo run baseline was not restored.");
    assert(after.devices === 2, "The demo device baseline was not restored.");
    assert(
      after.demoDevices === 2,
      "The two demo device fixtures were not preserved.",
    );
    assert(after.planCopyRequests === 0, "Copy-provenance residue remains.");
    assert(after.activeRuns === 0, "An active run remains after cleanup.");

    console.log(
      `[ex12-support] tracked cleanup: devices=${summary.devices} ` +
        `copyRequests=${summary.planCopyRequests} runs=${summary.runs} ` +
        `runSteps=${summary.runSteps}`,
    );
    console.log(
      "[ex12-support] unrelated device, plan and copy provenance were preserved",
    );
    console.log(
      "[ex12-support] named-device cleanup worked and the shared demo device was protected",
    );
    console.log(
      "[ex12-support] cleanup triggers restored after success, forced failure and retry",
    );
    console.log(
      `[ex12-support] restored baseline: plans=${after.plans} runs=${after.runs} ` +
        `devices=${after.devices} demoDevices=${after.demoDevices} ` +
        `copyRequests=${after.planCopyRequests} activeRuns=${after.activeRuns}`,
    );
  } finally {
    await triggerClient.end().catch(() => undefined);
    await removeFailureTrigger(prisma).catch(() => undefined);

    if (unrelatedCopyId) {
      await prisma.planCopyRequest
        .deleteMany({ where: { id: unrelatedCopyId } })
        .catch(() => undefined);
    }
    if (unrelatedTarget) {
      await prisma.testPlan
        .deleteMany({ where: { id: unrelatedTarget.id } })
        .catch(() => undefined);
    }
    if (unrelatedDevice) {
      await prisma.device
        .deleteMany({ where: { id: unrelatedDevice.id } })
        .catch(() => undefined);
    }
    if (trackedTarget) {
      await prisma.testPlan
        .deleteMany({ where: { id: trackedTarget.id } })
        .catch(() => undefined);
    }
    if (trackedDevice) {
      await prisma.device
        .deleteMany({ where: { id: trackedDevice.id } })
        .catch(() => undefined);
    }
    await deleteRunMetadataTestData(prisma).catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(
    `[ex12-support] verification failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
});
