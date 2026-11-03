import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PlanRevisionState,
  PrismaClient,
  Role,
  RunEventType,
  RunOutcome,
  RunScenario,
  RunStatus,
  RunStepStatus,
} from '../src/prisma/generated/client.js';
import type { TestRun } from '../src/prisma/generated/client.js';
import { EXPECTED_MIGRATIONS } from '../src/prisma/migration-manifest.js';
import {
  buildRunSnapshot,
  type RunSnapshotSettings,
  type RunSnapshotSource,
} from '../src/runs/run-snapshot.js';
import { createTestUser, type TestUser } from './support/auth-helpers.js';

const EMAIL_PREFIX = 'runs-e2e-';
const PROFILE_CODE_PREFIX = 'runs-e2e-profile-';

interface MigrationRow {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
}

describe('run schema constraints (e2e)', () => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  let prisma: PrismaClient;
  let planner: TestUser;
  let operator: TestUser;
  let otherOperator: TestUser;
  let snapshotSource: RunSnapshotSource;

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error(
        'TEST_DATABASE_URL must be set for the run schema integration test.',
      );
    }

    prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: testDatabaseUrl,
        application_name: 'probedesk-runs-schema-e2e',
        connectionTimeoutMillis: 2000,
      }),
    });

    await deleteAllRunTestData(prisma);

    planner = await createTestUser(prisma, {
      role: Role.PLANNER,
      email: `${EMAIL_PREFIX}planner-${randomUUID()}@example.test`,
      password: 'Runs-E2E-Password-9',
    });
    operator = await createTestUser(prisma, {
      role: Role.OPERATOR,
      email: `${EMAIL_PREFIX}operator-${randomUUID()}@example.test`,
      password: 'Runs-E2E-Password-9',
    });
    otherOperator = await createTestUser(prisma, {
      role: Role.OPERATOR,
      email: `${EMAIL_PREFIX}other-${randomUUID()}@example.test`,
      password: 'Runs-E2E-Password-9',
    });

    snapshotSource = await createPublishedPlanFixture(prisma, planner.id);
  });

  afterEach(async () => {
    await deleteTestRuns(prisma);
  });

  afterAll(async () => {
    if (!prisma) {
      return;
    }

    await deleteAllRunTestData(prisma);
    await prisma.$disconnect();
  });

  async function createRun(
    options: {
      requestedById?: string;
      settings?: Partial<RunSnapshotSettings>;
      idempotencyKey?: string;
      requestHash?: string;
    } = {},
  ): Promise<
    TestRun & { steps: Array<{ id: string; logicalStepId: string }> }
  > {
    const settings: RunSnapshotSettings = {
      scenario: RunScenario.NORMAL,
      seed: 123_456_789n,
      simulatorVersion: 'mulberry32-v1',
      evaluationVersion: 'decimal-v1',
      ...options.settings,
    };
    const snapshot = buildRunSnapshot(snapshotSource, settings, {
      requestedById: options.requestedById ?? operator.id,
      idempotencyKey: options.idempotencyKey ?? `run-key-${randomUUID()}`,
      requestHash: options.requestHash ?? `request-hash-${randomUUID()}`,
      startedAt: new Date(),
    });

    return prisma.testRun.create({
      data: {
        ...snapshot.run,
        steps: { create: snapshot.steps },
      },
      include: { steps: { orderBy: { position: 'asc' } } },
    });
  }

  async function terminalize(
    runId: string,
    status: RunStatus = RunStatus.CANCELLED,
  ): Promise<TestRun> {
    const run = await prisma.testRun.findUniqueOrThrow({
      where: { id: runId },
    });
    const completed = status === RunStatus.COMPLETED;

    return prisma.testRun.update({
      where: { id: runId },
      data: {
        status,
        outcome: completed ? RunOutcome.PASSED : null,
        recordedSampleCount: completed
          ? run.expectedSampleCount
          : run.recordedSampleCount,
        finishedAt: new Date(),
      },
    });
  }

  async function expectRunCheck(
    runId: string,
    assignments: string,
    constraint: string,
  ): Promise<void> {
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "test_runs" SET ${assignments} WHERE "id" = '${runId}'::uuid`,
      ),
    ).rejects.toThrow(new RegExp(constraint));
  }

  async function expectStepCheck(
    stepId: string,
    assignments: string,
    constraint: string,
  ): Promise<void> {
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "run_steps" SET ${assignments} WHERE "id" = '${stepId}'::uuid`,
      ),
    ).rejects.toThrow(new RegExp(constraint));
  }

  it('applies every registered migration including the runs migration', async () => {
    const rows = await prisma.$queryRaw<MigrationRow[]>`
      SELECT "migration_name", "finished_at", "rolled_back_at"
      FROM "_prisma_migrations"
    `;
    const applied = rows
      .filter((row) => row.finished_at !== null && row.rolled_back_at === null)
      .map((row) => row.migration_name)
      .sort();

    expect(applied).toEqual([...EXPECTED_MIGRATIONS].sort());
    expect(applied).toContain('20261103190000_runs');
  });

  it('allows only one RUNNING run and releases the slot after a terminal status', async () => {
    const first = await createRun();
    expect(first.status).toBe(RunStatus.RUNNING);

    await expect(createRun()).rejects.toMatchObject({ code: 'P2002' });

    await terminalize(first.id);

    const second = await createRun();
    expect(second.status).toBe(RunStatus.RUNNING);
    expect(second.id).not.toBe(first.id);
  });

  it('rejects a duplicate idempotency key per user but allows it for another user', async () => {
    const key = `idempotency-${randomUUID()}`;
    const first = await createRun({
      requestedById: operator.id,
      idempotencyKey: key,
    });
    await terminalize(first.id);

    await expect(
      createRun({ requestedById: operator.id, idempotencyKey: key }),
    ).rejects.toMatchObject({ code: 'P2002' });

    const other = await createRun({
      requestedById: otherOperator.id,
      idempotencyKey: key,
    });
    expect(other.requestedById).toBe(otherOperator.id);
    expect(other.idempotencyKey).toBe(key);
  });

  it('rejects duplicate sample indexes and a measurement from another run', async () => {
    const first = await createRun();
    const firstStep = first.steps[0]!;

    await prisma.measurement.create({
      data: {
        runId: first.id,
        runStepId: firstStep.id,
        sampleIndex: 0,
        value: '4.750000',
        isWithinTolerance: true,
        recordedAt: new Date(),
        elapsedMs: 200,
      },
    });

    await expect(
      prisma.measurement.create({
        data: {
          runId: first.id,
          runStepId: firstStep.id,
          sampleIndex: 0,
          value: '4.750001',
          isWithinTolerance: true,
          recordedAt: new Date(),
          elapsedMs: 400,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    await terminalize(first.id);
    // The other run stays RUNNING so the composite ownership foreign key is
    // what rejects this write, not the terminal-run measurement trigger.
    const other = await createRun();

    await expect(
      prisma.measurement.create({
        data: {
          runId: other.id,
          runStepId: firstStep.id,
          sampleIndex: 1,
          value: '4.750000',
          isWithinTolerance: true,
          recordedAt: new Date(),
          elapsedMs: 600,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });

    expect(await prisma.measurement.count({ where: { runId: first.id } })).toBe(
      1,
    );
  });

  it('keeps step positions and logical step ids unique inside one run only', async () => {
    const first = await createRun();
    await terminalize(first.id);
    const second = await createRun();
    await terminalize(second.id);
    expect(second.steps.map((step) => step.logicalStepId)).toEqual(
      first.steps.map((step) => step.logicalStepId),
    );

    const baseStep = {
      name: 'Output Voltage',
      unit: 'V',
      minimum: '4.750000',
      maximum: '5.250000',
      sampleCount: 2,
      intervalMs: 200,
    };

    await expect(
      prisma.runStep.create({
        data: {
          ...baseStep,
          runId: first.id,
          logicalStepId: randomUUID(),
          position: 1,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    await expect(
      prisma.runStep.create({
        data: {
          ...baseStep,
          runId: first.id,
          logicalStepId: first.steps[0]!.logicalStepId,
          position: 3,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    expect(await prisma.runStep.count({ where: { runId: first.id } })).toBe(2);
  });

  it('keeps event sequences unique per run and stores dotted wire names', async () => {
    const first = await createRun();
    const event = await prisma.runEvent.create({
      data: {
        runId: first.id,
        sequence: 1,
        type: RunEventType.RUN_STARTED,
        occurredAt: new Date(),
        payload: { status: RunStatus.RUNNING },
      },
    });

    await expect(
      prisma.runEvent.create({
        data: {
          runId: first.id,
          sequence: 1,
          type: RunEventType.STEP_STARTED,
          occurredAt: new Date(),
          payload: {},
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    const stored = await prisma.$queryRaw<
      Array<{ type: string; schemaVersion: number }>
    >`
      SELECT "type"::text AS "type", "schemaVersion"
      FROM "run_events"
      WHERE "id" = ${event.id}::uuid
    `;
    expect(stored).toEqual([{ type: 'run.started', schemaVersion: 1 }]);

    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "run_events" SET "sequence" = 0 WHERE "id" = '${event.id}'::uuid`,
      ),
    ).rejects.toThrow(/run_events_sequence_check/);

    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "run_events" SET "payload" = '[]'::jsonb WHERE "id" = '${event.id}'::uuid`,
      ),
    ).rejects.toThrow(/run_events_payload_check/);

    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "run_events" SET "schemaVersion" = 0 WHERE "id" = '${event.id}'::uuid`,
      ),
    ).rejects.toThrow(/run_events_schemaVersion_check/);

    await terminalize(first.id);
    const other = await createRun();
    await terminalize(other.id);
    const otherEvent = await prisma.runEvent.create({
      data: {
        runId: other.id,
        sequence: 1,
        type: RunEventType.RUN_STARTED,
        occurredAt: new Date(),
        payload: {},
      },
    });
    expect(otherEvent.sequence).toBe(1);
  });

  it('accepts an outcome only on a COMPLETED automation row', async () => {
    const run = await createRun();
    const step = await prisma.runStep.findFirstOrThrow({
      where: { runId: run.id },
      orderBy: { position: 'asc' },
    });

    await expectRunCheck(
      run.id,
      `"status" = 'COMPLETED', "outcome" = NULL,
       "recordedSampleCount" = "expectedSampleCount",
       "finishedAt" = "startedAt" + interval '1 second'`,
      'test_runs_status_outcome_check',
    );
    await expectRunCheck(
      run.id,
      `"outcome" = 'PASSED'`,
      'test_runs_status_outcome_check',
    );
    await expectRunCheck(
      run.id,
      `"status" = 'CANCELLED'`,
      'test_runs_terminal_timestamps_check',
    );

    await expectStepCheck(
      step.id,
      `"status" = 'COMPLETED', "outcome" = NULL,
       "recordedCount" = "sampleCount"`,
      'run_steps_status_outcome_check',
    );
    await expectStepCheck(
      step.id,
      `"outcome" = 'PASSED'`,
      'run_steps_status_outcome_check',
    );

    const storedRun = await prisma.testRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    const storedStep = await prisma.runStep.findUniqueOrThrow({
      where: { id: step.id },
    });
    expect(storedRun.status).toBe(RunStatus.RUNNING);
    expect(storedRun.outcome).toBeNull();
    expect(storedStep.status).toBe(RunStepStatus.PENDING);
    expect(storedStep.outcome).toBeNull();
  });

  it('rejects inconsistent counters, scenario settings and snapshot shapes', async () => {
    const run = await createRun({
      settings: {
        scenario: RunScenario.RANDOM,
        errorProbability: '0.050000',
      },
    });
    const step = await prisma.runStep.findFirstOrThrow({
      where: { runId: run.id },
      orderBy: { position: 'asc' },
    });

    await expectRunCheck(
      run.id,
      `"recordedSampleCount" = "expectedSampleCount" + 1`,
      'test_runs_recordedSampleCount_check',
    );
    await expectRunCheck(
      run.id,
      `"status" = 'COMPLETED', "outcome" = 'PASSED',
       "finishedAt" = "startedAt" + interval '1 second',
       "recordedSampleCount" = 0`,
      'test_runs_completed_counts_check',
    );
    await expectStepCheck(
      step.id,
      `"recordedCount" = "sampleCount" + 1`,
      'run_steps_recordedCount_check',
    );
    await expectStepCheck(
      step.id,
      `"status" = 'COMPLETED', "outcome" = 'PASSED',
       "recordedCount" = 0`,
      'run_steps_completed_counts_check',
    );
    await expectStepCheck(
      step.id,
      `"recordedCount" = 1, "outOfToleranceCount" = 2,
       "firstFailureSampleIndex" = 0`,
      'run_steps_outOfToleranceCount_check',
    );
    await expectStepCheck(
      step.id,
      `"outOfToleranceCount" = 0, "firstFailureSampleIndex" = 0`,
      'run_steps_firstFailure_check',
    );
    await expectStepCheck(
      step.id,
      `"statistics" = '[]'::jsonb`,
      'run_steps_statistics_check',
    );
  });

  it('keeps the documented check constraints alongside the immutability triggers', async () => {
    const rows = await prisma.$queryRaw<Array<{ constraintName: string }>>`
      SELECT conname AS "constraintName"
      FROM pg_constraint
      WHERE contype = 'c'
        AND conrelid IN ('test_runs'::regclass, 'run_steps'::regclass)
    `;
    const names = rows.map((row) => row.constraintName);

    expect(names).toEqual(
      expect.arrayContaining([
        'test_runs_status_outcome_check',
        'test_runs_terminal_timestamps_check',
        'test_runs_seed_check',
        'test_runs_errorProbability_check',
        'test_runs_scenario_settings_check',
        'test_runs_expectedSampleCount_check',
        'test_runs_recordedSampleCount_check',
        'test_runs_completed_counts_check',
        'test_runs_profileSnapshot_check',
        'test_runs_planNameSnapshot_check',
        'test_runs_versionNumberSnapshot_check',
        'run_steps_status_outcome_check',
        'run_steps_recordedCount_check',
        'run_steps_outOfToleranceCount_check',
        'run_steps_firstFailure_check',
        'run_steps_completed_counts_check',
        'run_steps_statistics_check',
        'run_steps_sampleCount_check',
        'run_steps_bounds_check',
      ]),
    );
  });

  it('rejects snapshot and rule-copy changes and new measurements on a terminal run', async () => {
    const run = await createRun();
    const step = run.steps[0]!;

    await prisma.measurement.create({
      data: {
        runId: run.id,
        runStepId: step.id,
        sampleIndex: 0,
        value: '4.750000',
        isWithinTolerance: true,
        recordedAt: new Date(),
        elapsedMs: 200,
      },
    });

    await terminalize(run.id, RunStatus.CANCELLED);

    await expect(
      prisma.measurement.create({
        data: {
          runId: run.id,
          runStepId: step.id,
          sampleIndex: 1,
          value: '4.750000',
          isWithinTolerance: true,
          recordedAt: new Date(),
          elapsedMs: 400,
        },
      }),
    ).rejects.toThrow(/Measurements cannot be added to a terminal run/);

    await expectRunCheck(
      run.id,
      `"planNameSnapshot" = 'Changed after start'`,
      'Run snapshot fields are immutable',
    );
    await expectRunCheck(
      run.id,
      `"seed" = 1`,
      'Run snapshot fields are immutable',
    );
    await expectRunCheck(
      run.id,
      `"expectedSampleCount" = 1`,
      'Run snapshot fields are immutable',
    );
    await expectRunCheck(
      run.id,
      `"status" = 'RUNNING'`,
      'A terminal run status is immutable',
    );

    await expectStepCheck(
      step.id,
      `"name" = 'Changed after start'`,
      'Run rule copy fields are immutable',
    );
    await expectStepCheck(
      step.id,
      `"minimum" = 0`,
      'Run rule copy fields are immutable',
    );

    await prisma.runStep.update({
      where: { id: step.id },
      data: { status: RunStepStatus.CANCELLED },
    });
    await expectStepCheck(
      step.id,
      `"status" = 'RUNNING'`,
      'A terminal step status is immutable',
    );
  });

  it('stores numbers as NUMERIC(18,6) and rejects values outside the range', async () => {
    const run = await createRun();
    const step = await prisma.runStep.findFirstOrThrow({
      where: { runId: run.id },
      orderBy: { position: 'asc' },
    });

    const columns = await prisma.$queryRaw<
      Array<{
        table_name: string;
        column_name: string;
        numeric_precision: number;
        numeric_scale: number;
      }>
    >`
      SELECT table_name, column_name, numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND (
          (table_name = 'run_steps' AND column_name IN ('minimum', 'maximum'))
          OR (table_name = 'measurements' AND column_name = 'value')
          OR (table_name = 'test_runs' AND column_name = 'errorProbability')
        )
      ORDER BY table_name, column_name
    `;
    expect(
      columns.map((column) => [
        column.table_name,
        column.column_name,
        column.numeric_precision,
        column.numeric_scale,
      ]),
    ).toEqual([
      ['measurements', 'value', 18, 6],
      ['run_steps', 'maximum', 18, 6],
      ['run_steps', 'minimum', 18, 6],
      ['test_runs', 'errorProbability', 8, 6],
    ]);

    await prisma.measurement.create({
      data: {
        runId: run.id,
        runStepId: step.id,
        sampleIndex: 0,
        value: '4.75',
        isWithinTolerance: true,
        recordedAt: new Date(),
        elapsedMs: 200,
      },
    });

    const stored = await prisma.$queryRaw<Array<{ value: string }>>`
      SELECT "value"::text AS "value"
      FROM "measurements"
      WHERE "runStepId" = ${step.id}::uuid
    `;
    expect(stored).toEqual([{ value: '4.750000' }]);

    await expect(
      prisma.$executeRaw`
        INSERT INTO "measurements" (
          "runId", "runStepId", "sampleIndex", "value",
          "isWithinTolerance", "recordedAt", "elapsedMs"
        ) VALUES (
          ${run.id}::uuid, ${step.id}::uuid, 1, 1000000000000,
          true, now(), 400
        )
      `,
    ).rejects.toThrow(/numeric field overflow/);

    await expect(
      prisma.$executeRaw`
        INSERT INTO "measurements" (
          "runId", "runStepId", "sampleIndex", "value",
          "isWithinTolerance", "recordedAt", "elapsedMs"
        ) VALUES (
          ${run.id}::uuid, ${step.id}::uuid, -1, 5,
          true, now(), 600
        )
      `,
    ).rejects.toThrow(/measurements_sampleIndex_check/);

    await expect(
      prisma.measurement.create({
        data: {
          runId: run.id,
          runStepId: step.id,
          sampleIndex: 2,
          value: '5.000000',
          isWithinTolerance: true,
          recordedAt: new Date(),
          elapsedMs: -1,
        },
      }),
    ).rejects.toThrow(/measurements_elapsedMs_check/);
  });

  it('commits a run, steps, measurement and event atomically and keeps history', async () => {
    const idempotencyKey = `atomic-${randomUUID()}`;
    const snapshot = buildRunSnapshot(
      snapshotSource,
      {
        scenario: RunScenario.NORMAL,
        seed: 7n,
        simulatorVersion: 'mulberry32-v1',
        evaluationVersion: 'decimal-v1',
      },
      {
        requestedById: operator.id,
        idempotencyKey,
        requestHash: `request-hash-${randomUUID()}`,
        startedAt: new Date(),
      },
    );

    const run = await prisma.$transaction(async (transaction) => {
      const created = await transaction.testRun.create({
        data: {
          ...snapshot.run,
          steps: { create: snapshot.steps },
        },
        include: { steps: { orderBy: { position: 'asc' } } },
      });
      const firstStep = created.steps[0]!;

      await transaction.measurement.create({
        data: {
          runId: created.id,
          runStepId: firstStep.id,
          sampleIndex: 0,
          value: '4.750000',
          isWithinTolerance: true,
          recordedAt: new Date(),
          elapsedMs: 200,
        },
      });
      await transaction.runEvent.create({
        data: {
          runId: created.id,
          sequence: 1,
          type: RunEventType.RUN_STARTED,
          occurredAt: new Date(),
          payload: { status: RunStatus.RUNNING },
        },
      });

      return created;
    });

    const stored = await prisma.$queryRaw<
      Array<{
        planNameSnapshot: string;
        versionNumberSnapshot: number;
        stepName: string;
        minimum: string;
        maximum: string;
        value: string;
        eventType: string;
      }>
    >`
      SELECT
        run."planNameSnapshot",
        run."versionNumberSnapshot",
        step."name" AS "stepName",
        step."minimum"::text AS "minimum",
        step."maximum"::text AS "maximum",
        measurement."value"::text AS "value",
        event."type"::text AS "eventType"
      FROM "test_runs" AS run
      JOIN "run_steps" AS step ON step."runId" = run."id"
      JOIN "measurements" AS measurement ON measurement."runStepId" = step."id"
      JOIN "run_events" AS event ON event."runId" = run."id"
      WHERE run."id" = ${run.id}::uuid
    `;

    expect(stored).toEqual([
      {
        planNameSnapshot: 'Run schema plan',
        versionNumberSnapshot: 1,
        stepName: 'Output Voltage',
        minimum: '4.750000',
        maximum: '5.250000',
        value: '4.750000',
        eventType: 'run.started',
      },
    ]);
    expect(run.expectedSampleCount).toBe(5);
    expect(run.steps).toHaveLength(2);

    await terminalize(run.id, RunStatus.CANCELLED);

    const rolledBackKey = `atomic-rollback-${randomUUID()}`;
    const rollbackSnapshot = buildRunSnapshot(
      snapshotSource,
      {
        scenario: RunScenario.NORMAL,
        seed: 7n,
        simulatorVersion: 'mulberry32-v1',
        evaluationVersion: 'decimal-v1',
      },
      {
        requestedById: operator.id,
        idempotencyKey: rolledBackKey,
        requestHash: `request-hash-${randomUUID()}`,
        startedAt: new Date(),
      },
    );

    await expect(
      prisma.$transaction(async (transaction) => {
        const created = await transaction.testRun.create({
          data: {
            ...rollbackSnapshot.run,
            steps: { create: rollbackSnapshot.steps },
          },
          include: { steps: true },
        });

        await transaction.measurement.create({
          data: {
            runId: created.id,
            runStepId: created.steps[0]!.id,
            sampleIndex: -1,
            value: '4.750000',
            isWithinTolerance: true,
            recordedAt: new Date(),
            elapsedMs: 200,
          },
        });
      }),
    ).rejects.toThrow(/measurements_sampleIndex_check/);

    expect(
      await prisma.testRun.count({ where: { idempotencyKey: rolledBackKey } }),
    ).toBe(0);

    await expect(
      prisma.testRun.delete({ where: { id: run.id } }),
    ).rejects.toMatchObject({ code: 'P2003' });

    await expect(
      prisma.$executeRawUnsafe('TRUNCATE TABLE "run_events"'),
    ).rejects.toThrow(/TRUNCATE is not allowed/);
    await expect(
      prisma.$executeRawUnsafe('TRUNCATE TABLE "test_runs" CASCADE'),
    ).rejects.toThrow(/TRUNCATE is not allowed/);

    expect(await prisma.runStep.count({ where: { runId: run.id } })).toBe(2);
    expect(await prisma.measurement.count({ where: { runId: run.id } })).toBe(
      1,
    );
    expect(await prisma.runEvent.count({ where: { runId: run.id } })).toBe(1);
  });
});

async function createPublishedPlanFixture(
  prisma: PrismaClient,
  plannerId: string,
): Promise<RunSnapshotSource> {
  const profile = await prisma.deviceProfile.create({
    data: {
      code: `${PROFILE_CODE_PREFIX}${randomUUID()}`,
      name: 'Run Schema Device',
      description: 'Fixture profile for the run schema tests',
    },
  });
  const plan = await prisma.testPlan.create({
    data: { createdById: plannerId, deviceProfileId: profile.id },
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
      name: 'Run schema plan',
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

async function deleteTestRuns(prisma: PrismaClient): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: EMAIL_PREFIX } },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);
  const runs = await prisma.testRun.findMany({
    where: { requestedById: { in: userIds } },
    select: { id: true },
  });
  const runIds = runs.map((run) => run.id);

  await prisma.measurement.deleteMany({ where: { runId: { in: runIds } } });
  await prisma.runEvent.deleteMany({ where: { runId: { in: runIds } } });
  await prisma.runStep.deleteMany({ where: { runId: { in: runIds } } });
  await prisma.testRun.deleteMany({ where: { id: { in: runIds } } });
}

async function deleteAllRunTestData(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "plan_steps" DISABLE TRIGGER USER',
  );
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "plan_revisions" DISABLE TRIGGER USER',
  );

  try {
    await deleteTestRuns(prisma);

    const users = await prisma.user.findMany({
      where: { email: { startsWith: EMAIL_PREFIX } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    const plans = await prisma.testPlan.findMany({
      where: { createdById: { in: userIds } },
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
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.deviceProfile.deleteMany({
      where: { code: { startsWith: PROFILE_CODE_PREFIX } },
    });
  } finally {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "plan_revisions" ENABLE TRIGGER USER',
    );
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "plan_steps" ENABLE TRIGGER USER',
    );
  }
}
