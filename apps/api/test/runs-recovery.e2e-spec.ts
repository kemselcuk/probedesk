import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from '../src/auth/auth.constants.js';
import {
  Prisma,
  Role,
  RunEventType,
  RunOutcome,
  RunScenario,
  RunStatus,
  RunStepStatus,
} from '../src/prisma/generated/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { RUN_EVALUATION_VERSION } from '../src/runs/run-domain.js';
import { RunExecutor } from '../src/runs/run-executor.js';
import { RUN_SCHEDULER } from '../src/runs/run-scheduler.js';
import { buildRunSnapshot } from '../src/runs/run-snapshot.js';
import { SIMULATOR_VERSION } from '../src/simulator/index.js';
import {
  cookieHeader,
  getCookie,
  readSetCookies,
  type TestUser,
} from './support/auth-helpers.js';
import { createTestApplication } from './support/create-test-application.js';
import {
  createPublishedRunFixture,
  createRunTestProfile,
  createRunTestUser,
  deleteRunTestData,
  deleteRunTestRuns,
  type PublishedRunFixture,
} from './support/run-helpers.js';
import { ControlledRunScheduler } from './support/run-schedulers.js';

interface ClientSession {
  cookie: string;
  csrfToken: string;
}

interface StartRunResponseBody {
  runId: string;
  status: RunStatus;
  outcome: null;
}

interface SyntheticRun {
  runId: string;
  stepIds: string[];
}

const RECOVERY_BLOCK_FUNCTION = 'runs_recovery_e2e_block_updates';
const RECOVERY_BLOCK_TRIGGER = 'runs_recovery_e2e_block_updates';
const FAIL_MEASUREMENT_FUNCTION = 'runs_recovery_e2e_fail_measurement';
const FAIL_MEASUREMENT_TRIGGER = 'runs_recovery_e2e_fail_measurement';

