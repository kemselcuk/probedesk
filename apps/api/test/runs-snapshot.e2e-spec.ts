import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from '../src/auth/auth.constants.js';
import {
  Role,
  RunOutcome,
  RunScenario,
  RunStatus,
  RunStepStatus,
} from '../src/prisma/generated/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { RUN_EVALUATION_VERSION } from '../src/runs/run-domain.js';
import { RunExecutor } from '../src/runs/run-executor.js';
import { RUN_SCHEDULER } from '../src/runs/run-scheduler.js';
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
  outcome: RunOutcome | null;
}

interface MeasurementBody {
  sampleIndex: number;
  value: string;
  isWithinTolerance: boolean;
  recordedAt: string;
  elapsedMs: number;
}

interface StatisticsBody {
  minimum: string | null;
  maximum: string | null;
  average: string | null;
  sampleCount: number | null;
}

interface RunSnapshotStepBody {
  runStepId: string;
  logicalStepId: string;
  position: number;
  name: string;
  unit: string;
  minimum: string;
  maximum: string;
  sampleCount: number;
  intervalMs: number;
  status: RunStepStatus;
  outcome: RunOutcome | null;
  recordedCount: number;
  outOfToleranceCount: number;
  firstFailureSampleIndex: number | null;
  hasOutOfTolerance: boolean;
  statistics: StatisticsBody;
  measurements: MeasurementBody[];
}

interface RunSnapshotBody {
  id: string;
  planId: string;
  planVersionId: string;
  planName: string;
  versionNumber: number;
  profile: {
    id: string;
    code: string;
    name: string;
    description: string | null;
  };
  scenario: RunScenario;
  seed: number;
  errorProbability: string | null;
  failureStepId: string | null;
  simulatorVersion: string;
  evaluationVersion: string;
  status: RunStatus;
  outcome: RunOutcome | null;
  startedAt: string;
  finishedAt: string | null;
  requestedBy: {
    id: string;
    email: string;
    role: Role;
  };
  reasonCode: string | null;
  expectedSampleCount: number;
  recordedSampleCount: number;
  lastEventSequence: number;
  steps: RunSnapshotStepBody[];
}

interface RunActiveBody {
  runId: string;
  planName: string;
  versionNumber: number;
  status: RunStatus;
  expectedSampleCount: number;
  recordedSampleCount: number;
  startedAt: string;
  scenario: RunScenario;
}

interface TerminalRun {
  id: string;
  status: RunStatus;
  outcome: RunOutcome | null;
  reasonCode: string | null;
  expectedSampleCount: number;
  recordedSampleCount: number;
  eventSequence: number;
  startedAt: Date;
  finishedAt: Date | null;
}

const RUN_SNAPSHOT_KEYS = [
  'id',
  'planId',
  'planVersionId',
  'planName',
  'versionNumber',
  'profile',
  'deviceId',
  'deviceSnapshot',
  'batchNumber',
  'scenario',
  'seed',
  'errorProbability',
  'failureStepId',
  'simulatorVersion',
  'evaluationVersion',
  'status',
  'outcome',
  'startedAt',
  'finishedAt',
  'requestedBy',
  'reasonCode',
  'expectedSampleCount',
  'recordedSampleCount',
  'lastEventSequence',
  'steps',
] as const;

const PROFILE_KEYS = ['id', 'code', 'name', 'description'] as const;
const REQUESTED_BY_KEYS = ['id', 'email', 'role'] as const;
const STEP_KEYS = [
  'runStepId',
  'logicalStepId',
  'position',
  'name',
  'unit',
  'minimum',
  'maximum',
  'sampleCount',
  'intervalMs',
  'status',
  'outcome',
  'recordedCount',
  'outOfToleranceCount',
  'firstFailureSampleIndex',
  'hasOutOfTolerance',
  'statistics',
  'measurements',
] as const;
const STATISTICS_KEYS = [
  'minimum',
  'maximum',
  'average',
  'sampleCount',
] as const;
const MEASUREMENT_KEYS = [
  'sampleIndex',
  'value',
  'isWithinTolerance',
  'recordedAt',
  'elapsedMs',
] as const;
const ACTIVE_KEYS = [
  'runId',
  'planName',
  'versionNumber',
  'status',
  'expectedSampleCount',
  'recordedSampleCount',
  'startedAt',
  'scenario',
] as const;

