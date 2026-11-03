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
  type PublishedRunFixture,
} from './support/run-helpers.js';

interface ClientSession {
  cookie: string;
  csrfToken: string;
}

interface FirstFailureBody {
  stepPosition: number;
  stepName: string;
  logicalStepId: string;
  sampleIndex: number;
}

interface HistoryItemBody {
  id: string;
  planId: string;
  planVersionId: string;
  planName: string;
  versionNumber: number;
  scenario: RunScenario;
  seed: number;
  status: RunStatus;
  outcome: RunOutcome | null;
  startedAt: string;
  finishedAt: string | null;
  expectedSampleCount: number;
  recordedSampleCount: number;
  outOfToleranceCount: number;
  firstFailure: FirstFailureBody | null;
  partial: boolean;
  requestedBy: {
    id: string;
    email: string;
    role: Role;
  };
}

interface HistoryPageBody {
  items: HistoryItemBody[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface StepSeed {
  status: RunStepStatus;
  outcome: RunOutcome | null;
  recordedCount: number;
  outOfToleranceIndexes?: readonly number[];
}

interface SeededRun {
  id: string;
  startedAt: string;
  status: RunStatus;
  outcome: RunOutcome | null;
}

interface SeedRunOptions {
  fixture: PublishedRunFixture;
  requestedById: string;
  status: RunStatus;
  outcome: RunOutcome | null;
  startedAt: string;
  finishedAt: string;
  planNameSnapshot: string;
  seed: number;
  steps: readonly StepSeed[];
}

const HISTORY_ITEM_KEYS = [
  'id',
  'planId',
  'planVersionId',
  'planName',
  'versionNumber',
  'scenario',
  'seed',
  'status',
  'outcome',
  'startedAt',
  'finishedAt',
  'expectedSampleCount',
  'recordedSampleCount',
  'outOfToleranceCount',
  'firstFailure',
  'partial',
  'requestedBy',
] as const;
const FIRST_FAILURE_KEYS = [
  'stepPosition',
  'stepName',
  'logicalStepId',
  'sampleIndex',
] as const;
const PAGE_KEYS = ['items', 'page', 'limit', 'total', 'totalPages'] as const;

function expectExactKeys(value: object, keys: readonly string[]): void {
  expect(Object.keys(value).sort()).toEqual([...keys].sort());
}

describe('run history API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let plannerUser: TestUser;
  let operatorUser: TestUser;
  let viewerUser: TestUser;
  let planner: ClientSession;
  let operator: ClientSession;
  let viewer: ClientSession;
  let planA: PublishedRunFixture;
  let planB: PublishedRunFixture;

  let passedA: SeededRun;
  let failedB: SeededRun;
  let cancelledC: SeededRun;
  let interruptedD: SeededRun;
  let erroredE: SeededRun;
  let passedF: SeededRun;
  let failedG: SeededRun;

  const server = () => app.getHttpServer();

  beforeAll(async () => {
    app = await createTestApplication();
    prisma = app.get(PrismaService);

    await deleteRunTestData(prisma);

    plannerUser = await createRunTestUser(prisma, Role.PLANNER);
    operatorUser = await createRunTestUser(prisma, Role.OPERATOR);
    viewerUser = await createRunTestUser(prisma, Role.VIEWER);
    const profile = await createRunTestProfile(prisma);

    planA = await createPublishedRunFixture(prisma, plannerUser.id, profile, {
      planName: 'History plan alpha',
    });
    planB = await createPublishedRunFixture(prisma, plannerUser.id, profile, {
      planName: 'History plan beta',
      versionNumber: 2,
    });

    planner = await login(plannerUser);
    operator = await login(operatorUser);
    viewer = await login(viewerUser);

    passedA = await seedRun({
      fixture: planA,
      requestedById: operatorUser.id,
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.PASSED,
      startedAt: '2026-11-01T10:00:00.000Z',
      finishedAt: '2026-11-01T10:00:30.000Z',
      planNameSnapshot: 'History plan alpha v1 snapshot',
      seed: 1001,
      steps: completedSteps(),
    });

    failedB = await seedRun({
      fixture: planA,
      requestedById: operatorUser.id,
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.FAILED,
      startedAt: '2026-11-02T10:00:00.000Z',
      finishedAt: '2026-11-02T10:00:30.000Z',
      planNameSnapshot: 'History plan alpha v1 snapshot',
      seed: 1002,
      steps: [
        {
          status: RunStepStatus.COMPLETED,
          outcome: RunOutcome.PASSED,
          recordedCount: 2,
        },
        {
          status: RunStepStatus.COMPLETED,
          outcome: RunOutcome.FAILED,
          recordedCount: 3,
          outOfToleranceIndexes: [1, 2],
        },
        {
          status: RunStepStatus.COMPLETED,
          outcome: RunOutcome.PASSED,
          recordedCount: 1,
        },
      ],
    });

    cancelledC = await seedRun({
      fixture: planB,
      requestedById: operatorUser.id,
      status: RunStatus.CANCELLED,
      outcome: null,
      startedAt: '2026-11-03T10:00:00.000Z',
      finishedAt: '2026-11-03T10:00:15.000Z',
      planNameSnapshot: 'History plan beta v2 snapshot',
      seed: 1003,
      steps: [
        {
          status: RunStepStatus.CANCELLED,
          outcome: null,
          recordedCount: 1,
        },
        { status: RunStepStatus.NOT_RUN, outcome: null, recordedCount: 0 },
        { status: RunStepStatus.NOT_RUN, outcome: null, recordedCount: 0 },
      ],
    });

    interruptedD = await seedRun({
      fixture: planB,
      requestedById: operatorUser.id,
      status: RunStatus.INTERRUPTED,
      outcome: null,
      startedAt: '2026-11-04T10:00:00.000Z',
      finishedAt: '2026-11-04T10:00:20.000Z',
      planNameSnapshot: 'History plan beta v2 snapshot',
      seed: 1004,
      steps: [
        {
          status: RunStepStatus.INTERRUPTED,
          outcome: null,
          recordedCount: 0,
        },
        { status: RunStepStatus.NOT_RUN, outcome: null, recordedCount: 0 },
        { status: RunStepStatus.NOT_RUN, outcome: null, recordedCount: 0 },
      ],
    });

    erroredE = await seedRun({
      fixture: planA,
      requestedById: operatorUser.id,
      status: RunStatus.ERROR,
      outcome: null,
      startedAt: '2026-11-05T10:00:00.000Z',
      finishedAt: '2026-11-05T10:00:10.000Z',
      planNameSnapshot: 'History plan alpha v1 snapshot',
      seed: 1005,
      steps: [
        {
          status: RunStepStatus.ERROR,
          outcome: null,
          recordedCount: 1,
          outOfToleranceIndexes: [0],
        },
        { status: RunStepStatus.NOT_RUN, outcome: null, recordedCount: 0 },
        { status: RunStepStatus.NOT_RUN, outcome: null, recordedCount: 0 },
      ],
    });

    // Same startedAt as passedA. Pagination must break the tie by id DESC.
    passedF = await seedRun({
      fixture: planB,
      requestedById: operatorUser.id,
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.PASSED,
      startedAt: '2026-11-01T10:00:00.000Z',
      finishedAt: '2026-11-01T10:00:30.000Z',
      planNameSnapshot: 'History plan beta v2 snapshot',
      seed: 1006,
      steps: completedSteps(),
    });

    // Step 1 fails at sample 1 while step 2 fails at sample 0. The earliest
    // failure is still step 1 by position, not the lowest sample index.
    failedG = await seedRun({
      fixture: planA,
      requestedById: operatorUser.id,
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.FAILED,
      startedAt: '2026-11-06T10:00:00.000Z',
      finishedAt: '2026-11-06T10:00:30.000Z',
      planNameSnapshot: 'History plan alpha v1 snapshot',
      seed: 1007,
      steps: [
        {
          status: RunStepStatus.COMPLETED,
          outcome: RunOutcome.FAILED,
          recordedCount: 2,
          outOfToleranceIndexes: [1],
        },
        {
          status: RunStepStatus.COMPLETED,
          outcome: RunOutcome.FAILED,
          recordedCount: 3,
          outOfToleranceIndexes: [0],
        },
        {
          status: RunStepStatus.COMPLETED,
          outcome: RunOutcome.PASSED,
          recordedCount: 1,
        },
      ],
    });
  });

  afterAll(async () => {
    try {
      if (prisma) {
        await deleteRunTestData(prisma);
      }
    } finally {
      if (prisma) {
        await prisma.$disconnect();
      }
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

  /**
   * Inserts a complete run fixture. Measurements are written while the run is
   * still RUNNING because the database rejects samples for terminal runs, then
   * the owning run is terminalized exactly as the executor does.
   */
  async function seedRun(options: SeedRunOptions): Promise<SeededRun> {
    const expectedSampleCount = options.fixture.steps.reduce(
      (total, step) => total + step.sampleCount,
      0,
    );
    const recordedSampleCount = options.steps.reduce(
      (total, step) => total + step.recordedCount,
      0,
    );

    if (options.steps.length !== options.fixture.steps.length) {
      throw new Error('Every seeded step must match one fixture step.');
    }

    const run = await prisma.testRun.create({
      data: {
        planId: options.fixture.planId,
        planRevisionId: options.fixture.revisionId,
        planNameSnapshot: options.planNameSnapshot,
        versionNumberSnapshot: options.fixture.versionNumber,
        profileSnapshot: options.fixture.profile,
        status: RunStatus.RUNNING,
        outcome: null,
        requestedById: options.requestedById,
        scenario: RunScenario.NORMAL,
        seed: BigInt(options.seed),
        simulatorVersion: SIMULATOR_VERSION,
        evaluationVersion: RUN_EVALUATION_VERSION,
        idempotencyKey: `runs-history-e2e-${randomUUID()}`,
        requestHash: randomUUID().replaceAll('-', ''),
        eventSequence: 1,
        expectedSampleCount,
        recordedSampleCount,
        startedAt: new Date(options.startedAt),
        finishedAt: null,
      },
      select: { id: true },
    });

    for (const [index, step] of options.steps.entries()) {
      const example = options.fixture.steps[index]!;
      const outOfToleranceIndexes = step.outOfToleranceIndexes ?? [];
      const firstFailureSampleIndex =
        outOfToleranceIndexes.length === 0
          ? null
          : Math.min(...outOfToleranceIndexes);

      const created = await prisma.runStep.create({
        data: {
          runId: run.id,
          logicalStepId: example.logicalStepId,
          position: example.position,
          name: example.name,
          unit: example.unit,
          minimum: example.minimum,
          maximum: example.maximum,
          sampleCount: example.sampleCount,
          intervalMs: example.intervalMs,
          status: step.status,
          outcome: step.outcome,
          recordedCount: step.recordedCount,
          outOfToleranceCount: outOfToleranceIndexes.length,
          firstFailureSampleIndex,
          statistics:
            step.status === RunStepStatus.COMPLETED
              ? {
                  minimum: '4.900000',
                  maximum: '5.500000',
                  average: '5.010000',
                  sampleCount: step.recordedCount,
                }
              : undefined,
        },
        select: { id: true },
      });

      if (step.recordedCount > 0) {
        const startedAt = new Date(options.startedAt);
        await prisma.measurement.createMany({
          data: Array.from(
            { length: step.recordedCount },
            (_, sampleIndex) => ({
              runId: run.id,
              runStepId: created.id,
              sampleIndex,
              value: outOfToleranceIndexes.includes(sampleIndex)
                ? '5.500000'
                : '5.000000',
              isWithinTolerance: !outOfToleranceIndexes.includes(sampleIndex),
              recordedAt: new Date(
                startedAt.getTime() + sampleIndex * example.intervalMs,
              ),
              elapsedMs: sampleIndex * example.intervalMs,
            }),
          ),
        });
      }
    }

    await prisma.testRun.update({
      where: { id: run.id },
      data: {
        status: options.status,
        outcome: options.outcome,
        finishedAt: new Date(options.finishedAt),
        eventSequence: 2,
      },
    });

    return {
      id: run.id,
      startedAt: options.startedAt,
      status: options.status,
      outcome: options.outcome,
    };
  }

  function completedSteps(): StepSeed[] {
    return [
      {
        status: RunStepStatus.COMPLETED,
        outcome: RunOutcome.PASSED,
        recordedCount: 2,
      },
      {
        status: RunStepStatus.COMPLETED,
        outcome: RunOutcome.PASSED,
        recordedCount: 3,
      },
      {
        status: RunStepStatus.COMPLETED,
        outcome: RunOutcome.PASSED,
        recordedCount: 1,
      },
    ];
  }

  function listAs(
    session: ClientSession | null,
    query: Record<string, string | number> = {},
  ): request.Test {
    const call = request(server()).get('/api/runs').query(query);
    return session ? call.set('Cookie', session.cookie) : call;
  }

  function expectIds(page: HistoryPageBody, expected: readonly string[]): void {
    expect(page.items.map((item) => item.id).sort()).toEqual(
      [...expected].sort(),
    );
  }

  function tiedPassedRunsNewestFirst(): SeededRun[] {
    return [passedA, passedF].sort((left, right) =>
      left.id < right.id ? 1 : -1,
    );
  }

  it('serves the default page in stable startedAt DESC, id DESC order without measurement arrays', async () => {
    const response = await listAs(operator).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');

    const page = response.body as HistoryPageBody;
    expectExactKeys(page, PAGE_KEYS);
    expect(page).toMatchObject({
      page: 1,
      limit: 20,
      total: 7,
      totalPages: 1,
    });
    expect(page.items).toHaveLength(7);

    const expectedOrder = [
      failedG,
      erroredE,
      interruptedD,
      cancelledC,
      failedB,
      ...tiedPassedRunsNewestFirst(),
    ];
    expect(page.items.map((item) => item.id)).toEqual(
      expectedOrder.map((run) => run.id),
    );

    expect(
      page.items
        .filter((item) => item.status === RunStatus.COMPLETED)
        .every((item) => !item.partial),
    ).toBe(true);
    expect(
      page.items
        .filter((item) => item.status !== RunStatus.COMPLETED)
        .every((item) => item.partial),
    ).toBe(true);
    for (const item of page.items) {
      expectExactKeys(item, HISTORY_ITEM_KEYS);
      expectExactKeys(item.requestedBy, ['id', 'email', 'role']);
      expect(item).not.toHaveProperty('steps');
      expect(item).not.toHaveProperty('measurements');
      expect(item).not.toHaveProperty('lastEventSequence');
      expect(Number.isNaN(Date.parse(item.startedAt))).toBe(false);
    }

    const serialized = JSON.stringify(page);
    expect(serialized).not.toContain('"measurements"');
    expect(serialized).not.toContain('"steps"');
    expect(serialized).not.toContain('idempotencyKey');
    expect(serialized).not.toContain('requestHash');

    const snapshotRun = page.items.find((item) => item.id === passedA.id)!;
    expect(snapshotRun).toMatchObject({
      planId: planA.planId,
      planVersionId: planA.revisionId,
      // Snapshot name, never the live plan name.
      planName: 'History plan alpha v1 snapshot',
      versionNumber: 1,
      scenario: RunScenario.NORMAL,
      seed: 1001,
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.PASSED,
      startedAt: passedA.startedAt,
      finishedAt: '2026-11-01T10:00:30.000Z',
      expectedSampleCount: 6,
      recordedSampleCount: 6,
      outOfToleranceCount: 0,
      firstFailure: null,
      partial: false,
      requestedBy: {
        id: operatorUser.id,
        email: operatorUser.email,
        role: Role.OPERATOR,
      },
    });
    expect(JSON.stringify(page)).not.toContain('"History plan alpha"');
  });

  it('paginates with correct totals and a stable id tie-break across page boundaries', async () => {
    const first = await listAs(operator, { limit: 2, page: 1 }).expect(200);
    const firstPage = first.body as HistoryPageBody;
    expect(firstPage).toMatchObject({
      page: 1,
      limit: 2,
      total: 7,
      totalPages: 4,
    });
    expect(firstPage.items.map((item) => item.id)).toEqual([
      failedG.id,
      erroredE.id,
    ]);

    const second = await listAs(operator, { limit: 2, page: 2 }).expect(200);
    expect(
      (second.body as HistoryPageBody).items.map((item) => item.id),
    ).toEqual([interruptedD.id, cancelledC.id]);

    const tieOrder = tiedPassedRunsNewestFirst();
    const third = await listAs(operator, { limit: 2, page: 3 }).expect(200);
    const fourth = await listAs(operator, { limit: 2, page: 4 }).expect(200);
    const thirdPage = third.body as HistoryPageBody;
    const fourthPage = fourth.body as HistoryPageBody;

    expect(thirdPage.items.map((item) => item.id)).toEqual([
      failedB.id,
      tieOrder[0]!.id,
    ]);
    expect(fourthPage.items.map((item) => item.id)).toEqual([tieOrder[1]!.id]);
    expect(thirdPage.items[1]!.startedAt).toBe(fourthPage.items[0]!.startedAt);
    expect(thirdPage.items[1]!.id > fourthPage.items[0]!.id).toBe(true);

    const beyond = await listAs(operator, { limit: 2, page: 99 }).expect(200);
    expect(beyond.body).toEqual({
      items: [],
      page: 99,
      limit: 2,
      total: 7,
      totalPages: 4,
    });
  });

  it('filters by planId, status and outcome individually and combined', async () => {
    const byPlanA = (
      await listAs(operator, { planId: planA.planId }).expect(200)
    ).body as HistoryPageBody;
    expect(byPlanA.total).toBe(4);
    expectIds(byPlanA, [passedA.id, failedB.id, erroredE.id, failedG.id]);

    const byPlanB = (
      await listAs(operator, { planId: planB.planId }).expect(200)
    ).body as HistoryPageBody;
    expect(byPlanB.total).toBe(3);
    expectIds(byPlanB, [cancelledC.id, interruptedD.id, passedF.id]);

    const completed = (
      await listAs(operator, { status: RunStatus.COMPLETED }).expect(200)
    ).body as HistoryPageBody;
    expect(completed.total).toBe(4);
    expectIds(completed, [passedA.id, failedB.id, passedF.id, failedG.id]);

    const cancelled = (
      await listAs(operator, { status: RunStatus.CANCELLED }).expect(200)
    ).body as HistoryPageBody;
    expect(cancelled.total).toBe(1);
    expectIds(cancelled, [cancelledC.id]);

    const passed = (
      await listAs(operator, { outcome: RunOutcome.PASSED }).expect(200)
    ).body as HistoryPageBody;
    expect(passed.total).toBe(2);
    expectIds(passed, [passedA.id, passedF.id]);

    const failed = (
      await listAs(operator, { outcome: RunOutcome.FAILED }).expect(200)
    ).body as HistoryPageBody;
    expect(failed.total).toBe(2);
    expectIds(failed, [failedB.id, failedG.id]);

    const combined = (
      await listAs(operator, {
        planId: planA.planId,
        status: RunStatus.COMPLETED,
        outcome: RunOutcome.FAILED,
      }).expect(200)
    ).body as HistoryPageBody;
    expect(combined.total).toBe(2);
    expectIds(combined, [failedB.id, failedG.id]);

    const combinedBeta = (
      await listAs(operator, {
        planId: planB.planId,
        status: RunStatus.COMPLETED,
        outcome: RunOutcome.PASSED,
      }).expect(200)
    ).body as HistoryPageBody;
    expect(combinedBeta.total).toBe(1);
    expectIds(combinedBeta, [passedF.id]);

    const noMatch = (
      await listAs(operator, {
        planId: planA.planId,
        status: RunStatus.CANCELLED,
      }).expect(200)
    ).body as HistoryPageBody;
    expect(noMatch).toMatchObject({ total: 0, totalPages: 0, items: [] });
  });

  it('applies UTC [from, to) date boundaries, including date-only filters', async () => {
    const window = (
      await listAs(operator, {
        from: '2026-11-02T10:00:00.000Z',
        to: '2026-11-04T10:00:00.000Z',
      }).expect(200)
    ).body as HistoryPageBody;
    // from is inclusive, to is exclusive (interruptedD starts exactly at to).
    expect(window.total).toBe(2);
    expectIds(window, [failedB.id, cancelledC.id]);

    const threeDays = (
      await listAs(operator, {
        from: '2026-11-03T00:00:00.000Z',
        to: '2026-11-06T00:00:00.000Z',
      }).expect(200)
    ).body as HistoryPageBody;
    expect(threeDays.total).toBe(3);
    expectIds(threeDays, [cancelledC.id, interruptedD.id, erroredE.id]);

    const dateOnly = (
      await listAs(operator, {
        from: '2026-11-03',
        to: '2026-11-06',
      }).expect(200)
    ).body as HistoryPageBody;
    expect(dateOnly.total).toBe(3);
    expectIds(dateOnly, [cancelledC.id, interruptedD.id, erroredE.id]);

    const fromOnly = (
      await listAs(operator, { from: '2026-11-05T10:00:00.000Z' }).expect(200)
    ).body as HistoryPageBody;
    expect(fromOnly.total).toBe(2);
    expectIds(fromOnly, [erroredE.id, failedG.id]);

    const toOnly = (
      await listAs(operator, { to: '2026-11-02T10:00:00.000Z' }).expect(200)
    ).body as HistoryPageBody;
    expect(toOnly.total).toBe(2);
    expectIds(toOnly, [passedA.id, passedF.id]);

    const exactStart = (
      await listAs(operator, { from: '2026-11-06T10:00:00.000Z' }).expect(200)
    ).body as HistoryPageBody;
    expect(exactStart.total).toBe(1);
    expectIds(exactStart, [failedG.id]);
  });

  it('derives counts and the earliest failure for PASSED, FAILED, CANCELLED, INTERRUPTED and ERROR runs', async () => {
    const page = (await listAs(operator, { limit: 100 }).expect(200))
      .body as HistoryPageBody;

    const byId = new Map(page.items.map((item) => [item.id, item]));

    expect(byId.get(passedA.id)).toMatchObject({
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.PASSED,
      expectedSampleCount: 6,
      recordedSampleCount: 6,
      outOfToleranceCount: 0,
      firstFailure: null,
      partial: false,
    });

    expect(byId.get(failedB.id)).toMatchObject({
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.FAILED,
      expectedSampleCount: 6,
      recordedSampleCount: 6,
      outOfToleranceCount: 2,
      partial: false,
      firstFailure: {
        stepPosition: 2,
        stepName: 'Current Draw',
        logicalStepId: planA.steps[1]!.logicalStepId,
        sampleIndex: 1,
      },
    });

    expect(byId.get(failedG.id)).toMatchObject({
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.FAILED,
      expectedSampleCount: 6,
      recordedSampleCount: 6,
      outOfToleranceCount: 2,
      partial: false,
      // Step 1 sample 1 beats step 2 sample 0 by step position.
      firstFailure: {
        stepPosition: 1,
        stepName: 'Output Voltage',
        logicalStepId: planA.steps[0]!.logicalStepId,
        sampleIndex: 1,
      },
    });

    expect(byId.get(cancelledC.id)).toMatchObject({
      status: RunStatus.CANCELLED,
      outcome: null,
      expectedSampleCount: 6,
      recordedSampleCount: 1,
      outOfToleranceCount: 0,
      firstFailure: null,
      partial: true,
    });

    expect(byId.get(interruptedD.id)).toMatchObject({
      status: RunStatus.INTERRUPTED,
      outcome: null,
      expectedSampleCount: 6,
      recordedSampleCount: 0,
      outOfToleranceCount: 0,
      firstFailure: null,
      partial: true,
    });

    expect(byId.get(erroredE.id)).toMatchObject({
      status: RunStatus.ERROR,
      outcome: null,
      expectedSampleCount: 6,
      recordedSampleCount: 1,
      outOfToleranceCount: 1,
      partial: true,
      firstFailure: {
        stepPosition: 1,
        stepName: 'Output Voltage',
        logicalStepId: planA.steps[0]!.logicalStepId,
        sampleIndex: 0,
      },
    });

    for (const item of page.items) {
      if (item.firstFailure !== null) {
        expectExactKeys(item.firstFailure, FIRST_FAILURE_KEYS);
      }
      expect(item.recordedSampleCount).toBeLessThanOrEqual(
        item.expectedSampleCount,
      );
      expect(item.partial).toBe(
        item.status !== RunStatus.COMPLETED ||
          item.recordedSampleCount < item.expectedSampleCount,
      );
    }
  });

  it('keeps aggregate counters equal to the persisted step counters', async () => {
    const page = (await listAs(operator, { limit: 100 }).expect(200))
      .body as HistoryPageBody;
    const stored = await prisma.testRun.findMany({
      where: { id: { in: page.items.map((item) => item.id) } },
      select: {
        id: true,
        expectedSampleCount: true,
        recordedSampleCount: true,
        steps: {
          orderBy: { position: 'asc' },
          select: {
            position: true,
            name: true,
            logicalStepId: true,
            sampleCount: true,
            recordedCount: true,
            outOfToleranceCount: true,
            firstFailureSampleIndex: true,
          },
        },
      },
    });

    for (const run of stored) {
      const item = page.items.find((candidate) => candidate.id === run.id)!;
      const expected = run.steps.reduce(
        (total, step) => total + step.sampleCount,
        0,
      );
      const recorded = run.steps.reduce(
        (total, step) => total + step.recordedCount,
        0,
      );
      const outOfTolerance = run.steps.reduce(
        (total, step) => total + step.outOfToleranceCount,
        0,
      );
      const earliest = run.steps.find(
        (step) => step.firstFailureSampleIndex !== null,
      );

      expect(run.expectedSampleCount).toBe(expected);
      expect(run.recordedSampleCount).toBe(recorded);
      expect(item.expectedSampleCount).toBe(expected);
      expect(item.recordedSampleCount).toBe(recorded);
      expect(item.outOfToleranceCount).toBe(outOfTolerance);
      expect(item.firstFailure).toEqual(
        earliest === undefined
          ? null
          : {
              stepPosition: earliest.position,
              stepName: earliest.name,
              logicalStepId: earliest.logicalStepId,
              sampleIndex: earliest.firstFailureSampleIndex,
            },
      );
    }
  });

  it('shows null statistics and no samples for a run that never recorded a measurement', async () => {
    const history = (
      await listAs(viewer, { status: RunStatus.INTERRUPTED }).expect(200)
    ).body as HistoryPageBody;
    const item = history.items.find(
      (candidate) => candidate.id === interruptedD.id,
    )!;
    expect(item).toMatchObject({
      expectedSampleCount: 6,
      recordedSampleCount: 0,
      outOfToleranceCount: 0,
      firstFailure: null,
      partial: true,
    });

    const snapshot = await request(server())
      .get(`/api/runs/${interruptedD.id}`)
      .set('Cookie', viewer.cookie)
      .expect(200);

    for (const step of snapshot.body.steps as Array<{
      statistics: Record<string, unknown>;
      measurements: unknown[];
    }>) {
      expect(step.statistics).toEqual({
        minimum: null,
        maximum: null,
        average: null,
        sampleCount: null,
      });
      expect(step.measurements).toEqual([]);
    }
  });

  it('allows Planner, Operator and Viewer reads and rejects unauthenticated requests', async () => {
    const responses = await Promise.all(
      [planner, operator, viewer].map((session) =>
        listAs(session, { limit: 100 }).expect(200),
      ),
    );

    expect(responses[0]!.body).toEqual(responses[1]!.body);
    expect(responses[1]!.body).toEqual(responses[2]!.body);

    const unauthenticated = await request(server())
      .get('/api/runs')
      .expect(401);
    expect(unauthenticated.body).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects malformed filters, unknown parameters and out-of-range pagination', async () => {
    const cases: Array<{
      query: Record<string, string | number>;
      field: string;
      code?: string;
    }> = [
      { query: { planId: 'not-a-uuid' }, field: 'planId' },
      { query: { status: 'BROKEN' }, field: 'status' },
      { query: { outcome: 'BROKEN' }, field: 'outcome' },
      { query: { from: 'not-a-date' }, field: 'from' },
      { query: { from: '2026-11-03T12:00:00' }, field: 'from' },
      { query: { to: '2026-02-30' }, field: 'to' },
      { query: { page: 0 }, field: 'page' },
      { query: { page: 1.5 }, field: 'page' },
      { query: { page: 'abc' }, field: 'page' },
      { query: { limit: 0 }, field: 'limit' },
      { query: { limit: 101 }, field: 'limit' },
      { query: { limit: 'abc' }, field: 'limit' },
      {
        query: { unexpected: 'value' },
        field: 'unexpected',
        code: 'UNKNOWN_FIELD',
      },
    ];

    for (const testCase of cases) {
      const response = await listAs(operator, testCase.query).expect(400);
      expect(response.body).toMatchObject({
        code: 'VALIDATION_ERROR',
        requestId: expect.any(String),
      });
      expect(response.body.fieldErrors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: testCase.field,
            ...(testCase.code === undefined ? {} : { code: testCase.code }),
          }),
        ]),
      );
    }
  });

  it('enforces the 100 item limit maximum and accepts the maximum', async () => {
    const maximum = await listAs(operator, { limit: 100 }).expect(200);
    expect(maximum.body).toMatchObject({
      page: 1,
      limit: 100,
      total: 7,
      totalPages: 1,
    });

    const rejected = await listAs(operator, { limit: 101 }).expect(400);
    expect(rejected.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(rejected.body.fieldErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'limit', code: 'INVALID_VALUE' }),
      ]),
    );

    const defaultLimit = await listAs(operator).expect(200);
    expect(defaultLimit.body).toMatchObject({ limit: 20, page: 1 });
  });
});