function runKey(): string {
  return `runs-recovery-e2e-${randomUUID()}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('run interruption, technical errors and startup recovery (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let executor: RunExecutor;
  const scheduler = new ControlledRunScheduler('paused');
  let operatorUser: TestUser;
  let fixture: PublishedRunFixture;
  let operator: ClientSession;

  beforeAll(async () => {
    app = await createTestApplication(
      {},
      {
        overrides: [{ provide: RUN_SCHEDULER, useValue: scheduler }],
      },
    );
    prisma = app.get(PrismaService);
    executor = app.get(RunExecutor);

    await dropRecoveryTriggers();
    await dropMeasurementFailureTrigger();
    await deleteRunTestData(prisma);

    const plannerUser = await createRunTestUser(prisma, Role.PLANNER);
    operatorUser = await createRunTestUser(prisma, Role.OPERATOR);
    const profile = await createRunTestProfile(prisma);
    fixture = await createPublishedRunFixture(
      prisma,
      plannerUser.id,
      profile,
      { planName: 'Recovery e2e plan' },
    );
    operator = await login(operatorUser, app);
  });

  afterEach(async () => {
    scheduler.setMode('auto');
    scheduler.releasePending();
    await waitFor(
      () => executor.activeExecutionCount === 0,
      'executor to become idle',
    );
    scheduler.releasePending();
    await dropRecoveryTriggers();
    await dropMeasurementFailureTrigger();
    await deleteRunTestRuns(prisma);
    scheduler.setMode('paused');
  });

  afterAll(async () => {
    try {
      if (prisma) {
        scheduler.setMode('auto');
        scheduler.releasePending();
        await waitFor(
          () => executor.activeExecutionCount === 0,
          'executor to become idle before cleanup',
        );
        await dropRecoveryTriggers();
        await dropMeasurementFailureTrigger();
        await deleteRunTestData(prisma);
      }
    } finally {
      scheduler.dispose();
      if (app) {
        await app.close();
      }
    }
  });

  async function login(
    user: TestUser,
    target: INestApplication,
  ): Promise<ClientSession> {
    const response = await request(target.getHttpServer())
      .post('/api/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(200);

    const cookies = readSetCookies(response);
    const csrfCookie = getCookie(cookies, CSRF_COOKIE_NAME);

    return {
      cookie: cookieHeader(getCookie(cookies, SESSION_COOKIE_NAME), csrfCookie),
      csrfToken: csrfCookie.value,
    };
  }

  function postAs(
    target: INestApplication,
    session: ClientSession,
    path: string,
  ): request.Test {
    return request(target.getHttpServer())
      .post(path)
      .set('Cookie', session.cookie)
      .set('X-XSRF-TOKEN', session.csrfToken);
  }

  async function startRun(
    target: INestApplication = app,
    session: ClientSession = operator,
  ): Promise<StartRunResponseBody> {
    const response = await postAs(target, session, '/api/runs')
      .set('Idempotency-Key', runKey())
      .send({
        planVersionId: fixture.revisionId,
        scenario: RunScenario.NORMAL,
        seed: 123_456_789,
      })
      .expect(202);

    return response.body as StartRunResponseBody;
  }

  async function waitFor(
    predicate: () => boolean | Promise<boolean>,
    label: string,
    timeoutMs = 10_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      if (await predicate()) {
        return;
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for ${label}`);
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  async function releaseNextTimer(
    target: ControlledRunScheduler,
    label: string,
  ): Promise<void> {
    await waitFor(() => target.pendingCount === 1, label);
    target.releasePending();
  }

  async function stepAt(runId: string, position: number) {
    return prisma.runStep.findFirst({ where: { runId, position } });
  }

  async function loadEvents(runId: string) {
    return prisma.runEvent.findMany({
      where: { runId },
      orderBy: { sequence: 'asc' },
    });
  }

  function expectGapFree(events: Awaited<ReturnType<typeof loadEvents>>): void {
    expect(events.map((event) => event.sequence)).toEqual(
      events.map((_, index) => index + 1),
    );
  }

  async function waitForTerminal(runId: string) {
    await waitFor(async () => {
      const run = await prisma.testRun.findUnique({
        where: { id: runId },
        select: { status: true },
      });
      return run !== null && run.status !== RunStatus.RUNNING;
    }, `run ${runId} to become terminal`);
    await waitFor(
      () => executor.activeExecutionCount === 0,
      'executor to release the terminal run',
    );

    return prisma.testRun.findUniqueOrThrow({ where: { id: runId } });
  }

  /**
   * Inserts a RUNNING run that looks like a process died mid-execution: one
   * completed step with samples, one active step with a sample, one pending.
   * Only the single run.started event is stored, so recovery's appended event
   * is easy to verify.
   */
  async function createSyntheticRunningRun(): Promise<SyntheticRun> {
    const startedAt = new Date(Date.now() - 60_000);
    const context = {
      requestedById: operatorUser.id,
      idempotencyKey: `synthetic-${randomUUID()}`,
      requestHash: `synthetic-hash-${randomUUID()}`,
      startedAt,
    };
    const snapshot = buildRunSnapshot(
      {
        planId: fixture.planId,
        revisionId: fixture.revisionId,
        planName: fixture.planName,
        versionNumber: fixture.versionNumber,
        profile: fixture.profile,
        steps: fixture.steps.map((step) => ({
          ...step,
          minimum: new Prisma.Decimal(step.minimum),
          maximum: new Prisma.Decimal(step.maximum),
        })),
      },
      {
        scenario: RunScenario.NORMAL,
        seed: 123_456_789n,
        simulatorVersion: SIMULATOR_VERSION,
        evaluationVersion: RUN_EVALUATION_VERSION,
      },
      context,
    );

    const run = await prisma.testRun.create({
      data: {
        ...snapshot.run,
        eventSequence: 1,
        steps: { create: snapshot.steps },
      },
      include: { steps: { orderBy: { position: 'asc' } } },
    });

    const first = run.steps[0]!;
    const second = run.steps[1]!;
    const firstValue = first.minimum.toFixed(6);
    const secondValue = second.minimum.toFixed(6);
    const completedAt = new Date(startedAt.getTime() + 1_000);

    await prisma.runStep.update({
      where: { id: first.id },
      data: {
        status: RunStepStatus.COMPLETED,
        outcome: RunOutcome.PASSED,
        recordedCount: first.sampleCount,
        startedAt,
        finishedAt: completedAt,
        statistics: {
          minimum: firstValue,
          maximum: firstValue,
          average: firstValue,
          sampleCount: first.sampleCount,
        },
      },
    });
    await prisma.runStep.update({
      where: { id: second.id },
      data: {
        status: RunStepStatus.RUNNING,
        recordedCount: 1,
        startedAt: completedAt,
      },
    });
    await prisma.measurement.createMany({
      data: [
        ...Array.from({ length: first.sampleCount }, (_, sampleIndex) => ({
          runId: run.id,
          runStepId: first.id,
          sampleIndex,
          value: firstValue,
          isWithinTolerance: true,
          recordedAt: completedAt,
          elapsedMs: (sampleIndex + 1) * first.intervalMs,
        })),
        {
          runId: run.id,
          runStepId: second.id,
          sampleIndex: 0,
          value: secondValue,
          isWithinTolerance: true,
          recordedAt: completedAt,
          elapsedMs: second.intervalMs,
        },
      ],
    });
    await prisma.testRun.update({
      where: { id: run.id },
      data: {
        recordedSampleCount: first.sampleCount + 1,
      },
    });
    await prisma.runEvent.create({
      data: {
        runId: run.id,
        sequence: 1,
        type: RunEventType.RUN_STARTED,
        schemaVersion: 1,
        occurredAt: startedAt,
        payload: {
          status: RunStatus.RUNNING,
          planId: fixture.planId,
          planVersionId: fixture.revisionId,
          planName: fixture.planName,
          versionNumber: fixture.versionNumber,
          scenario: RunScenario.NORMAL,
          expectedSampleCount: snapshot.run.expectedSampleCount,
          stepCount: snapshot.steps.length,
        },
      },
    });

    return {
      runId: run.id,
      stepIds: run.steps.map((step) => step.id),
    };
  }

  async function dropRecoveryTriggers(): Promise<void> {
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS "${RECOVERY_BLOCK_TRIGGER}" ON "test_runs"`,
    );
    await prisma.$executeRawUnsafe(
      `DROP FUNCTION IF EXISTS "${RECOVERY_BLOCK_FUNCTION}"()`,
    );
  }

  async function installRecoveryBlockingTrigger(): Promise<void> {
    await dropRecoveryTriggers();
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${RECOVERY_BLOCK_FUNCTION}"()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'recovery blocked by test trigger' USING ERRCODE = 'P0001';
      END;
      $$
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "${RECOVERY_BLOCK_TRIGGER}"
      BEFORE UPDATE ON "test_runs"
      FOR EACH ROW
      EXECUTE FUNCTION "${RECOVERY_BLOCK_FUNCTION}"()
    `);
  }

  async function dropMeasurementFailureTrigger(): Promise<void> {
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS "${FAIL_MEASUREMENT_TRIGGER}" ON "measurements"`,
    );
    await prisma.$executeRawUnsafe(
      `DROP FUNCTION IF EXISTS "${FAIL_MEASUREMENT_FUNCTION}"()`,
    );
  }

  async function installMeasurementFailureTrigger(): Promise<void> {
    await dropMeasurementFailureTrigger();
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${FAIL_MEASUREMENT_FUNCTION}"()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'forced measurement persistence failure' USING ERRCODE = '23514';
      END;
      $$
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "${FAIL_MEASUREMENT_TRIGGER}"
      BEFORE INSERT ON "measurements"
      FOR EACH ROW
      WHEN (NEW."sampleIndex" = 1)
      EXECUTE FUNCTION "${FAIL_MEASUREMENT_FUNCTION}"()
    `);
  }

  it('recovers a synthetic RUNNING run before readiness and preserves committed history', async () => {
    const synthetic = await createSyntheticRunningRun();
    const fresh = await createTestApplication();

    try {
      const recovered = await prisma.testRun.findUniqueOrThrow({
        where: { id: synthetic.runId },
        include: { steps: { orderBy: { position: 'asc' } } },
      });
      expect(recovered).toMatchObject({
        status: RunStatus.INTERRUPTED,
        outcome: null,
        reasonCode: 'SERVER_RESTART',
        recordedSampleCount: 3,
        expectedSampleCount: 6,
        eventSequence: 2,
      });
      expect(recovered.finishedAt).toBeInstanceOf(Date);
      expect(recovered.steps.map((step) => step.status)).toEqual([
        RunStepStatus.COMPLETED,
        RunStepStatus.INTERRUPTED,
        RunStepStatus.NOT_RUN,
      ]);
      expect(recovered.steps[0]).toMatchObject({
        outcome: RunOutcome.PASSED,
        recordedCount: 2,
      });
      expect(recovered.steps[1]).toMatchObject({
        outcome: null,
        recordedCount: 1,
      });
      expect(recovered.steps[1]?.finishedAt).toBeInstanceOf(Date);
      expect(recovered.steps[2]?.finishedAt).toBeNull();

      const measurements = await prisma.measurement.findMany({
        where: { runId: synthetic.runId },
        orderBy: [{ runStepId: 'asc' }, { sampleIndex: 'asc' }],
      });
      expect(measurements).toHaveLength(3);

      const events = await loadEvents(synthetic.runId);
      expectGapFree(events);
      expect(events.map((event) => event.type)).toEqual([
        RunEventType.RUN_STARTED,
        RunEventType.RUN_INTERRUPTED,
      ]);
      expect(events[1]?.payload).toMatchObject({
        status: RunStatus.INTERRUPTED,
        reasonCode: 'SERVER_RESTART',
        recordedSampleCount: 3,
        expectedSampleCount: 6,
        interruptedStepCount: 1,
        notRunStepCount: 1,
      });

      const readiness = await request(fresh.getHttpServer())
        .get('/api/health/ready')
        .expect(200);
      expect(readiness.body).toEqual({
        status: 'ok',
        checks: { database: 'ok', migrations: 'ok' },
      });

      await delay(50);
      expect(
        await prisma.measurement.count({ where: { runId: synthetic.runId } }),
      ).toBe(3);
      expect(await prisma.runEvent.count({ where: { runId: synthetic.runId } })).toBe(
        2,
      );
    } finally {
      await fresh.close();
    }
  });

  it('does not modify already terminal runs when recovery runs again', async () => {
    const synthetic = await createSyntheticRunningRun();
    const first = await createTestApplication();

    try {
      const recovered = await prisma.testRun.findUniqueOrThrow({
        where: { id: synthetic.runId },
      });
      expect(recovered.status).toBe(RunStatus.INTERRUPTED);
      const measurementCount = await prisma.measurement.count({
        where: { runId: synthetic.runId },
      });
      const events = await loadEvents(synthetic.runId);
      const finishedAt = recovered.finishedAt?.toISOString();
      expect(finishedAt).toEqual(expect.any(String));

      const second = await createTestApplication();
      try {
        const unchanged = await prisma.testRun.findUniqueOrThrow({
          where: { id: synthetic.runId },
        });
        expect(unchanged.finishedAt?.toISOString()).toBe(finishedAt);
        expect(unchanged.eventSequence).toBe(recovered.eventSequence);
        expect(await loadEvents(synthetic.runId)).toEqual(events);
        expect(
          await prisma.measurement.count({ where: { runId: synthetic.runId } }),
        ).toBe(measurementCount);
      } finally {
        await second.close();
      }
    } finally {
      await first.close();
    }
  });

  it('keeps readiness and new starts unavailable until recovery completes', async () => {
    const synthetic = await createSyntheticRunningRun();
    await installRecoveryBlockingTrigger();
    const fresh = await createTestApplication();

    try {
      const notReady = await request(fresh.getHttpServer())
        .get('/api/health/ready')
        .expect(503);
      expect(notReady.body).toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        message: 'The service is not ready.',
        details: {
          checks: {
            database: 'ok',
            migrations: 'ok',
            startup: 'pending',
          },
        },
      });
      const serialised = JSON.stringify(notReady.body);
      expect(serialised).not.toContain(RECOVERY_BLOCK_TRIGGER);
      expect(serialised).not.toContain('RAISE');
      expect(serialised).not.toContain('SELECT');
      expect(serialised).not.toContain('probedesk:probedesk');
      expect(serialised).not.toContain('stack');

      const start = await postAs(fresh, operator, '/api/runs')
        .set('Idempotency-Key', runKey())
        .send({
          planVersionId: fixture.revisionId,
          scenario: RunScenario.NORMAL,
          seed: 123_456_789,
        })
        .expect(503);
      expect(start.body).toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        details: { checks: { startup: 'pending' } },
      });

      const stillRunning = await prisma.testRun.findUniqueOrThrow({
        where: { id: synthetic.runId },
      });
      expect(stillRunning.status).toBe(RunStatus.RUNNING);

      await dropRecoveryTriggers();

      await request(fresh.getHttpServer())
        .get('/api/health/ready')
        .expect(200);
      const recovered = await prisma.testRun.findUniqueOrThrow({
        where: { id: synthetic.runId },
      });
      expect(recovered.status).toBe(RunStatus.INTERRUPTED);
      expect(recovered.reasonCode).toBe('SERVER_RESTART');
    } finally {
      await dropRecoveryTriggers();
      await fresh.close();
    }
  });

  it('marks invalid simulator output ERROR instead of a tolerance failure', async () => {
    const started = await startRun();
    await waitFor(
      () => executor.activeExecutionCount === 1,
      'the executor to claim the run',
    );

    // The executor is paused before its first write. A stored expected count
    // that disagrees with the copied steps is invalid simulator input/output.
    await prisma.testRun.update({
      where: { id: started.runId },
      data: { expectedSampleCount: 7 },
    });
    await releaseNextTimer(scheduler, 'the executor start delay');

    const run = await waitForTerminal(started.runId);
    expect(run).toMatchObject({
      status: RunStatus.ERROR,
      outcome: null,
      reasonCode: 'SIMULATOR_OUTPUT_INVALID',
      recordedSampleCount: 0,
    });
    expect(run.finishedAt).toBeInstanceOf(Date);

    const steps = await prisma.runStep.findMany({
      where: { runId: started.runId },
      orderBy: { position: 'asc' },
    });
    expect(steps.map((step) => step.status)).toEqual([
      RunStepStatus.NOT_RUN,
      RunStepStatus.NOT_RUN,
      RunStepStatus.NOT_RUN,
    ]);
    expect(steps.every((step) => step.outcome === null)).toBe(true);
    expect(
      await prisma.measurement.count({ where: { runId: started.runId } }),
    ).toBe(0);

    const events = await loadEvents(started.runId);
    expectGapFree(events);
    expect(events.map((event) => event.type)).toEqual([
      RunEventType.RUN_STARTED,
      RunEventType.RUN_ERRORED,
    ]);
    expect(events.at(-1)?.payload).toMatchObject({
      status: RunStatus.ERROR,
      reasonCode: 'SIMULATOR_OUTPUT_INVALID',
      recordedSampleCount: 0,
    });
  });

  it('marks a persistence failure ERROR, keeps prior samples and never PASSED', async () => {
    await installMeasurementFailureTrigger();
    try {
      const started = await startRun();
      await waitFor(
        () => executor.activeExecutionCount === 1,
        'the executor to claim the run',
      );
      await releaseNextTimer(scheduler, 'the executor start delay');
      await waitFor(async () => {
        const step = await stepAt(started.runId, 1);
        return (
          step?.status === RunStepStatus.RUNNING &&
          scheduler.pendingCount === 1
        );
      }, 'the first step to start');
      await releaseNextTimer(scheduler, 'the first sample timer');
      await waitFor(async () => {
        const step = await stepAt(started.runId, 1);
        return step?.recordedCount === 1 && scheduler.pendingCount === 1;
      }, 'the first sample to commit');

      // The next sample insert fails inside PostgreSQL. The whole sample
      // transaction rolls back; the committed first sample stays.
      await releaseNextTimer(scheduler, 'the failing sample timer');
      const run = await waitForTerminal(started.runId);

      expect(run).toMatchObject({
        status: RunStatus.ERROR,
        outcome: null,
        reasonCode: 'EXECUTION_FAILED',
        recordedSampleCount: 1,
        expectedSampleCount: 6,
      });
      expect(run.finishedAt).toBeInstanceOf(Date);

      const steps = await prisma.runStep.findMany({
        where: { runId: started.runId },
        orderBy: { position: 'asc' },
      });
      expect(steps.map((step) => step.status)).toEqual([
        RunStepStatus.ERROR,
        RunStepStatus.NOT_RUN,
        RunStepStatus.NOT_RUN,
      ]);
      expect(steps.every((step) => step.outcome === null)).toBe(true);
      expect(steps[0]?.recordedCount).toBe(1);
      expect(steps[0]?.finishedAt).toBeInstanceOf(Date);

      const measurements = await prisma.measurement.findMany({
        where: { runId: started.runId },
      });
      expect(measurements).toHaveLength(1);
      expect(measurements[0]?.sampleIndex).toBe(0);

      const events = await loadEvents(started.runId);
      expectGapFree(events);
      expect(events.map((event) => event.type)).toEqual([
        RunEventType.RUN_STARTED,
        RunEventType.STEP_STARTED,
        RunEventType.MEASUREMENT_RECORDED,
        RunEventType.RUN_ERRORED,
      ]);
      expect(events.at(-1)?.payload).toMatchObject({
        status: RunStatus.ERROR,
        reasonCode: 'EXECUTION_FAILED',
        recordedSampleCount: 1,
        expectedSampleCount: 6,
      });
      expect(run.outcome).not.toBe('PASSED');
      expect(run.outcome).not.toBe('FAILED');
    } finally {
      await dropMeasurementFailureTrigger();
    }
  });

  it('leaves RUNNING data on controlled shutdown and recovers it on next start', async () => {
    const shutdownScheduler = new ControlledRunScheduler('paused');
    let shutdownApp = await createTestApplication(
      {},
      { overrides: [{ provide: RUN_SCHEDULER, useValue: shutdownScheduler }] },
    );

    let runId: string | null = null;
    try {
      const shutdownExecutor = shutdownApp.get(RunExecutor);
      const started = await startRun(shutdownApp);
      runId = started.runId;
      await waitFor(
        () => shutdownExecutor.activeExecutionCount === 1,
        'the shutdown executor to claim the run',
      );
      await releaseNextTimer(shutdownScheduler, 'the shutdown start delay');
      await waitFor(async () => {
        const step = await stepAt(started.runId, 1);
        return (
          step?.status === RunStepStatus.RUNNING &&
          shutdownScheduler.pendingCount === 1
        );
      }, 'the first step to start before shutdown');
      await releaseNextTimer(shutdownScheduler, 'the first sample timer');
      await waitFor(async () => {
        const step = await stepAt(started.runId, 1);
        return step?.recordedCount === 1 && shutdownScheduler.pendingCount === 1;
      }, 'the first sample to commit before shutdown');

      await shutdownApp.close();
      shutdownApp = undefined as unknown as INestApplication;
      expect(shutdownScheduler.pendingCount).toBe(0);
      await delay(50);

      const leftRunning = await prisma.testRun.findUniqueOrThrow({
        where: { id: started.runId },
        include: { steps: { orderBy: { position: 'asc' } } },
      });
      expect(leftRunning.status).toBe(RunStatus.RUNNING);
      expect(leftRunning.finishedAt).toBeNull();
      expect(leftRunning.steps[0]?.status).toBe(RunStepStatus.RUNNING);
      expect(leftRunning.steps[1]?.status).toBe(RunStepStatus.PENDING);
      expect(
        await prisma.measurement.count({ where: { runId: started.runId } }),
      ).toBe(1);
      expect(
        await prisma.runEvent.count({
          where: { runId: started.runId, type: RunEventType.RUN_COMPLETED },
        }),
      ).toBe(0);

      const recoveryApp = await createTestApplication();
      try {
        const recovered = await prisma.testRun.findUniqueOrThrow({
          where: { id: started.runId },
          include: { steps: { orderBy: { position: 'asc' } } },
        });
        expect(recovered).toMatchObject({
          status: RunStatus.INTERRUPTED,
          outcome: null,
          reasonCode: 'SERVER_RESTART',
          recordedSampleCount: 1,
        });
        expect(recovered.steps.map((step) => step.status)).toEqual([
          RunStepStatus.INTERRUPTED,
          RunStepStatus.NOT_RUN,
          RunStepStatus.NOT_RUN,
        ]);
        expect(recovered.steps[0]?.recordedCount).toBe(1);
        expect(
          await prisma.measurement.count({ where: { runId: started.runId } }),
        ).toBe(1);

        const events = await loadEvents(started.runId);
        expectGapFree(events);
        expect(events.at(-1)?.type).toBe(RunEventType.RUN_INTERRUPTED);
        expect(events.at(-1)?.payload).toMatchObject({
          reasonCode: 'SERVER_RESTART',
        });
      } finally {
        await recoveryApp.close();
      }
    } finally {
      shutdownScheduler.dispose();
      if (shutdownApp) {
        await shutdownApp.close();
      }
      if (runId) {
        await waitFor(
          () => executor.activeExecutionCount === 0,
          'the main executor to remain idle',
        );
      }
    }
  });
});