const CANONICAL_DECIMAL = /^-?\d+\.\d{6}$/;

function emptyStatistics(): StatisticsBody {
  return { minimum: null, maximum: null, average: null, sampleCount: null };
}

function runKey(): string {
  return `runs-snapshot-e2e-${randomUUID()}`;
}

describe('run snapshot API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let executor: RunExecutor;
  const scheduler = new ControlledRunScheduler('paused');
  let plannerUser: TestUser;
  let operatorUser: TestUser;
  let viewerUser: TestUser;
  let planner: ClientSession;
  let operator: ClientSession;
  let viewer: ClientSession;
  let fixture: PublishedRunFixture;
  let mutationFixture: PublishedRunFixture;

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

    plannerUser = await createRunTestUser(prisma, Role.PLANNER);
    operatorUser = await createRunTestUser(prisma, Role.OPERATOR);
    viewerUser = await createRunTestUser(prisma, Role.VIEWER);
    const profile = await createRunTestProfile(prisma);

    fixture = await createPublishedRunFixture(prisma, plannerUser.id, profile, {
      planName: 'Snapshot API plan',
    });
    mutationFixture = await createPublishedRunFixture(
      prisma,
      plannerUser.id,
      profile,
      { planName: 'Snapshot live plan v1' },
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
    await deleteRunTestRuns(prisma);
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

  function getAs(session: ClientSession | null, path: string): request.Test {
    const call = request(server()).get(path);
    return session ? call.set('Cookie', session.cookie) : call;
  }

  function postAs(session: ClientSession, path: string): request.Test {
    return request(server())
      .post(path)
      .set('Cookie', session.cookie)
      .set('X-XSRF-TOKEN', session.csrfToken);
  }

  function putAs(session: ClientSession, path: string): request.Test {
    return request(server())
      .put(path)
      .set('Cookie', session.cookie)
      .set('X-XSRF-TOKEN', session.csrfToken);
  }

  async function startRun(
    plan: PublishedRunFixture,
    body: Record<string, unknown> = {},
  ): Promise<StartRunResponseBody> {
    const response = await postAs(operator, '/api/runs')
      .set('Idempotency-Key', runKey())
      .send({
        planVersionId: plan.revisionId,
        scenario: RunScenario.NORMAL,
        seed: 123_456_789,
        ...body,
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

  async function waitForTerminal(runId: string): Promise<TerminalRun> {
    let terminal: TerminalRun | null = null;

    await waitFor(async () => {
      terminal = await prisma.testRun.findUnique({
        where: { id: runId },
        select: {
          id: true,
          status: true,
          outcome: true,
          reasonCode: true,
          expectedSampleCount: true,
          recordedSampleCount: true,
          eventSequence: true,
          startedAt: true,
          finishedAt: true,
        },
      });

      return terminal !== null && terminal.status !== RunStatus.RUNNING;
    }, `run ${runId} to reach a terminal status`);

    await waitFor(
      () => executor.activeExecutionCount === 0,
      'executor to release the terminal run',
    );

    if (!terminal) {
      throw new Error('The terminal run disappeared.');
    }
    return terminal;
  }

  async function loadMaxEventSequence(runId: string): Promise<number> {
    const result = await prisma.runEvent.aggregate({
      where: { runId },
      _max: { sequence: true },
    });
    return result._max.sequence ?? 0;
  }

  async function settlePausedExecution(): Promise<void> {
    await waitFor(
      () => scheduler.pendingCount === 1 || executor.activeExecutionCount === 0,
      'the paused executor to commit its current write',
    );
  }

  function expectExactKeys(value: object, keys: readonly string[]): void {
    expect(Object.keys(value).sort()).toEqual([...keys].sort());
  }

  /**
   * Verifies invariants that must hold inside every individual snapshot,
   * whether it is captured between writes or while the executor is running.
   */
  function expectConsistentSnapshot(
    snapshot: RunSnapshotBody,
    expectedMaxSequence?: number,
  ): void {
    expectExactKeys(snapshot, RUN_SNAPSHOT_KEYS);
    expectExactKeys(snapshot.profile, PROFILE_KEYS);
    expectExactKeys(snapshot.requestedBy, REQUESTED_BY_KEYS);

    expect(snapshot.steps.map((step) => step.position)).toEqual(
      snapshot.steps.map((_, index) => index + 1),
    );
    expect(snapshot.expectedSampleCount).toBe(
      snapshot.steps.reduce((total, step) => total + step.sampleCount, 0),
    );

    const totalRecorded = snapshot.steps.reduce(
      (total, step) => total + step.recordedCount,
      0,
    );
    const totalMeasurements = snapshot.steps.reduce(
      (total, step) => total + step.measurements.length,
      0,
    );
    expect(totalRecorded).toBe(snapshot.recordedSampleCount);
    expect(totalMeasurements).toBe(snapshot.recordedSampleCount);
    expect(snapshot.recordedSampleCount).toBeLessThanOrEqual(
      snapshot.expectedSampleCount,
    );

    let expectedSequence = 1; // run.started
    for (const step of snapshot.steps) {
      expectExactKeys(step, STEP_KEYS);
      expectExactKeys(step.statistics, STATISTICS_KEYS);
      expect(step.minimum).toMatch(CANONICAL_DECIMAL);
      expect(step.maximum).toMatch(CANONICAL_DECIMAL);
      expect(step.hasOutOfTolerance).toBe(step.outOfToleranceCount > 0);
      expect(step.measurements.map((sample) => sample.sampleIndex)).toEqual(
        Array.from({ length: step.recordedCount }, (_, index) => index),
      );
      expect(step.recordedCount).toBe(step.measurements.length);

      for (const measurement of step.measurements) {
        expectExactKeys(measurement, MEASUREMENT_KEYS);
        expect(measurement.value).toMatch(CANONICAL_DECIMAL);
        expect(Number.isInteger(measurement.elapsedMs)).toBe(true);
        expect(measurement.elapsedMs).toBeGreaterThanOrEqual(0);
      }

      if (
        step.status !== RunStepStatus.PENDING &&
        step.status !== RunStepStatus.NOT_RUN
      ) {
        expectedSequence += 1; // step.started
      }
      expectedSequence += step.measurements.length;

      if (step.status === RunStepStatus.COMPLETED) {
        expectedSequence += 1; // step.completed
        expect(step.outcome).not.toBeNull();
        expect(step.statistics).toMatchObject({
          sampleCount: step.recordedCount,
        });
        expect(step.statistics.minimum).toMatch(CANONICAL_DECIMAL);
        expect(step.statistics.maximum).toMatch(CANONICAL_DECIMAL);
        expect(step.statistics.average).toMatch(CANONICAL_DECIMAL);
      } else {
        expect(step.outcome).toBeNull();
        expect(step.statistics).toEqual(emptyStatistics());
      }
    }

    if (snapshot.status !== RunStatus.RUNNING) {
      expectedSequence += 1; // terminal run event
    }
    expect(snapshot.lastEventSequence).toBe(expectedSequence);

    if (expectedMaxSequence !== undefined) {
      expect(snapshot.lastEventSequence).toBe(expectedMaxSequence);
    }
  }

  it('serves a partial RUNNING snapshot, consistent cursors and an explicit active null', async () => {
    scheduler.setMode('paused');
    const started = await startRun(fixture);

    // Release the start delay: the first step becomes RUNNING and waits for
    // its first interval.
    await settlePausedExecution();
    scheduler.releasePending();
    await waitFor(async () => {
      const step = await prisma.runStep.findFirst({
        where: { runId: started.runId, position: 1 },
        select: { status: true },
      });
      return step?.status === RunStepStatus.RUNNING;
    }, 'the first step to start');

    // Release one interval: exactly one measurement is committed.
    await settlePausedExecution();
    scheduler.releasePending();
    await waitFor(async () => {
      const run = await prisma.testRun.findUniqueOrThrow({
        where: { id: started.runId },
        select: { recordedSampleCount: true },
      });
      return run.recordedSampleCount === 1;
    }, 'the first measurement');
    await settlePausedExecution();

    const stored = await prisma.testRun.findUniqueOrThrow({
      where: { id: started.runId },
      include: {
        steps: {
          orderBy: { position: 'asc' },
          include: {
            measurements: { orderBy: { sampleIndex: 'asc' } },
          },
        },
      },
    });
    const maxSequence = await loadMaxEventSequence(started.runId);

    const response = await getAs(operator, `/api/runs/${started.runId}`).expect(
      200,
    );
    expect(response.headers['cache-control']).toBe('no-store');
    const partial = response.body as RunSnapshotBody;
    expectConsistentSnapshot(partial, maxSequence);

    expect(partial).toMatchObject({
      id: started.runId,
      planId: fixture.planId,
      planVersionId: fixture.revisionId,
      planName: fixture.planName,
      versionNumber: fixture.versionNumber,
      profile: fixture.profile,
      scenario: RunScenario.NORMAL,
      seed: 123_456_789,
      errorProbability: null,
      failureStepId: null,
      simulatorVersion: SIMULATOR_VERSION,
      evaluationVersion: RUN_EVALUATION_VERSION,
      status: RunStatus.RUNNING,
      outcome: null,
      finishedAt: null,
      requestedBy: {
        id: operatorUser.id,
        email: operatorUser.email,
        role: Role.OPERATOR,
      },
      reasonCode: null,
      expectedSampleCount: 6,
      recordedSampleCount: 1,
      lastEventSequence: 3,
    });
    expect(Number.isNaN(Date.parse(partial.startedAt))).toBe(false);

    const [firstStep, secondStep, thirdStep] = partial.steps;
    expect(firstStep).toBeDefined();
    expect(secondStep).toBeDefined();
    expect(thirdStep).toBeDefined();

    expect(firstStep).toMatchObject({
      runStepId: stored.steps[0]!.id,
      logicalStepId: fixture.steps[0]!.logicalStepId,
      position: 1,
      name: fixture.steps[0]!.name,
      unit: fixture.steps[0]!.unit,
      minimum: fixture.steps[0]!.minimum,
      maximum: fixture.steps[0]!.maximum,
      sampleCount: fixture.steps[0]!.sampleCount,
      intervalMs: fixture.steps[0]!.intervalMs,
      status: RunStepStatus.RUNNING,
      outcome: null,
      recordedCount: 1,
      outOfToleranceCount: 0,
      firstFailureSampleIndex: null,
      hasOutOfTolerance: false,
      statistics: emptyStatistics(),
    });
    const storedSample = stored.steps[0]!.measurements[0]!;
    expect(firstStep!.measurements).toEqual([
      {
        sampleIndex: 0,
        value: storedSample.value.toFixed(6),
        isWithinTolerance: storedSample.isWithinTolerance,
        recordedAt: storedSample.recordedAt.toISOString(),
        elapsedMs: storedSample.elapsedMs,
      },
    ]);

    for (const [index, step] of [secondStep!, thirdStep!].entries()) {
      const expected = fixture.steps[index + 1]!;
      expect(step).toMatchObject({
        runStepId: stored.steps[index + 1]!.id,
        logicalStepId: expected.logicalStepId,
        position: index + 2,
        name: expected.name,
        unit: expected.unit,
        minimum: expected.minimum,
        maximum: expected.maximum,
        sampleCount: expected.sampleCount,
        intervalMs: expected.intervalMs,
        status: RunStepStatus.PENDING,
        outcome: null,
        recordedCount: 0,
        outOfToleranceCount: 0,
        firstFailureSampleIndex: null,
        hasOutOfTolerance: false,
        statistics: emptyStatistics(),
        measurements: [],
      });
    }

    // No secret, session, request-hash or draft field may leak.
    const serialized = JSON.stringify(partial);
    for (const forbidden of [
      'passwordHash',
      'idempotencyKey',
      'requestHash',
      'session',
      operatorUser.password,
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(partial).not.toHaveProperty('draft');

    const expectedActive: RunActiveBody = {
      runId: started.runId,
      planName: fixture.planName,
      versionNumber: fixture.versionNumber,
      status: RunStatus.RUNNING,
      expectedSampleCount: 6,
      recordedSampleCount: 1,
      startedAt: partial.startedAt,
      scenario: RunScenario.NORMAL,
    };

    for (const session of [planner, operator, viewer]) {
      const activeResponse = await getAs(session, '/api/runs/active').expect(
        200,
      );
      expectExactKeys(activeResponse.body as RunActiveBody, ACTIVE_KEYS);
      expect(activeResponse.body).toEqual(expectedActive);

      const snapshotResponse = await getAs(
        session,
        `/api/runs/${started.runId}`,
      ).expect(200);
      expect(snapshotResponse.body).toEqual(response.body);
    }

    // Release one committed event at a time. At every quiescent point the
    // snapshot counters, measurements and cursor must agree exactly.
    let terminalSnapshot: RunSnapshotBody | null = null;

    for (let iteration = 0; iteration < 40; iteration += 1) {
      await settlePausedExecution();
      scheduler.releasePending();
      await waitFor(
        () =>
          scheduler.pendingCount === 1 || executor.activeExecutionCount === 0,
        'the paused executor to commit one event',
      );

      const stepResponse = await getAs(
        operator,
        `/api/runs/${started.runId}`,
      ).expect(200);
      const snapshot = stepResponse.body as RunSnapshotBody;
      expectConsistentSnapshot(
        snapshot,
        await loadMaxEventSequence(started.runId),
      );

      if (snapshot.status !== RunStatus.RUNNING) {
        terminalSnapshot = snapshot;
        break;
      }
    }

    expect(terminalSnapshot).not.toBeNull();
    expect(terminalSnapshot).toMatchObject({
      id: started.runId,
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.PASSED,
      expectedSampleCount: 6,
      recordedSampleCount: 6,
      lastEventSequence: 14,
    });
    expect(terminalSnapshot!.finishedAt).not.toBeNull();
    expect(Number.isNaN(Date.parse(terminalSnapshot!.finishedAt!))).toBe(false);
    expect(
      terminalSnapshot!.steps.every(
        (step) =>
          step.status === RunStepStatus.COMPLETED &&
          step.outcome === RunOutcome.PASSED &&
          step.recordedCount === step.sampleCount &&
          step.measurements.length === step.sampleCount,
      ),
    ).toBe(true);

    const storedTerminal = await prisma.runStep.findMany({
      where: { runId: started.runId },
      orderBy: { position: 'asc' },
      select: { statistics: true },
    });
    for (const [index, step] of terminalSnapshot!.steps.entries()) {
      expect(step.statistics).toEqual(storedTerminal[index]!.statistics);
    }

    for (const session of [planner, operator, viewer]) {
      const activeResponse = await getAs(session, '/api/runs/active').expect(
        200,
      );
      expect(activeResponse.body).toBeNull();
      expect(activeResponse.text).toBe('null');
    }
  });

  it('serves a completed FAILED snapshot with stored step statistics and failure indexes', async () => {
    scheduler.setMode('auto');
    const started = await startRun(fixture, {
      scenario: RunScenario.FORCED_FAILURE,
      failureStepId: fixture.steps[0]!.logicalStepId,
    });
    const terminal = await waitForTerminal(started.runId);
    expect(terminal).toMatchObject({
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.FAILED,
      expectedSampleCount: 6,
      recordedSampleCount: 6,
    });

    const response = await getAs(viewer, `/api/runs/${started.runId}`).expect(
      200,
    );
    const snapshot = response.body as RunSnapshotBody;
    expectConsistentSnapshot(
      snapshot,
      await loadMaxEventSequence(started.runId),
    );
    expect(snapshot).toMatchObject({
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.FAILED,
      scenario: RunScenario.FORCED_FAILURE,
      failureStepId: fixture.steps[0]!.logicalStepId,
      errorProbability: null,
      expectedSampleCount: 6,
      recordedSampleCount: 6,
      lastEventSequence: 14,
    });

    const failureIndex = Math.floor((fixture.steps[0]!.sampleCount - 1) / 2);
    const failedStep = snapshot.steps[0]!;
    expect(failedStep).toMatchObject({
      status: RunStepStatus.COMPLETED,
      outcome: RunOutcome.FAILED,
      recordedCount: 2,
      outOfToleranceCount: 1,
      firstFailureSampleIndex: failureIndex,
      hasOutOfTolerance: true,
    });
    expect(failedStep.statistics.sampleCount).toBe(2);
    expect(failedStep.measurements).toHaveLength(2);
    expect(failedStep.measurements[failureIndex]).toMatchObject({
      sampleIndex: failureIndex,
      value: '5.500000',
      isWithinTolerance: false,
    });
    expect(
      failedStep.measurements
        .filter((sample) => sample.sampleIndex !== failureIndex)
        .every((sample) => sample.isWithinTolerance),
    ).toBe(true);

    const passedSteps = snapshot.steps.slice(1);
    expect(passedSteps).toHaveLength(2);
    expect(
      passedSteps.every(
        (step) =>
          step.status === RunStepStatus.COMPLETED &&
          step.outcome === RunOutcome.PASSED &&
          step.outOfToleranceCount === 0 &&
          step.firstFailureSampleIndex === null &&
          step.hasOutOfTolerance === false,
      ),
    ).toBe(true);

    const storedSteps = await prisma.runStep.findMany({
      where: { runId: started.runId },
      orderBy: { position: 'asc' },
      select: { statistics: true },
    });
    for (const [index, step] of snapshot.steps.entries()) {
      expect(step.statistics).toEqual(storedSteps[index]!.statistics);
    }
  });

  it('shows hasOutOfTolerance on a partial failing step while its outcome is still null', async () => {
    scheduler.setMode('paused');
    const started = await startRun(fixture, {
      scenario: RunScenario.FORCED_FAILURE,
      failureStepId: fixture.steps[0]!.logicalStepId,
    });

    await settlePausedExecution();
    scheduler.releasePending();
    await waitFor(async () => {
      const step = await prisma.runStep.findFirst({
        where: { runId: started.runId, position: 1 },
        select: { status: true },
      });
      return step?.status === RunStepStatus.RUNNING;
    }, 'the first step to start');

    await settlePausedExecution();
    scheduler.releasePending();
    await waitFor(async () => {
      const run = await prisma.testRun.findUniqueOrThrow({
        where: { id: started.runId },
        select: { recordedSampleCount: true },
      });
      return run.recordedSampleCount === 1;
    }, 'the first forced-failure measurement');
    await settlePausedExecution();

    const response = await getAs(viewer, `/api/runs/${started.runId}`).expect(
      200,
    );
    const snapshot = response.body as RunSnapshotBody;
    expectConsistentSnapshot(
      snapshot,
      await loadMaxEventSequence(started.runId),
    );

    const failureIndex = Math.floor((fixture.steps[0]!.sampleCount - 1) / 2);
    expect(snapshot.status).toBe(RunStatus.RUNNING);
    expect(snapshot.outcome).toBeNull();
    expect(snapshot.recordedSampleCount).toBe(1);
    expect(snapshot.steps[0]).toMatchObject({
      status: RunStepStatus.RUNNING,
      outcome: null,
      recordedCount: 1,
      outOfToleranceCount: 1,
      firstFailureSampleIndex: failureIndex,
      hasOutOfTolerance: true,
      statistics: emptyStatistics(),
    });
    expect(snapshot.steps[0]!.measurements[failureIndex]).toMatchObject({
      sampleIndex: failureIndex,
      value: '5.500000',
      isWithinTolerance: false,
    });
  });

  it('keeps terminal snapshot rules after a new draft and published version', async () => {
    scheduler.setMode('auto');
    const started = await startRun(mutationFixture);
    const terminal = await waitForTerminal(started.runId);
    expect(terminal).toMatchObject({
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.PASSED,
    });

    const before = await getAs(operator, `/api/runs/${started.runId}`).expect(
      200,
    );
    const beforeBody = before.body as RunSnapshotBody;
    expect(beforeBody.planName).toBe(mutationFixture.planName);
    expect(beforeBody.versionNumber).toBe(1);
    expect(beforeBody.steps.map((step) => step.minimum)).toEqual(
      mutationFixture.steps.map((step) => step.minimum),
    );

    const createdDraft = await postAs(
      planner,
      `/api/plans/${mutationFixture.planId}/drafts`,
    ).expect(201);
    const draft = createdDraft.body as {
      id: string;
      editRevision: number;
    };

    const saved = await putAs(
      planner,
      `/api/plans/${mutationFixture.planId}/draft`,
    )
      .send({
        name: 'Snapshot live plan v2',
        expectedRevision: draft.editRevision,
        steps: [
          {
            name: 'Changed voltage',
            unit: 'mV',
            minimum: '0.000000',
            maximum: '999.000000',
            sampleCount: 4,
            intervalMs: 100,
          },
        ],
      })
      .expect(200);
    const savedDraft = saved.body as { editRevision: number };

    await postAs(planner, `/api/plans/${mutationFixture.planId}/draft/publish`)
      .send({ expectedRevision: savedDraft.editRevision })
      .expect(201);

    const after = await getAs(operator, `/api/runs/${started.runId}`).expect(
      200,
    );
    expect(after.body).toEqual(before.body);
    const afterBody = after.body as RunSnapshotBody;
    expect(afterBody.planName).toBe('Snapshot live plan v1');
    expect(afterBody.versionNumber).toBe(1);
    expect(afterBody.steps).toHaveLength(3);
    expect(afterBody.steps[0]!.minimum).toBe('4.750000');
    expect(JSON.stringify(afterBody)).not.toContain('Snapshot live plan v2');
    expect(JSON.stringify(afterBody)).not.toContain('Changed voltage');
    expect(afterBody).not.toHaveProperty('draft');

    const activeResponse = await getAs(planner, '/api/runs/active').expect(200);
    expect(activeResponse.body).toBeNull();
  });

  it('returns explicit null when idle, safe 404 for unknown ids and 401 without a session', async () => {
    await deleteRunTestRuns(prisma);

    const idle = await getAs(viewer, '/api/runs/active').expect(200);
    expect(idle.body).toBeNull();
    expect(idle.text).toBe('null');

    const unknownId = randomUUID();
    const unknown = await getAs(operator, `/api/runs/${unknownId}`).expect(404);
    expect(unknown.body).toMatchObject({ code: 'NOT_FOUND' });
    expect(JSON.stringify(unknown.body)).not.toContain('SELECT');

    const malformed = await getAs(operator, '/api/runs/not-a-uuid').expect(400);
    expect(malformed.body).toMatchObject({ code: 'VALIDATION_ERROR' });

    for (const path of ['/api/runs/active', `/api/runs/${unknownId}`]) {
      const unauthenticated = await request(server()).get(path).expect(401);
      expect(unauthenticated.body).toMatchObject({ code: 'UNAUTHENTICATED' });
    }
  });

  it('keeps every snapshot internally consistent while a run writes normally', async () => {
    scheduler.setMode('auto');
    const started = await startRun(fixture);

    const observedStatuses: RunStatus[] = [];
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const sequenceBefore = await loadMaxEventSequence(started.runId);
      const response = await getAs(viewer, `/api/runs/${started.runId}`).expect(
        200,
      );
      const sequenceAfter = await loadMaxEventSequence(started.runId);
      const snapshot = response.body as RunSnapshotBody;

      expectConsistentSnapshot(snapshot);
      expect(snapshot.lastEventSequence).toBeGreaterThanOrEqual(sequenceBefore);
      expect(snapshot.lastEventSequence).toBeLessThanOrEqual(sequenceAfter);

      observedStatuses.push(snapshot.status);
      if (snapshot.status !== RunStatus.RUNNING) {
        break;
      }
    }

    expect(observedStatuses.length).toBeGreaterThan(0);
    expect(
      observedStatuses.every(
        (status) =>
          status === RunStatus.RUNNING || status === RunStatus.COMPLETED,
      ),
    ).toBe(true);

    const terminal = await waitForTerminal(started.runId);
    expect(terminal).toMatchObject({
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.PASSED,
    });

    const finalResponse = await getAs(
      operator,
      `/api/runs/${started.runId}`,
    ).expect(200);
    expectConsistentSnapshot(
      finalResponse.body as RunSnapshotBody,
      await loadMaxEventSequence(started.runId),
    );
  });
});
