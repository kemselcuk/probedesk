import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from '../src/auth/auth.constants.js';
import {
  Role,
  RunEventType,
  RunOutcome,
  RunScenario,
  RunStatus,
  RunStepStatus,
} from '../src/prisma/generated/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { RunExecutor } from '../src/runs/run-executor.js';
import { RUN_SCHEDULER } from '../src/runs/run-scheduler.js';
import type { RunSnapshotDto } from '../src/runs/dto/run-snapshot.dto.js';
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
  outcome: RunOutcome | null;
}

function runKey(): string {
  return `runs-cancel-e2e-${randomUUID()}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('run cancellation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let executor: RunExecutor;
  const scheduler = new ControlledRunScheduler('paused');
  let operatorUser: TestUser;
  let fixture: PublishedRunFixture;
  let operator: ClientSession;
  let planner: ClientSession;
  let viewer: ClientSession;

  const server = () => app.getHttpServer();

  beforeAll(async () => {
    app = await createTestApplication(
      {},
      {
        overrides: [{ provide: RUN_SCHEDULER, useValue: scheduler }],
      },
    );
    prisma = app.get(PrismaService);
    executor = app.get(RunExecutor);

    await deleteRunTestData(prisma);

    const plannerUser = await createRunTestUser(prisma, Role.PLANNER);
    operatorUser = await createRunTestUser(prisma, Role.OPERATOR);
    const viewerUser = await createRunTestUser(prisma, Role.VIEWER);
    const profile = await createRunTestProfile(prisma);
    fixture = await createPublishedRunFixture(
      prisma,
      plannerUser.id,
      profile,
      { planName: 'Cancel e2e plan' },
    );

    planner = await login(plannerUser);
    operator = await login(operatorUser);
    viewer = await login(viewerUser);
  });

  afterEach(async () => {
    scheduler.setMode('auto');
    scheduler.releasePending();
    await waitFor(
      () => executor.activeExecutionCount === 0,
      'executor to become idle',
    );
    scheduler.releasePending();
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
        await deleteRunTestData(prisma);
      }
    } finally {
      scheduler.dispose();
      if (app) {
        await app.close();
      }
    }
  });

  async function login(user: TestUser): Promise<ClientSession> {
    const response = await request(server())
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

  function postAs(session: ClientSession, path: string): request.Test {
    return request(server())
      .post(path)
      .set('Cookie', session.cookie)
      .set('X-XSRF-TOKEN', session.csrfToken);
  }

  async function startRun(): Promise<StartRunResponseBody> {
    const response = await postAs(operator, '/api/runs')
      .set('Idempotency-Key', runKey())
      .send({
        planVersionId: fixture.revisionId,
        scenario: RunScenario.NORMAL,
        seed: 123_456_789,
      })
      .expect(202);

    const created = response.body as StartRunResponseBody;
    expect(created).toMatchObject({
      runId: expect.any(String),
      status: RunStatus.RUNNING,
      outcome: null,
    });
    return created;
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

  async function releaseNextTimer(label: string): Promise<void> {
    await waitFor(() => scheduler.pendingCount === 1, label);
    scheduler.releasePending();
  }

  async function stepAt(runId: string, position: number) {
    return prisma.runStep.findFirst({
      where: { runId, position },
    });
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
    for (const event of events) {
      expect(event.schemaVersion).toBe(1);
    }
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
   * Drives the paused scheduler through one completed step and one recorded
   * sample of the next step. The run is then left waiting for its next timer.
   */
  async function advanceToPartialRun(runId: string): Promise<void> {
    await waitFor(
      () => executor.activeExecutionCount === 1,
      'the executor to claim the run',
    );
    await releaseNextTimer('the executor start delay');
    await waitFor(async () => {
      const step = await stepAt(runId, 1);
      return step?.status === RunStepStatus.RUNNING && scheduler.pendingCount === 1;
    }, 'the first step to start');

    await releaseNextTimer('the first sample timer');
    await waitFor(async () => {
      const step = await stepAt(runId, 1);
      return step?.recordedCount === 1 && scheduler.pendingCount === 1;
    }, 'the first sample to commit');

    await releaseNextTimer('the second sample timer');
    await waitFor(async () => {
      const first = await stepAt(runId, 1);
      const second = await stepAt(runId, 2);
      return (
        first?.status === RunStepStatus.COMPLETED &&
        second?.status === RunStepStatus.RUNNING &&
        scheduler.pendingCount === 1
      );
    }, 'the first step to complete and the second to start');

    await releaseNextTimer('the second step sample timer');
    await waitFor(async () => {
      const step = await stepAt(runId, 2);
      return step?.recordedCount === 1 && scheduler.pendingCount === 1;
    }, 'the second step sample to commit');
  }

  it('cancels a partial run while preserving measurements and completed steps', async () => {
    const started = await startRun();
    await advanceToPartialRun(started.runId);

    const response = await postAs(
      operator,
      `/api/runs/${started.runId}/cancel`,
    ).expect(200);
    const snapshot = response.body as RunSnapshotDto;

    expect(snapshot).toMatchObject({
      id: started.runId,
      status: RunStatus.CANCELLED,
      outcome: null,
      reasonCode: 'USER_CANCELLED',
      expectedSampleCount: 6,
      recordedSampleCount: 3,
      finishedAt: expect.any(String),
    });
    expect(snapshot.steps.map((step) => step.status)).toEqual([
      RunStepStatus.COMPLETED,
      RunStepStatus.CANCELLED,
      RunStepStatus.NOT_RUN,
    ]);
    expect(snapshot.steps[0]).toMatchObject({
      outcome: RunOutcome.PASSED,
      recordedCount: 2,
    });
    expect(snapshot.steps[0]?.measurements).toHaveLength(2);
    expect(snapshot.steps[1]).toMatchObject({
      outcome: null,
      recordedCount: 1,
    });
    expect(snapshot.steps[1]?.measurements).toHaveLength(1);
    expect(snapshot.steps[2]).toMatchObject({
      outcome: null,
      recordedCount: 0,
      measurements: [],
    });

    await waitFor(
      () => executor.activeExecutionCount === 0,
      'the cancelled executor to stop',
    );
    expect(scheduler.pendingCount).toBe(0);

    const stored = await prisma.testRun.findUniqueOrThrow({
      where: { id: started.runId },
      include: { steps: { orderBy: { position: 'asc' } } },
    });
    expect(stored.status).toBe(RunStatus.CANCELLED);
    expect(stored.cancelledById).toBe(operatorUser.id);
    expect(stored.steps[1]?.status).toBe(RunStepStatus.CANCELLED);
    expect(stored.steps[1]?.finishedAt).toBeInstanceOf(Date);
    expect(stored.steps[2]?.status).toBe(RunStepStatus.NOT_RUN);
    expect(stored.steps[2]?.finishedAt).toBeNull();

    const events = await loadEvents(started.runId);
    expectGapFree(events);
    expect(events.at(-1)?.type).toBe(RunEventType.RUN_CANCELLED);
    expect(events.at(-1)?.payload).toMatchObject({
      status: RunStatus.CANCELLED,
      reasonCode: 'USER_CANCELLED',
      cancelledById: operatorUser.id,
      recordedSampleCount: 3,
      expectedSampleCount: 6,
      cancelledStepCount: 1,
      notRunStepCount: 1,
    });
    expect(events.filter((event) => event.type === RunEventType.RUN_CANCELLED)).toHaveLength(1);

    const measurementCount = await prisma.measurement.count({
      where: { runId: started.runId },
    });
    expect(measurementCount).toBe(3);

    // The cancelled run can no longer write: releasing stale timers and waiting
    // must not add a sample or an event.
    scheduler.releasePending();
    await delay(50);
    expect(
      await prisma.measurement.count({ where: { runId: started.runId } }),
    ).toBe(measurementCount);
    expect(await prisma.runEvent.count({ where: { runId: started.runId } })).toBe(
      events.length,
    );
    expect(
      await request(server())
        .get('/api/runs/active')
        .set('Cookie', operator.cookie)
        .expect(200),
    ).toMatchObject({ body: null });

    // Repeated cancel is idempotent and does not append another event.
    const repeated = await postAs(
      operator,
      `/api/runs/${started.runId}/cancel`,
    ).expect(200);
    expect(repeated.body).toMatchObject({
      id: started.runId,
      status: RunStatus.CANCELLED,
      outcome: null,
      reasonCode: 'USER_CANCELLED',
      lastEventSequence: snapshot.lastEventSequence,
    });
    expect(
      await prisma.runEvent.count({
        where: { runId: started.runId, type: RunEventType.RUN_CANCELLED },
      }),
    ).toBe(1);
  });

  it('returns an already completed run unchanged instead of cancelling it', async () => {
    scheduler.setMode('auto');
    const started = await startRun();
    const completed = await waitForTerminal(started.runId);

    expect(completed).toMatchObject({
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.PASSED,
      reasonCode: null,
    });
    const beforeMeasurements = await prisma.measurement.count({
      where: { runId: started.runId },
    });
    const beforeEvents = await loadEvents(started.runId);

    const response = await postAs(
      operator,
      `/api/runs/${started.runId}/cancel`,
    ).expect(200);
    const snapshot = response.body as RunSnapshotDto;
    expect(snapshot).toMatchObject({
      id: started.runId,
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.PASSED,
      reasonCode: null,
      finishedAt: completed.finishedAt?.toISOString(),
    });

    const after = await prisma.testRun.findUniqueOrThrow({
      where: { id: started.runId },
    });
    expect(after.status).toBe(RunStatus.COMPLETED);
    expect(after.outcome).toBe(RunOutcome.PASSED);
    expect(after.cancelledById).toBeNull();
    expect(after.finishedAt?.toISOString()).toBe(
      completed.finishedAt?.toISOString(),
    );
    expect(
      await prisma.measurement.count({ where: { runId: started.runId } }),
    ).toBe(beforeMeasurements);
    expect(await loadEvents(started.runId)).toEqual(beforeEvents);

    const repeated = await postAs(
      operator,
      `/api/runs/${started.runId}/cancel`,
    ).expect(200);
    expect(repeated.body).toMatchObject({
      id: started.runId,
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.PASSED,
    });
    expect(
      await prisma.runEvent.count({
        where: { runId: started.runId, type: RunEventType.RUN_CANCELLED },
      }),
    ).toBe(0);
  });

  it('serialises a sample racing with cancel and keeps only pre-terminal writes', async () => {
    const started = await startRun();
    await waitFor(
      () => executor.activeExecutionCount === 1,
      'the executor to claim the run',
    );
    await releaseNextTimer('the executor start delay');
    await waitFor(async () => {
      const step = await stepAt(started.runId, 1);
      return step?.status === RunStepStatus.RUNNING && scheduler.pendingCount === 1;
    }, 'the first step to start');

    let cancelRequest:
      | Promise<{ status: number; body: RunSnapshotDto }>
      | undefined;

    // Hold the run row in a separate transaction. The executor's first sample
    // queues on that lock, then the cancel request queues behind it. Releasing
    // the lock proves the database, not the event loop, decides the order.
    await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT "id" FROM "test_runs"
          WHERE "id" = ${started.runId}::uuid
          FOR UPDATE
        `;

        scheduler.releasePending();
        await waitFor(async () => {
          const rows = await prisma.$queryRaw<Array<{ waiting: number }>>`
            SELECT count(*)::int AS waiting
            FROM pg_locks
            WHERE NOT granted AND pid <> pg_backend_pid()
          `;
          return (rows[0]?.waiting ?? 0) > 0;
        }, 'the sample write to wait on the run row');

        cancelRequest = postAs(
          operator,
          `/api/runs/${started.runId}/cancel`,
        ).then((response) => ({
          status: response.status,
          body: response.body as RunSnapshotDto,
        }));
        await delay(100);
      },
      { timeout: 10_000, maxWait: 5_000 },
    );

    const cancelled = await cancelRequest;
    expect(cancelled?.status).toBe(200);
    expect(cancelled?.body.status).toBe(RunStatus.CANCELLED);
    await waitFor(
      () => executor.activeExecutionCount === 0,
      'the executor to stop after the race',
    );

    const run = await prisma.testRun.findUniqueOrThrow({
      where: { id: started.runId },
    });
    const measurements = await prisma.measurement.findMany({
      where: { runId: started.runId },
      orderBy: { sampleIndex: 'asc' },
    });
    const events = await loadEvents(started.runId);
    expectGapFree(events);
    expect(run.status).toBe(RunStatus.CANCELLED);
    expect(run.recordedSampleCount).toBe(measurements.length);
    expect(cancelled?.body.recordedSampleCount).toBe(measurements.length);
    expect(measurements.length).toBeLessThanOrEqual(1);

    const cancelIndex = events.findIndex(
      (event) => event.type === RunEventType.RUN_CANCELLED,
    );
    expect(cancelIndex).toBeGreaterThan(0);
    expect(
      events
        .slice(cancelIndex + 1)
        .filter((event) => event.type === RunEventType.MEASUREMENT_RECORDED),
    ).toEqual([]);
    if (measurements.length === 1) {
      const measurementEvent = events.findIndex(
        (event) => event.type === RunEventType.MEASUREMENT_RECORDED,
      );
      expect(measurementEvent).toBeGreaterThan(-1);
      expect(measurementEvent).toBeLessThan(cancelIndex);
    }
  });

  it('enforces Operator, session, CSRF and unknown-run rules', async () => {
    const unknownId = randomUUID();

    await request(server())
      .post(`/api/runs/${unknownId}/cancel`)
      .expect(401);

    await postAs(planner, `/api/runs/${unknownId}/cancel`).expect(403);
    await postAs(viewer, `/api/runs/${unknownId}/cancel`).expect(403);

    await request(server())
      .post(`/api/runs/${unknownId}/cancel`)
      .set('Cookie', operator.cookie)
      .expect(403);

    await postAs(operator, `/api/runs/${unknownId}/cancel`).expect(404);
    await postAs(operator, '/api/runs/not-a-uuid/cancel').expect(400);
  });
});
