import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client } from 'pg';
import {
  PlanRevisionState,
  Prisma,
  PrismaClient,
  Role,
  RunScenario,
  RunStatus,
} from '../src/prisma/generated/client.js';
import type {
  Device,
  PlanRevision,
  TestRun,
} from '../src/prisma/generated/client.js';
import {
  buildRunSnapshot,
  type RunSnapshotSource,
} from '../src/runs/run-snapshot.js';
import { createTestUser, type TestUser } from './support/auth-helpers.js';
import {
  applyMigrationSql,
  applyMigrationsToSchema,
  deleteFeatureRunsAndDevices,
  deleteFeatureSchemaTestData,
  dropIsolatedSchema,
  FEATURE_SCHEMA_EMAIL_PREFIX,
  FEATURE_SCHEMA_MIGRATION_NAME,
  FEATURE_SCHEMA_PROFILE_CODE_PREFIX,
  listMigrationNames,
  readLegacyFingerprint,
  seedLegacyUpgradeFixture,
} from './support/feature-schema-helpers.js';

function readPrismaErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }

  return undefined;
}

interface DeviceSnapshot {
  id: string;
  name: string;
  serialNumber: string;
  deviceProfileId: string;
}

describe('feature pack 1 schema (e2e)', () => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  let prisma: PrismaClient;
  let planner: TestUser;
  let otherPlanner: TestUser;
  let profileId: string;
  let source: RunSnapshotSource;

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error(
        'TEST_DATABASE_URL must be set for the feature schema integration test.',
      );
    }

    prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: testDatabaseUrl,
        application_name: 'probedesk-feature-schema-e2e',
        connectionTimeoutMillis: 2000,
      }),
    });

    await deleteFeatureSchemaTestData(prisma);

    planner = await createTestUser(prisma, {
      role: Role.PLANNER,
      email: `${FEATURE_SCHEMA_EMAIL_PREFIX}planner-${randomUUID()}@example.test`,
      password: 'Feature-E2E-Password-9',
    });
    otherPlanner = await createTestUser(prisma, {
      role: Role.PLANNER,
      email: `${FEATURE_SCHEMA_EMAIL_PREFIX}other-${randomUUID()}@example.test`,
      password: 'Feature-E2E-Password-9',
    });
    const profile = await prisma.deviceProfile.create({
      data: {
        code: `${FEATURE_SCHEMA_PROFILE_CODE_PREFIX}${randomUUID()}`,
        name: 'Feature schema device',
        description: 'Fixture profile for feature schema tests',
      },
    });
    profileId = profile.id;
    source = await createPublishedPlanFixture(
      prisma,
      planner.id,
      profileId,
      'Source',
    );
  });

  afterEach(async () => {
    await deleteFeatureRunsAndDevices(prisma);
  });

  afterAll(async () => {
    if (!prisma) {
      return;
    }

    await deleteFeatureSchemaTestData(prisma);
    await prisma.$disconnect();
  });

  async function createDevice(
    options: {
      name?: string;
      serialNumber?: string;
      description?: string | null;
      archivedAt?: Date | null;
      createdById?: string;
      deviceProfileId?: string;
    } = {},
  ): Promise<Device> {
    const serialNumber = options.serialNumber ?? `SN-${randomUUID()}`;

    return prisma.device.create({
      data: {
        deviceProfileId: options.deviceProfileId ?? profileId,
        createdById: options.createdById ?? planner.id,
        name: options.name ?? `Bench ${serialNumber.slice(-8)}`,
        serialNumber,
        serialNumberKey: serialNumber.toUpperCase(),
        description: options.description ?? null,
        archivedAt: options.archivedAt ?? null,
      },
    });
  }

  function snapshotOf(device: Device): DeviceSnapshot {
    return {
      id: device.id,
      name: device.name,
      serialNumber: device.serialNumber,
      deviceProfileId: device.deviceProfileId,
    };
  }

  async function createRun(
    options: {
      requestedById?: string;
      idempotencyKey?: string;
      deviceId?: string | null;
      deviceSnapshot?: DeviceSnapshot | null;
      batchNumber?: string | null;
      batchNumberKey?: string | null;
    } = {},
  ): Promise<
    TestRun & { steps: Array<{ id: string; logicalStepId: string }> }
  > {
    const snapshot = buildRunSnapshot(
      source,
      {
        scenario: RunScenario.NORMAL,
        seed: 123_456_789n,
        simulatorVersion: 'mulberry32-v1',
        evaluationVersion: 'decimal-v1',
      },
      {
        requestedById: options.requestedById ?? planner.id,
        idempotencyKey: options.idempotencyKey ?? `feature-run-${randomUUID()}`,
        requestHash: `feature-request-${randomUUID()}`,
        startedAt: new Date(),
      },
    );

    return prisma.testRun.create({
      data: {
        ...snapshot.run,
        deviceId: options.deviceId ?? null,
        deviceSnapshot: options.deviceSnapshot
          ? (options.deviceSnapshot as unknown as Prisma.InputJsonValue)
          : Prisma.DbNull,
        batchNumber: options.batchNumber ?? null,
        batchNumberKey: options.batchNumberKey ?? null,
        steps: { create: snapshot.steps },
      },
      include: { steps: { orderBy: { position: 'asc' } } },
    });
  }

  async function terminalize(
    runId: string,
    status: RunStatus = RunStatus.CANCELLED,
  ): Promise<void> {
    const run = await prisma.testRun.findUniqueOrThrow({
      where: { id: runId },
    });
    const completed = status === RunStatus.COMPLETED;

    await prisma.testRun.update({
      where: { id: runId },
      data: {
        status,
        outcome: completed ? 'PASSED' : null,
        recordedSampleCount: completed
          ? run.expectedSampleCount
          : run.recordedSampleCount,
        finishedAt: new Date(),
      },
    });
  }

  async function cloneTerminalRun(
    templateId: string,
    metadata: {
      deviceId?: string | null;
      deviceSnapshot?: Partial<DeviceSnapshot> | null;
      batchNumber?: string | null;
      batchNumberKey?: string | null;
    },
  ): Promise<void> {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "test_runs" (
         "id", "planId", "planRevisionId", "planNameSnapshot",
         "versionNumberSnapshot", "profileSnapshot", "deviceId",
         "deviceSnapshot", "batchNumber", "batchNumberKey", "status",
         "outcome", "requestedById", "scenario", "seed", "errorProbability",
         "failureStepId", "simulatorVersion", "evaluationVersion",
         "idempotencyKey", "requestHash", "eventSequence",
         "expectedSampleCount", "recordedSampleCount", "startedAt",
         "finishedAt", "cancelledById", "reasonCode"
       )
       SELECT
         gen_random_uuid(), "planId", "planRevisionId", "planNameSnapshot",
         "versionNumberSnapshot", "profileSnapshot", $2::uuid,
         $3::jsonb, $4, $5, "status", "outcome", "requestedById",
         "scenario", "seed", "errorProbability", "failureStepId",
         "simulatorVersion", "evaluationVersion", $6, "requestHash",
         "eventSequence", "expectedSampleCount", "recordedSampleCount",
         "startedAt", "finishedAt", "cancelledById", "reasonCode"
       FROM "test_runs"
       WHERE "id" = $1::uuid`,
      templateId,
      metadata.deviceId ?? null,
      metadata.deviceSnapshot ? JSON.stringify(metadata.deviceSnapshot) : null,
      metadata.batchNumber ?? null,
      metadata.batchNumberKey ?? null,
      `cloned-${randomUUID()}`,
    );
  }

  function rawRunUpdate(runId: string, assignments: string): Promise<number> {
    return prisma.$executeRawUnsafe(
      `UPDATE "test_runs" SET ${assignments} WHERE "id" = $1::uuid`,
      runId,
    );
  }

  it('applies the additive feature migration and exposes nullable run metadata', async () => {
    const migrations = await prisma.$queryRaw<
      Array<{ migration_name: string; finished_at: Date | null }>
    >`
      SELECT "migration_name", "finished_at"
      FROM "_prisma_migrations"
      WHERE "migration_name" = ${FEATURE_SCHEMA_MIGRATION_NAME}
    `;
    expect(migrations).toHaveLength(1);
    expect(migrations[0]?.finished_at).not.toBeNull();

    const columns = await prisma.$queryRaw<
      Array<{
        column_name: string;
        is_nullable: string;
        data_type: string;
      }>
    >`
      SELECT column_name, is_nullable, data_type
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'test_runs'
        AND column_name IN (
          'deviceId', 'deviceSnapshot', 'batchNumber', 'batchNumberKey'
        )
      ORDER BY column_name
    `;

    expect(columns).toEqual([
      { column_name: 'batchNumber', is_nullable: 'YES', data_type: 'text' },
      {
        column_name: 'batchNumberKey',
        is_nullable: 'YES',
        data_type: 'text',
      },
      { column_name: 'deviceId', is_nullable: 'YES', data_type: 'uuid' },
      { column_name: 'deviceSnapshot', is_nullable: 'YES', data_type: 'jsonb' },
    ]);

    const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name IN ('devices', 'plan_copy_requests')
      ORDER BY table_name
    `;
    expect(tables.map((table) => table.table_name)).toEqual([
      'devices',
      'plan_copy_requests',
    ]);

    const trigger = await prisma.$queryRaw<Array<{ tgname: string }>>`
      SELECT tgname
      FROM pg_trigger
      WHERE tgrelid = 'test_runs'::regclass
        AND tgname = 'test_runs_snapshot_immutable'
    `;
    expect(trigger).toHaveLength(1);
  });

  it('enforces canonical serial uniqueness inside a profile, including archived devices', async () => {
    const device = await createDevice({ serialNumber: 'SN-AbC-001' });
    expect(device.serialNumber).toBe('SN-AbC-001');
    expect(device.serialNumberKey).toBe('SN-ABC-001');
    expect(device.archivedAt).toBeNull();

    await expect(
      createDevice({ serialNumber: 'sn-abc-001' }),
    ).rejects.toMatchObject({ code: 'P2002' });

    await prisma.device.update({
      where: { id: device.id },
      data: { archivedAt: new Date() },
    });
    await expect(
      createDevice({ serialNumber: 'sN-AbC-001' }),
    ).rejects.toMatchObject({ code: 'P2002' });

    const other = await createDevice({ serialNumber: 'SN-ABC-002' });
    expect(other.serialNumberKey).toBe('SN-ABC-002');
  });

  it('rejects invalid device identity fields at the database', async () => {
    const device = await createDevice({ serialNumber: 'SN-VALID-001' });

    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "devices" SET "name" = '' WHERE "id" = $1::uuid`,
        device.id,
      ),
    ).rejects.toThrow(/devices_name_check/);
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "devices" SET "name" = '   ' WHERE "id" = $1::uuid`,
        device.id,
      ),
    ).rejects.toThrow(/devices_name_check/);
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "devices" SET "name" = $2 WHERE "id" = $1::uuid`,
        device.id,
        'x'.repeat(101),
      ),
    ).rejects.toThrow(/devices_name_check/);

    for (const invalidSerial of [
      'SN WITH SPACE',
      'SN*INVALID',
      'SN@INVALID',
      'x'.repeat(101),
    ]) {
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE "devices"
           SET "serialNumber" = $2, "serialNumberKey" = upper($2)
           WHERE "id" = $1::uuid`,
          device.id,
          invalidSerial,
        ),
      ).rejects.toThrow(/devices_serialNumber(Key)?_check/);
    }

    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "devices" SET "serialNumberKey" = 'OTHER-001'
         WHERE "id" = $1::uuid`,
        device.id,
      ),
    ).rejects.toThrow(/devices_serialNumberKey_check/);
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "devices" SET "serialNumberKey" = lower("serialNumber")
         WHERE "id" = $1::uuid`,
        device.id,
      ),
    ).rejects.toThrow(/devices_serialNumberKey_check/);

    for (const invalidDescription of ['', '   ', 'x'.repeat(501)]) {
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE "devices" SET "description" = $2 WHERE "id" = $1::uuid`,
          device.id,
          invalidDescription,
        ),
      ).rejects.toThrow(/devices_description_check/);
    }

    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "devices" SET "editRevision" = 0 WHERE "id" = $1::uuid`,
        device.id,
      ),
    ).rejects.toThrow(/devices_editRevision_check/);

    const stored = await prisma.device.findUniqueOrThrow({
      where: { id: device.id },
    });
    expect(stored.name).toBe(device.name);
    expect(stored.serialNumber).toBe('SN-VALID-001');
    expect(stored.serialNumberKey).toBe('SN-VALID-001');
    expect(stored.description).toBeNull();
    expect(stored.editRevision).toBe(1);
  });

  it('keeps device profile and creator relations under RESTRICT', async () => {
    const isolatedProfile = await prisma.deviceProfile.create({
      data: {
        code: `${FEATURE_SCHEMA_PROFILE_CODE_PREFIX}${randomUUID()}`,
        name: 'Isolated device profile',
      },
    });
    const owner = await createTestUser(prisma, {
      role: Role.PLANNER,
      email: `${FEATURE_SCHEMA_EMAIL_PREFIX}owner-${randomUUID()}@example.test`,
      password: 'Feature-E2E-Password-9',
    });
    const device = await createDevice({
      deviceProfileId: isolatedProfile.id,
      createdById: owner.id,
      serialNumber: 'SN-RESTRICT-001',
    });

    await expect(
      prisma.deviceProfile.delete({ where: { id: isolatedProfile.id } }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      prisma.user.delete({ where: { id: owner.id } }),
    ).rejects.toMatchObject({ code: 'P2003' });

    await expect(
      prisma.device.delete({ where: { id: device.id } }),
    ).resolves.toMatchObject({ id: device.id });
  });

  it('enforces plan-copy idempotency, RESTRICT relations and one winner under concurrency', async () => {
    const targetPlan = await createPlan();
    await createDraft(targetPlan.id, 'Copy target');
    const key = `copy-${randomUUID()}`;

    const first = await prisma.planCopyRequest.create({
      data: {
        requestedById: planner.id,
        idempotencyKey: key,
        requestHash: `copy-hash-${randomUUID()}`,
        sourceVersionId: source.revisionId,
        targetPlanId: targetPlan.id,
      },
    });
    expect(first.sourceVersionId).toBe(source.revisionId);
    expect(first.targetPlanId).toBe(targetPlan.id);

    await expect(
      prisma.planCopyRequest.create({
        data: {
          requestedById: planner.id,
          idempotencyKey: key,
          requestHash: `copy-hash-${randomUUID()}`,
          sourceVersionId: source.revisionId,
          targetPlanId: targetPlan.id,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    const otherUser = await prisma.planCopyRequest.create({
      data: {
        requestedById: otherPlanner.id,
        idempotencyKey: key,
        requestHash: `copy-hash-${randomUUID()}`,
        sourceVersionId: source.revisionId,
        targetPlanId: targetPlan.id,
      },
    });
    expect(otherUser.requestedById).toBe(otherPlanner.id);

    const concurrentKey = `copy-concurrent-${randomUUID()}`;
    const concurrentTarget = await createPlan();
    const results = await Promise.allSettled([
      prisma.planCopyRequest.create({
        data: {
          requestedById: planner.id,
          idempotencyKey: concurrentKey,
          requestHash: `copy-hash-${randomUUID()}`,
          sourceVersionId: source.revisionId,
          targetPlanId: concurrentTarget.id,
        },
      }),
      prisma.planCopyRequest.create({
        data: {
          requestedById: planner.id,
          idempotencyKey: concurrentKey,
          requestHash: `copy-hash-${randomUUID()}`,
          sourceVersionId: source.revisionId,
          targetPlanId: concurrentTarget.id,
        },
      }),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(readPrismaErrorCode(rejected?.reason)).toBe('P2002');

    const draftSource = await createDraft(
      (await createPlan()).id,
      'Draft copy source',
    );
    const emptyTarget = await createPlan();
    const copyOwner = await createTestUser(prisma, {
      role: Role.PLANNER,
      email: `${FEATURE_SCHEMA_EMAIL_PREFIX}copy-owner-${randomUUID()}@example.test`,
      password: 'Feature-E2E-Password-9',
    });
    await prisma.planCopyRequest.create({
      data: {
        requestedById: copyOwner.id,
        idempotencyKey: `copy-restrict-${randomUUID()}`,
        requestHash: `copy-hash-${randomUUID()}`,
        sourceVersionId: draftSource.id,
        targetPlanId: emptyTarget.id,
      },
    });

    await expect(
      prisma.planRevision.delete({ where: { id: draftSource.id } }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      prisma.testPlan.delete({ where: { id: emptyTarget.id } }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      prisma.user.delete({ where: { id: copyOwner.id } }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('supports an atomic copy transaction and leaves no orphan when it rolls back', async () => {
    const targetPlanId = randomUUID();
    const draftRevisionId = randomUUID();
    const identityId = randomUUID();
    const copyKey = `copy-atomic-${randomUUID()}`;

    const sourceBefore = await prisma.planRevision.findUniqueOrThrow({
      where: { id: source.revisionId },
      include: { steps: { orderBy: { position: 'asc' } } },
    });

    const created = await prisma.$transaction(async (transaction) => {
      const plan = await transaction.testPlan.create({
        data: {
          id: targetPlanId,
          createdById: planner.id,
          deviceProfileId: profileId,
        },
      });
      const draft = await transaction.planRevision.create({
        data: {
          id: draftRevisionId,
          planId: plan.id,
          state: PlanRevisionState.DRAFT,
          name: 'Atomic copy draft',
          editRevision: 1,
        },
      });
      await transaction.stepIdentity.create({
        data: { id: identityId, planId: plan.id },
      });
      await transaction.planStep.create({
        data: {
          planId: plan.id,
          revisionId: draft.id,
          logicalStepId: identityId,
          position: 1,
          name: sourceBefore.steps[0]?.name ?? 'Output voltage',
          unit: sourceBefore.steps[0]?.unit ?? 'V',
          minimum: sourceBefore.steps[0]?.minimum ?? '4.750000',
          maximum: sourceBefore.steps[0]?.maximum ?? '5.250000',
          sampleCount: sourceBefore.steps[0]?.sampleCount ?? 1,
          intervalMs: sourceBefore.steps[0]?.intervalMs ?? 200,
        },
      });
      const copy = await transaction.planCopyRequest.create({
        data: {
          requestedById: planner.id,
          idempotencyKey: copyKey,
          requestHash: `copy-hash-${randomUUID()}`,
          sourceVersionId: source.revisionId,
          targetPlanId: plan.id,
        },
      });

      return { plan, draft, copy };
    });

    expect(created.draft.planId).toBe(created.plan.id);
    expect(created.copy.targetPlanId).toBe(created.plan.id);
    expect(
      await prisma.planCopyRequest.count({ where: { id: created.copy.id } }),
    ).toBe(1);

    const rolledBackPlanId = randomUUID();
    const rolledBackDraftId = randomUUID();
    const rolledBackIdentityId = randomUUID();
    const rolledBackKey = `copy-rollback-${randomUUID()}`;

    await expect(
      prisma.$transaction(async (transaction) => {
        const plan = await transaction.testPlan.create({
          data: {
            id: rolledBackPlanId,
            createdById: planner.id,
            deviceProfileId: profileId,
          },
        });
        const draft = await transaction.planRevision.create({
          data: {
            id: rolledBackDraftId,
            planId: plan.id,
            state: PlanRevisionState.DRAFT,
            name: 'Rolled back draft',
            editRevision: 1,
          },
        });
        await transaction.stepIdentity.create({
          data: { id: rolledBackIdentityId, planId: plan.id },
        });
        await transaction.planStep.create({
          data: {
            planId: plan.id,
            revisionId: draft.id,
            logicalStepId: rolledBackIdentityId,
            position: 1,
            name: 'Output voltage',
            unit: 'V',
            minimum: '4.750000',
            maximum: '5.250000',
            sampleCount: 1,
            intervalMs: 200,
          },
        });
        await transaction.planStep.create({
          data: {
            planId: plan.id,
            revisionId: draft.id,
            logicalStepId: randomUUID(),
            position: 1,
            name: 'Duplicate position',
            unit: 'V',
            minimum: '4.750000',
            maximum: '5.250000',
            sampleCount: 1,
            intervalMs: 200,
          },
        });
        await transaction.planCopyRequest.create({
          data: {
            requestedById: planner.id,
            idempotencyKey: rolledBackKey,
            requestHash: `copy-hash-${randomUUID()}`,
            sourceVersionId: source.revisionId,
            targetPlanId: plan.id,
          },
        });
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    expect(
      await prisma.testPlan.count({ where: { id: rolledBackPlanId } }),
    ).toBe(0);
    expect(
      await prisma.planCopyRequest.count({
        where: { idempotencyKey: rolledBackKey },
      }),
    ).toBe(0);

    const sourceAfter = await prisma.planRevision.findUniqueOrThrow({
      where: { id: source.revisionId },
      include: { steps: { orderBy: { position: 'asc' } } },
    });
    expect(sourceAfter.name).toBe(sourceBefore.name);
    expect(sourceAfter.versionNumber).toBe(sourceBefore.versionNumber);
    expect(
      sourceAfter.steps.map((step) => ({
        logicalStepId: step.logicalStepId,
        position: step.position,
        name: step.name,
        unit: step.unit,
        minimum: step.minimum,
        maximum: step.maximum,
        sampleCount: step.sampleCount,
        intervalMs: step.intervalMs,
      })),
    ).toEqual(
      sourceBefore.steps.map((step) => ({
        logicalStepId: step.logicalStepId,
        position: step.position,
        name: step.name,
        unit: step.unit,
        minimum: step.minimum,
        maximum: step.maximum,
        sampleCount: step.sampleCount,
        intervalMs: step.intervalMs,
      })),
    );
  });

  it('accepts device and batch metadata, including a batch without a device', async () => {
    const device = await createDevice({ serialNumber: 'SN-META-001' });
    const deviceRun = await createRun({
      deviceId: device.id,
      deviceSnapshot: snapshotOf(device),
      batchNumber: 'Batch-AbC-01',
      batchNumberKey: 'BATCH-ABC-01',
    });

    expect(deviceRun.deviceId).toBe(device.id);
    expect(deviceRun.deviceSnapshot).toEqual(snapshotOf(device));
    expect(deviceRun.batchNumber).toBe('Batch-AbC-01');
    expect(deviceRun.batchNumberKey).toBe('BATCH-ABC-01');
    expect(deviceRun.steps).toHaveLength(source.steps.length);
    await terminalize(deviceRun.id);

    const batchOnly = await createRun({
      batchNumber: 'Batch-XYZ-02',
      batchNumberKey: 'BATCH-XYZ-02',
    });
    expect(batchOnly.deviceId).toBeNull();
    expect(batchOnly.deviceSnapshot).toBeNull();
    expect(batchOnly.batchNumber).toBe('Batch-XYZ-02');
    await terminalize(batchOnly.id);

    const legacyStyle = await createRun();
    expect(legacyStyle.deviceId).toBeNull();
    expect(legacyStyle.deviceSnapshot).toBeNull();
    expect(legacyStyle.batchNumber).toBeNull();
    expect(legacyStyle.batchNumberKey).toBeNull();
    await terminalize(legacyStyle.id);
  });

  it('rejects inconsistent device/batch metadata pairs, canonical keys and snapshot identity', async () => {
    const device = await createDevice({ serialNumber: 'SN-META-002' });
    const template = await createRun();
    await terminalize(template.id);

    await expect(
      cloneTerminalRun(template.id, { deviceId: device.id }),
    ).rejects.toThrow(/test_runs_device_metadata_check/);

    await expect(
      cloneTerminalRun(template.id, {
        deviceSnapshot: snapshotOf(device),
      }),
    ).rejects.toThrow(/test_runs_device_metadata_check/);

    const otherId = randomUUID();
    await expect(
      cloneTerminalRun(template.id, {
        deviceId: device.id,
        deviceSnapshot: { ...snapshotOf(device), id: otherId },
      }),
    ).rejects.toThrow(/test_runs_device_snapshot_check/);

    // PostgreSQL CHECK accepts UNKNOWN unless it is explicitly required to be
    // TRUE. Missing JSON keys must be rejected, rather than bypass validation.
    for (const key of [
      'id',
      'name',
      'serialNumber',
      'deviceProfileId',
    ] as const) {
      const incomplete: Partial<DeviceSnapshot> = snapshotOf(device);
      delete incomplete[key];
      await expect(
        cloneTerminalRun(template.id, {
          deviceId: device.id,
          deviceSnapshot: incomplete,
        }),
      ).rejects.toThrow(/test_runs_device_snapshot_check/);
    }

    await expect(
      cloneTerminalRun(template.id, {
        deviceId: device.id,
        deviceSnapshot: {
          ...snapshotOf(device),
          name: '   ',
        },
      }),
    ).rejects.toThrow(/test_runs_device_snapshot_check/);

    await expect(
      cloneTerminalRun(template.id, {
        deviceSnapshot: snapshotOf(device),
        batchNumber: 'Batch-01',
        batchNumberKey: 'BATCH-01',
      }),
    ).rejects.toThrow(/test_runs_device_metadata_check/);

    const missingDeviceId = randomUUID();
    await expect(
      cloneTerminalRun(template.id, {
        batchNumber: 'Batch-01',
        batchNumberKey: 'BATCH-01',
        deviceId: missingDeviceId,
        deviceSnapshot: { ...snapshotOf(device), id: missingDeviceId },
      }),
    ).rejects.toThrow(/test_runs_deviceId_fkey/);

    await expect(
      cloneTerminalRun(template.id, { batchNumber: 'Batch-01' }),
    ).rejects.toThrow(/test_runs_batch_metadata_check/);

    await expect(
      cloneTerminalRun(template.id, { batchNumberKey: 'BATCH-01' }),
    ).rejects.toThrow(/test_runs_batch_metadata_check/);

    await expect(
      cloneTerminalRun(template.id, {
        batchNumber: 'Batch 01',
        batchNumberKey: 'BATCH 01',
      }),
    ).rejects.toThrow(/test_runs_batchNumber(Key)?_check/);

    await expect(
      cloneTerminalRun(template.id, {
        batchNumber: 'Batch-01',
        batchNumberKey: 'BATCH-02',
      }),
    ).rejects.toThrow(/test_runs_batchNumberKey_check/);

    await expect(
      cloneTerminalRun(template.id, {
        batchNumber: 'x'.repeat(101),
        batchNumberKey: 'X'.repeat(101),
      }),
    ).rejects.toThrow(/test_runs_batchNumber(Key)?_check/);

    expect(
      await prisma.testRun.count({ where: { planId: source.planId } }),
    ).toBe(1);
  });

  it('freezes new metadata through the existing snapshot immutability trigger', async () => {
    const device = await createDevice({ serialNumber: 'SN-IMMUTABLE-001' });
    const run = await createRun({
      deviceId: device.id,
      deviceSnapshot: snapshotOf(device),
      batchNumber: 'Batch-IMM-01',
      batchNumberKey: 'BATCH-IMM-01',
    });

    await expect(
      rawRunUpdate(run.id, `"batchNumber" = 'Batch-IMM-02'`),
    ).rejects.toThrow(/Run snapshot fields are immutable/);
    await expect(
      rawRunUpdate(
        run.id,
        `"batchNumber" = 'Batch-IMM-02',
         "batchNumberKey" = 'BATCH-IMM-02'`,
      ),
    ).rejects.toThrow(/Run snapshot fields are immutable/);
    await expect(
      rawRunUpdate(run.id, `"deviceId" = NULL, "deviceSnapshot" = NULL`),
    ).rejects.toThrow(/Run snapshot fields are immutable/);
    await expect(
      rawRunUpdate(
        run.id,
        `"deviceSnapshot" = jsonb_set("deviceSnapshot", '{name}', '"Changed"')`,
      ),
    ).rejects.toThrow(/Run snapshot fields are immutable/);
    await expect(
      rawRunUpdate(run.id, `"planNameSnapshot" = 'Changed after start'`),
    ).rejects.toThrow(/Run snapshot fields are immutable/);
    await expect(
      rawRunUpdate(run.id, `"requestHash" = 'changed-hash'`),
    ).rejects.toThrow(/Run snapshot fields are immutable/);

    await terminalize(run.id);
    await expect(rawRunUpdate(run.id, `"status" = 'RUNNING'`)).rejects.toThrow(
      /A terminal run status is immutable/,
    );

    const stored = await prisma.testRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    expect(stored.deviceId).toBe(device.id);
    expect(stored.batchNumber).toBe('Batch-IMM-01');
    expect(stored.batchNumberKey).toBe('BATCH-IMM-01');
    expect(stored.status).toBe(RunStatus.CANCELLED);
  });

  it('keeps the device snapshot historical while the current device changes', async () => {
    const device = await createDevice({
      name: 'Original bench name',
      serialNumber: 'SN-SNAPSHOT-001',
    });
    const run = await createRun({
      deviceId: device.id,
      deviceSnapshot: snapshotOf(device),
    });

    await prisma.device.update({
      where: { id: device.id },
      data: {
        name: 'Renamed bench name',
        serialNumber: 'SN-SNAPSHOT-002',
        serialNumberKey: 'SN-SNAPSHOT-002',
        editRevision: { increment: 1 },
      },
    });

    const storedRun = await prisma.testRun.findUniqueOrThrow({
      where: { id: run.id },
      include: { device: true },
    });
    expect(storedRun.deviceSnapshot).toEqual(snapshotOf(device));
    expect(storedRun.device?.name).toBe('Renamed bench name');
    expect(storedRun.device?.serialNumber).toBe('SN-SNAPSHOT-002');
    expect(storedRun.device?.editRevision).toBe(2);

    await expect(
      prisma.device.delete({ where: { id: device.id } }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  async function createPlan(): Promise<{ id: string }> {
    return prisma.testPlan.create({
      data: { createdById: planner.id, deviceProfileId: profileId },
      select: { id: true },
    });
  }

  async function createDraft(
    planId: string,
    name = `Draft ${randomUUID().slice(0, 8)}`,
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
});

describe('feature migration upgrade (e2e)', () => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  let client: Client;

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error(
        'TEST_DATABASE_URL must be set for the feature migration test.',
      );
    }

    client = new Client({
      connectionString: testDatabaseUrl,
      application_name: 'probedesk-feature-migration-e2e',
      connectionTimeoutMillis: 2000,
    });
    await client.connect();
  });

  afterAll(async () => {
    if (client) {
      await client.end();
    }
  });

  it('installs the complete migration chain into an empty schema', async () => {
    const schemaName = `feature_empty_${randomUUID().replace(/-/g, '')}`;

    try {
      await applyMigrationsToSchema(client, schemaName, listMigrationNames());

      const tables = await client.query<{ table_name: string }>(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = $1
         ORDER BY table_name`,
        [schemaName],
      );
      expect(tables.rows.map((row) => row.table_name)).toEqual(
        expect.arrayContaining([
          'test_runs',
          'devices',
          'plan_copy_requests',
          'measurements',
          'run_events',
        ]),
      );

      const columns = await client.query<{
        column_name: string;
        is_nullable: string;
      }>(
        `SELECT column_name, is_nullable
         FROM information_schema.columns
         WHERE table_schema = $1
           AND table_name = 'test_runs'
           AND column_name IN (
             'deviceId', 'deviceSnapshot', 'batchNumber', 'batchNumberKey'
           )
         ORDER BY column_name`,
        [schemaName],
      );
      expect(columns.rows).toEqual([
        { column_name: 'batchNumber', is_nullable: 'YES' },
        { column_name: 'batchNumberKey', is_nullable: 'YES' },
        { column_name: 'deviceId', is_nullable: 'YES' },
        { column_name: 'deviceSnapshot', is_nullable: 'YES' },
      ]);

      const counts = await client.query<{
        devices: string;
        copies: string;
        runs: string;
      }>(
        `SELECT
           (SELECT count(*)::text FROM "devices") AS devices,
           (SELECT count(*)::text FROM "plan_copy_requests") AS copies,
           (SELECT count(*)::text FROM "test_runs") AS runs`,
      );
      expect(counts.rows[0]).toEqual({ devices: '0', copies: '0', runs: '0' });
    } finally {
      await dropIsolatedSchema(client, schemaName);
    }
  });

  it('upgrades representative pre-feature data without changing any legacy value', async () => {
    const schemaName = `feature_upgrade_${randomUUID().replace(/-/g, '')}`;
    const previousMigrations = listMigrationNames().filter(
      (migration) => migration < FEATURE_SCHEMA_MIGRATION_NAME,
    );

    try {
      await applyMigrationsToSchema(client, schemaName, previousMigrations);
      const ids = await seedLegacyUpgradeFixture(client);
      const before = await readLegacyFingerprint(client);

      await applyMigrationSql(client, FEATURE_SCHEMA_MIGRATION_NAME);
      const after = await readLegacyFingerprint(client);

      expect(after).toEqual(before);

      const legacyRun = await client.query<{
        deviceId: string | null;
        deviceSnapshot: unknown;
        batchNumber: string | null;
        batchNumberKey: string | null;
        requestHash: string;
        idempotencyKey: string;
        status: string;
      }>(
        `SELECT "deviceId", "deviceSnapshot", "batchNumber",
                "batchNumberKey", "requestHash", "idempotencyKey", "status"
         FROM "test_runs"
         WHERE "id" = $1::uuid`,
        [ids.runId],
      );
      expect(legacyRun.rows[0]).toEqual({
        deviceId: null,
        deviceSnapshot: null,
        batchNumber: null,
        batchNumberKey: null,
        requestHash: 'legacy-request-hash-9f0f',
        idempotencyKey: 'legacy-idempotency-key',
        status: 'COMPLETED',
      });

      const newTables = await client.query<{ table_name: string }>(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = $1
           AND table_name IN ('devices', 'plan_copy_requests')
         ORDER BY table_name`,
        [schemaName],
      );
      expect(newTables.rows.map((row) => row.table_name)).toEqual([
        'devices',
        'plan_copy_requests',
      ]);

      const measurement = await client.query<{ value: string }>(
        `SELECT "value"::text AS "value"
         FROM "measurements"
         WHERE "runId" = $1::uuid`,
        [ids.runId],
      );
      expect(measurement.rows).toEqual([{ value: '4.987500' }]);

      const event = await client.query<{ type: string; payload: unknown }>(
        `SELECT "type"::text AS "type", "payload"
         FROM "run_events"
         WHERE "runId" = $1::uuid`,
        [ids.runId],
      );
      expect(event.rows).toEqual([
        { type: 'run.started', payload: { status: 'RUNNING' } },
      ]);
    } finally {
      await dropIsolatedSchema(client, schemaName);
    }
  });

  it('keeps the previous snapshot immutability protection after the upgrade', async () => {
    const schemaName = `feature_immutable_${randomUUID().replace(/-/g, '')}`;
    const previousMigrations = listMigrationNames().filter(
      (migration) => migration < FEATURE_SCHEMA_MIGRATION_NAME,
    );

    try {
      await applyMigrationsToSchema(client, schemaName, previousMigrations);
      const ids = await seedLegacyUpgradeFixture(client);
      await applyMigrationSql(client, FEATURE_SCHEMA_MIGRATION_NAME);

      await expect(
        client.query(
          `UPDATE "test_runs" SET "requestHash" = 'changed'
           WHERE "id" = $1::uuid`,
          [ids.runId],
        ),
      ).rejects.toThrow(/Run snapshot fields are immutable/);
      await expect(
        client.query(
          `UPDATE "test_runs" SET "deviceId" = $2::uuid
           WHERE "id" = $1::uuid`,
          [ids.runId, randomUUID()],
        ),
      ).rejects.toThrow(/Run snapshot fields are immutable/);
      await expect(
        client.query(
          `UPDATE "test_runs" SET "status" = 'RUNNING'
           WHERE "id" = $1::uuid`,
          [ids.runId],
        ),
      ).rejects.toThrow(/A terminal run status is immutable/);
    } finally {
      await dropIsolatedSchema(client, schemaName);
    }
  });
});

async function createPublishedPlanFixture(
  prisma: PrismaClient,
  plannerId: string,
  profileId: string,
  label: string,
): Promise<RunSnapshotSource> {
  const profile = await prisma.deviceProfile.findUniqueOrThrow({
    where: { id: profileId },
  });
  const plan = await prisma.testPlan.create({
    data: { createdById: plannerId, deviceProfileId: profileId },
  });
  const firstIdentity = await prisma.stepIdentity.create({
    data: { planId: plan.id },
  });
  const secondIdentity = await prisma.stepIdentity.create({
    data: { planId: plan.id },
  });
  const draft = await prisma.planRevision.create({
    data: {
      planId: plan.id,
      state: PlanRevisionState.DRAFT,
      name: `${label} plan`,
      editRevision: 1,
    },
  });

  await prisma.planStep.createMany({
    data: [
      {
        planId: plan.id,
        revisionId: draft.id,
        logicalStepId: firstIdentity.id,
        position: 1,
        name: 'Output Voltage',
        unit: 'V',
        minimum: '4.750000',
        maximum: '5.250000',
        sampleCount: 2,
        intervalMs: 200,
      },
      {
        planId: plan.id,
        revisionId: draft.id,
        logicalStepId: secondIdentity.id,
        position: 2,
        name: 'Current Draw',
        unit: 'A',
        minimum: '0.450000',
        maximum: '0.550000',
        sampleCount: 3,
        intervalMs: 500,
      },
    ],
  });

  const published = await prisma.planRevision.update({
    where: { id: draft.id },
    data: {
      state: PlanRevisionState.PUBLISHED,
      versionNumber: 1,
      publishedById: plannerId,
      publishedAt: new Date(),
    },
  });
  const steps = await prisma.planStep.findMany({
    where: { revisionId: published.id },
    orderBy: { position: 'asc' },
  });

  return {
    planId: plan.id,
    revisionId: published.id,
    planName: published.name,
    versionNumber: published.versionNumber!,
    profile: {
      id: profile.id,
      code: profile.code,
      name: profile.name,
      description: profile.description,
    },
    steps: steps.map((step) => ({
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
