import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import {
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from '../src/auth/auth.constants.js';
import {
  buildAnalyticsWhere,
  buildSummaryQuery,
  buildTopFailedStepsQuery,
  buildTrendQuery,
} from '../src/analytics/analytics-query.js';
import { resolveAnalyticsFilters } from '../src/analytics/analytics-domain.js';
import type { AnalyticsOverviewQueryDto } from '../src/analytics/dto/analytics-overview-query.dto.js';
import { APP_CONFIG, type AppConfig } from '../src/config/env.js';
import {
  Role,
  RunOutcome,
  RunScenario,
  RunStatus,
  RunStepStatus,
} from '../src/prisma/generated/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cookieHeader,
  getCookie,
  readSetCookies,
  type TestUser,
} from './support/auth-helpers.js';
import {
  createAnalyticsPlan,
  createAnalyticsTestApplication,
  createAnalyticsTestDevice,
  createAnalyticsTestProfile,
  createAnalyticsTestUser,
  deleteAnalyticsRuns,
  deleteAnalyticsTestData,
  publishAnalyticsRevision,
  seedAnalyticsMeasurement,
  seedAnalyticsRun,
  type AnalyticsDeviceSnapshotInput,
  type AnalyticsProfileFixture,
  type AnalyticsRevisionFixture,
  type AnalyticsRunStepSeed,
} from './support/analytics-helpers.js';
import { createDraftOnlyRunFixture } from './support/run-helpers.js';

interface ClientSession {
  cookie: string;
  csrfToken: string;
}

interface SummaryBody {
  totalRuns: number;
  completedRuns: number;
  passedRuns: number;
  failedRuns: number;
  runningRuns: number;
  cancelledRuns: number;
  interruptedRuns: number;
  errorRuns: number;
  passRatePercent: string | null;
  averageDurationMs: string | null;
}

interface TrendDayBody {
  date: string;
  totalRuns: number;
  completedRuns: number;
  passedRuns: number;
  failedRuns: number;
  runningRuns: number;
  cancelledRuns: number;
  interruptedRuns: number;
  errorRuns: number;
  passRatePercent: string | null;
}

interface TopFailedStepBody {
  planId: string;
  planVersionId: string;
  logicalStepId: string;
  planName: string;
  stepName: string;
  versionNumber: number;
  unit: string;
  completedStepRuns: number;
  failedStepRuns: number;
  failureRatePercent: string | null;
}

interface OverviewBody {
  asOf: string;
  filters: {
    from: string;
    to: string;
    planId: string | null;
    planVersionId: string | null;
    deviceId: string | null;
    batchNumber: string | null;
    scenario: RunScenario | null;
  };
  summary: SummaryBody;
  trend: TrendDayBody[];
  topFailedSteps: TopFailedStepBody[];
}

const MAIN_FROM = '2026-10-10T00:00:00.000Z';
const MAIN_TO = '2026-10-13T00:00:00.000Z';
const ALL_RANGE = { from: MAIN_FROM, to: MAIN_TO };

function completedSteps(
  fixture: AnalyticsRevisionFixture,
  failedIndexes: readonly number[] = [],
): AnalyticsRunStepSeed[] {
  return fixture.steps.map((_, index) => ({
    status: RunStepStatus.COMPLETED,
    outcome: failedIndexes.includes(index)
      ? RunOutcome.FAILED
      : RunOutcome.PASSED,
  }));
}

function step(
  status: RunStepStatus,
  outcome: RunOutcome | null = null,
): AnalyticsRunStepSeed {
  return { status, outcome };
}

describe('analytics overview API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let plannerUser: TestUser;
  let operatorUser: TestUser;
  let viewerUser: TestUser;
  let profile: AnalyticsProfileFixture;
  let deviceA: AnalyticsDeviceSnapshotInput;
  let deviceB: AnalyticsDeviceSnapshotInput;
  let planAV1: AnalyticsRevisionFixture;
  let planAV2: AnalyticsRevisionFixture;
  let planB: AnalyticsRevisionFixture;
  let planRounding: AnalyticsRevisionFixture;
  let planTie: AnalyticsRevisionFixture;
  let draftOnlyRevisionId: string;
  let planner: ClientSession;
  let operator: ClientSession;
  let viewer: ClientSession;

  const server = () => app.getHttpServer();

  beforeAll(async () => {
    app = await createAnalyticsTestApplication();
    prisma = app.get(PrismaService);

    await deleteAnalyticsTestData(prisma);

    plannerUser = await createAnalyticsTestUser(prisma, Role.PLANNER);
    operatorUser = await createAnalyticsTestUser(prisma, Role.OPERATOR);
    viewerUser = await createAnalyticsTestUser(prisma, Role.VIEWER);
    profile = await createAnalyticsTestProfile(prisma);
    deviceA = await createAnalyticsTestDevice(prisma, {
      deviceProfileId: profile.id,
      createdById: plannerUser.id,
      name: 'Analytics Bench A',
    });
    deviceB = await createAnalyticsTestDevice(prisma, {
      deviceProfileId: profile.id,
      createdById: plannerUser.id,
      name: 'Analytics Bench B',
    });
    for (const [index, name] of [
      'EX08BS\\Alpha',
      'EX08BSXAlpha',
      'EX08PCT%Alpha',
      'EX08PCTXAlpha',
      'EX08UND_Alpha',
      'EX08UNDXAlpha',
    ].entries()) {
      await createAnalyticsTestDevice(prisma, {
        deviceProfileId: profile.id,
        createdById: plannerUser.id,
        name,
        serialNumber: `EX08-SPECIAL-${index + 1}`,
      });
    }

    const planA = await createAnalyticsPlan(prisma, plannerUser.id, profile.id);
    planAV1 = await publishAnalyticsRevision(prisma, {
      planId: planA.id,
      plannerId: plannerUser.id,
      profile,
      planName: 'Analytics Plan A',
      versionNumber: 1,
      steps: [
        {
          name: 'Output Voltage',
          unit: 'V',
          minimum: '4.750000',
          maximum: '5.250000',
          sampleCount: 2,
          intervalMs: 200,
        },
        {
          name: 'Current Draw',
          unit: 'A',
          minimum: '0.450000',
          maximum: '0.550000',
          sampleCount: 3,
          intervalMs: 250,
        },
      ],
    });
    planAV2 = await publishAnalyticsRevision(prisma, {
      planId: planA.id,
      plannerId: plannerUser.id,
      profile,
      planName: 'Analytics Plan A version 2',
      versionNumber: 2,
      steps: [
        {
          logicalStepId: planAV1.steps[0]!.logicalStepId,
          name: 'Output Voltage',
          unit: 'V',
          minimum: '4.750000',
          maximum: '5.250000',
          sampleCount: 2,
          intervalMs: 200,
        },
        {
          logicalStepId: planAV1.steps[1]!.logicalStepId,
          name: 'Current Draw',
          unit: 'A',
          minimum: '0.450000',
          maximum: '0.550000',
          sampleCount: 3,
          intervalMs: 250,
        },
      ],
    });

    const planBPlan = await createAnalyticsPlan(
      prisma,
      plannerUser.id,
      profile.id,
    );
    planB = await publishAnalyticsRevision(prisma, {
      planId: planBPlan.id,
      plannerId: plannerUser.id,
      profile,
      planName: 'Analytics Plan B',
      versionNumber: 1,
      steps: [
        {
          name: 'Output Voltage',
          unit: 'mV',
          minimum: '4750.000000',
          maximum: '5250.000000',
          sampleCount: 1,
          intervalMs: 200,
        },
        {
          name: 'Case Temperature',
          unit: '°C',
          minimum: '20.000000',
          maximum: '60.000000',
          sampleCount: 1,
          intervalMs: 500,
        },
        {
          name: 'Input Current',
          unit: 'A',
          minimum: '0.100000',
          maximum: '0.200000',
          sampleCount: 1,
          intervalMs: 500,
        },
      ],
    });

    const roundingPlan = await createAnalyticsPlan(
      prisma,
      plannerUser.id,
      profile.id,
    );
    planRounding = await publishAnalyticsRevision(prisma, {
      planId: roundingPlan.id,
      plannerId: plannerUser.id,
      profile,
      planName: 'Analytics Rounding Plan',
      versionNumber: 1,
      steps: [
        {
          name: 'Rounding Output',
          unit: 'V',
          minimum: '4.750000',
          maximum: '5.250000',
          sampleCount: 1,
          intervalMs: 200,
        },
      ],
    });

    const tiePlan = await createAnalyticsPlan(
      prisma,
      plannerUser.id,
      profile.id,
    );
    planTie = await publishAnalyticsRevision(prisma, {
      planId: tiePlan.id,
      plannerId: plannerUser.id,
      profile,
      planName: 'Analytics Tie Plan',
      versionNumber: 1,
      steps: Array.from({ length: 12 }, (_, index) => ({
        name: `Tie Step ${String(index + 1).padStart(2, '0')}`,
        unit: 'V',
        minimum: '0.000000',
        maximum: '1.000000',
        sampleCount: 1,
        intervalMs: 100,
      })),
    });

    draftOnlyRevisionId = (
      await createDraftOnlyRunFixture(
        prisma,
        plannerUser.id,
        profile.id,
        'Analytics draft-only plan',
      )
    ).revisionId;

    planner = await login(plannerUser);
    operator = await login(operatorUser);
    viewer = await login(viewerUser);
  });

  beforeEach(async () => {
    await deleteAnalyticsRuns(prisma);
  });

  afterAll(async () => {
    if (prisma) {
      await deleteAnalyticsTestData(prisma);
    }
    if (app) {
      await app.close();
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

  function overview(
    query: Record<string, string | undefined>,
    session: ClientSession = viewer,
  ) {
    return request(server())
      .get('/api/analytics/overview')
      .query(query)
      .set('Cookie', session.cookie);
  }

  it('requires a session and allows every role to read', async () => {
    await request(server())
      .get('/api/analytics/overview')
      .query(ALL_RANGE)
      .expect(401);

    for (const session of [planner, operator, viewer]) {
      const response = await overview(ALL_RANGE, session).expect(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body.summary.totalRuns).toBe(0);
      expect(response.body.summary.passRatePercent).toBeNull();
      expect(response.body.summary.averageDurationMs).toBeNull();
    }
  });

  it('treats device prefix wildcards and backslashes literally', async () => {
    const cases = [
      { q: 'EX08BS\\', expected: ['EX08BS\\Alpha'] },
      { q: 'EX08PCT%', expected: ['EX08PCT%Alpha'] },
      { q: 'EX08UND_', expected: ['EX08UND_Alpha'] },
      { q: 'EX08BSX', expected: ['EX08BSXAlpha'] },
    ];

    for (const search of cases) {
      const response = await request(server())
        .get('/api/devices')
        .query({ q: search.q, state: 'active', limit: 100 })
        .set('Cookie', viewer.cookie)
        .expect(200);
      const actual = (response.body.items as Array<{ name: string }>)
        .map((item) => item.name)
        .sort();
      expect(actual).toEqual([...search.expected].sort());
    }
  });

  it('rejects invalid and unsupported query parameters', async () => {
    const missingFrom = await request(server())
      .get('/api/analytics/overview')
      .query({ to: MAIN_TO })
      .set('Cookie', viewer.cookie)
      .expect(400);
    expect(missingFrom.body.code).toBe('VALIDATION_ERROR');
    expect(missingFrom.body.fieldErrors).toContainEqual(
      expect.objectContaining({ path: 'from', code: 'REQUIRED' }),
    );

    const missingTo = await request(server())
      .get('/api/analytics/overview')
      .query({ from: MAIN_FROM })
      .set('Cookie', viewer.cookie)
      .expect(400);
    expect(missingTo.body.fieldErrors).toContainEqual(
      expect.objectContaining({ path: 'to', code: 'REQUIRED' }),
    );

    const malformed = await overview({
      from: 'not-a-date',
      to: MAIN_TO,
    }).expect(400);
    expect(malformed.body.fieldErrors).toContainEqual(
      expect.objectContaining({ path: 'from' }),
    );

    await overview({
      from: '2026-10-10T00:00:00',
      to: MAIN_TO,
    }).expect(400);

    await overview({ from: MAIN_FROM, to: MAIN_FROM }).expect(400);

    const reversed = await overview({
      from: MAIN_TO,
      to: MAIN_FROM,
    }).expect(400);
    expect(reversed.body.fieldErrors).toContainEqual(
      expect.objectContaining({ path: 'to' }),
    );

    const tooWide = await overview({
      from: '2025-01-01T00:00:00.000Z',
      to: '2026-01-02T00:00:00.001Z',
    }).expect(400);
    expect(tooWide.body.fieldErrors).toContainEqual(
      expect.objectContaining({ path: 'to' }),
    );

    await overview({
      from: '2025-01-01T00:00:00.000Z',
      to: '2026-01-02T00:00:00.000Z',
    }).expect(200);

    const unknown = await overview({
      ...ALL_RANGE,
      status: 'COMPLETED',
    }).expect(400);
    expect(unknown.body.fieldErrors).toContainEqual(
      expect.objectContaining({ path: 'status', code: 'UNKNOWN_FIELD' }),
    );

    await overview({ ...ALL_RANGE, planId: 'not-a-uuid' }).expect(400);
    await overview({ ...ALL_RANGE, scenario: 'UNKNOWN' }).expect(400);
    await overview({ ...ALL_RANGE, batchNumber: 'bad value!' }).expect(400);

    const mismatch = await overview({
      ...ALL_RANGE,
      planId: planAV1.planId,
      planVersionId: planB.revisionId,
    }).expect(400);
    expect(mismatch.body.fieldErrors).toContainEqual(
      expect.objectContaining({ path: 'planVersionId' }),
    );

    // A draft revision is not a published version filter. It must behave like
    // an unknown id instead of confirming that another plan's draft exists.
    const draftFilter = await overview({
      ...ALL_RANGE,
      planId: planAV1.planId,
      planVersionId: draftOnlyRevisionId,
    }).expect(200);
    expect((draftFilter.body as OverviewBody).summary.totalRuns).toBe(0);
  });

  it('aggregates all statuses, UTC trend and top steps from the same fixture', async () => {
    await seedAnalyticsRun(prisma, {
      fixture: planAV1,
      requestedById: operatorUser.id,
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.PASSED,
      startedAt: '2026-10-10T00:00:00.000Z',
      finishedAt: '2026-10-10T00:00:01.000Z',
      device: deviceA,
      batchNumber: 'Batch-A',
      stepStatuses: completedSteps(planAV1),
    });
    await seedAnalyticsRun(prisma, {
      fixture: planAV1,
      requestedById: operatorUser.id,
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.FAILED,
      startedAt: '2026-10-10T12:00:00.000Z',
      finishedAt: '2026-10-10T12:00:02.000Z',
      device: deviceA,
      batchNumber: 'Batch-A',
      stepStatuses: completedSteps(planAV1, [1]),
    });
    await seedAnalyticsRun(prisma, {
      fixture: planAV1,
      requestedById: operatorUser.id,
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.PASSED,
      startedAt: '2026-10-11T06:00:00.000Z',
      finishedAt: '2026-10-11T06:00:03.000Z',
      device: deviceA,
      batchNumber: 'Batch-A',
      stepStatuses: completedSteps(planAV1),
    });
    await seedAnalyticsRun(prisma, {
      fixture: planAV1,
      requestedById: operatorUser.id,
      status: RunStatus.CANCELLED,
      startedAt: '2026-10-11T18:00:00.000Z',
      finishedAt: '2026-10-11T18:00:00.100Z',
      device: deviceA,
      batchNumber: 'Batch-A',
      stepStatuses: [
        step(RunStepStatus.COMPLETED, RunOutcome.PASSED),
        step(RunStepStatus.CANCELLED),
      ],
    });
    await seedAnalyticsRun(prisma, {
      fixture: planAV1,
      requestedById: operatorUser.id,
      status: RunStatus.INTERRUPTED,
      startedAt: '2026-10-12T00:00:00.000Z',
      finishedAt: '2026-10-12T00:00:00.100Z',
      device: deviceA,
      batchNumber: 'Batch-A',
      stepStatuses: [
        step(RunStepStatus.COMPLETED, RunOutcome.PASSED),
        step(RunStepStatus.INTERRUPTED),
      ],
    });
    await seedAnalyticsRun(prisma, {
      fixture: planAV1,
      requestedById: operatorUser.id,
      status: RunStatus.ERROR,
      startedAt: '2026-10-12T06:00:00.000Z',
      finishedAt: '2026-10-12T06:00:00.100Z',
      device: deviceA,
      batchNumber: 'Batch-A',
      stepStatuses: [
        step(RunStepStatus.COMPLETED, RunOutcome.PASSED),
        step(RunStepStatus.ERROR),
      ],
    });
    await seedAnalyticsRun(prisma, {
      fixture: planAV1,
      requestedById: operatorUser.id,
      status: RunStatus.RUNNING,
      startedAt: '2026-10-12T12:00:00.000Z',
      device: deviceA,
      batchNumber: 'Batch-A',
      stepStatuses: [
        step(RunStepStatus.COMPLETED, RunOutcome.PASSED),
        step(RunStepStatus.RUNNING),
      ],
    });
    await seedAnalyticsRun(prisma, {
      fixture: planAV1,
      requestedById: operatorUser.id,
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.PASSED,
      startedAt: '2026-10-12T18:00:00.000Z',
      finishedAt: '2026-10-12T18:00:04.000Z',
      device: deviceA,
      batchNumber: 'Batch-A',
      stepStatuses: completedSteps(planAV1),
    });

    // Every distractor differs by exactly one filter dimension or the
    // exclusive time bound, so the assertion below proves the intersection.
    await seedAnalyticsRun(prisma, {
      fixture: planAV1,
      requestedById: operatorUser.id,
      status: RunStatus.COMPLETED,
      startedAt: '2026-10-10T01:00:00.000Z',
      finishedAt: '2026-10-10T01:00:01.000Z',
      device: deviceA,
      batchNumber: 'Batch-A',
      scenario: RunScenario.FORCED_FAILURE,
      stepStatuses: completedSteps(planAV1),
    });
    await seedAnalyticsRun(prisma, {
      fixture: planAV1,
      requestedById: operatorUser.id,
      status: RunStatus.COMPLETED,
      startedAt: '2026-10-10T02:00:00.000Z',
      finishedAt: '2026-10-10T02:00:01.000Z',
      device: deviceA,
      batchNumber: 'Batch-B',
      stepStatuses: completedSteps(planAV1),
    });
    await seedAnalyticsRun(prisma, {
      fixture: planAV1,
      requestedById: operatorUser.id,
      status: RunStatus.COMPLETED,
      startedAt: '2026-10-10T03:00:00.000Z',
      finishedAt: '2026-10-10T03:00:01.000Z',
      device: deviceB,
      batchNumber: 'Batch-A',
      stepStatuses: completedSteps(planAV1),
    });
    await seedAnalyticsRun(prisma, {
      fixture: planAV2,
      requestedById: operatorUser.id,
      status: RunStatus.COMPLETED,
      startedAt: '2026-10-10T04:00:00.000Z',
      finishedAt: '2026-10-10T04:00:01.000Z',
      device: deviceA,
      batchNumber: 'Batch-A',
      stepStatuses: completedSteps(planAV2),
    });
    await seedAnalyticsRun(prisma, {
      fixture: planAV1,
      requestedById: operatorUser.id,
      status: RunStatus.COMPLETED,
      startedAt: MAIN_TO,
      finishedAt: '2026-10-13T00:00:01.000Z',
      device: deviceA,
      batchNumber: 'Batch-A',
      stepStatuses: completedSteps(planAV1),
    });
    await seedAnalyticsRun(prisma, {
      fixture: planAV1,
      requestedById: operatorUser.id,
      status: RunStatus.COMPLETED,
      startedAt: '2026-10-09T23:59:59.999Z',
      finishedAt: '2026-10-10T00:00:00.999Z',
      device: deviceA,
      batchNumber: 'Batch-A',
      stepStatuses: completedSteps(planAV1),
    });

    const response = await overview({
      from: MAIN_FROM,
      to: MAIN_TO,
      planId: planAV1.planId,
      planVersionId: planAV1.revisionId,
      deviceId: deviceA.id,
      batchNumber: 'batch-a',
      scenario: RunScenario.NORMAL,
    }).expect(200);
    const body = response.body as OverviewBody;

    expect(body.summary).toEqual({
      totalRuns: 8,
      completedRuns: 4,
      passedRuns: 3,
      failedRuns: 1,
      runningRuns: 1,
      cancelledRuns: 1,
      interruptedRuns: 1,
      errorRuns: 1,
      passRatePercent: '75.00',
      averageDurationMs: '2500.000',
    });
    expect(body.summary.completedRuns).toBe(
      body.summary.passedRuns + body.summary.failedRuns,
    );
    expect(body.filters).toEqual({
      from: MAIN_FROM,
      to: MAIN_TO,
      planId: planAV1.planId,
      planVersionId: planAV1.revisionId,
      deviceId: deviceA.id,
      batchNumber: 'BATCH-A',
      scenario: RunScenario.NORMAL,
    });
    expect(Number.isNaN(Date.parse(body.asOf))).toBe(false);
    expect(Math.abs(Date.now() - Date.parse(body.asOf))).toBeLessThan(60_000);

    expect(body.trend.map((day) => day.date)).toEqual([
      '2026-10-10',
      '2026-10-11',
      '2026-10-12',
    ]);
    expect(body.trend.map((day) => day.totalRuns)).toEqual([2, 2, 4]);
    expect(body.trend.map((day) => day.passRatePercent)).toEqual([
      '50.00',
      '100.00',
      '100.00',
    ]);
    expect(body.trend[0]).toMatchObject({
      completedRuns: 2,
      passedRuns: 1,
      failedRuns: 1,
    });
    expect(body.trend[1]).toMatchObject({
      completedRuns: 1,
      passedRuns: 1,
      failedRuns: 0,
      cancelledRuns: 1,
    });
    expect(body.trend[2]).toMatchObject({
      completedRuns: 1,
      passedRuns: 1,
      failedRuns: 0,
      runningRuns: 1,
      interruptedRuns: 1,
      errorRuns: 1,
    });

    const trendTotals = body.trend.reduce(
      (total, day) => ({
        totalRuns: total.totalRuns + day.totalRuns,
        completedRuns: total.completedRuns + day.completedRuns,
        passedRuns: total.passedRuns + day.passedRuns,
        failedRuns: total.failedRuns + day.failedRuns,
        runningRuns: total.runningRuns + day.runningRuns,
        cancelledRuns: total.cancelledRuns + day.cancelledRuns,
        interruptedRuns: total.interruptedRuns + day.interruptedRuns,
        errorRuns: total.errorRuns + day.errorRuns,
      }),
      {
        totalRuns: 0,
        completedRuns: 0,
        passedRuns: 0,
        failedRuns: 0,
        runningRuns: 0,
        cancelledRuns: 0,
        interruptedRuns: 0,
        errorRuns: 0,
      },
    );
    expect(trendTotals).toEqual({
      totalRuns: body.summary.totalRuns,
      completedRuns: body.summary.completedRuns,
      passedRuns: body.summary.passedRuns,
      failedRuns: body.summary.failedRuns,
      runningRuns: body.summary.runningRuns,
      cancelledRuns: body.summary.cancelledRuns,
      interruptedRuns: body.summary.interruptedRuns,
      errorRuns: body.summary.errorRuns,
    });

    expect(body.topFailedSteps).toHaveLength(1);
    expect(body.topFailedSteps[0]).toEqual({
      planId: planAV1.planId,
      planVersionId: planAV1.revisionId,
      logicalStepId: planAV1.steps[1]!.logicalStepId,
      planName: 'Analytics Plan A',
      stepName: 'Current Draw',
      versionNumber: 1,
      unit: 'A',
      completedStepRuns: 4,
      failedStepRuns: 1,
      failureRatePercent: '25.00',
    });

    expect(JSON.stringify(body)).not.toContain('measurements');
  });

  it('fills empty days and returns null rates when no completed run exists', async () => {
    const empty = await overview({
      from: '2025-02-01T00:00:00.000Z',
      to: '2025-02-04T00:00:00.000Z',
    }).expect(200);
    const emptyBody = empty.body as OverviewBody;

    expect(emptyBody.summary).toEqual({
      totalRuns: 0,
      completedRuns: 0,
      passedRuns: 0,
      failedRuns: 0,
      runningRuns: 0,
      cancelledRuns: 0,
      interruptedRuns: 0,
      errorRuns: 0,
      passRatePercent: null,
      averageDurationMs: null,
    });
    expect(emptyBody.trend).toHaveLength(3);
    expect(
      emptyBody.trend.every(
        (day) =>
          day.totalRuns === 0 &&
          day.completedRuns === 0 &&
          day.passRatePercent === null,
      ),
    ).toBe(true);
    expect(emptyBody.topFailedSteps).toEqual([]);

    const unknownFilter = await overview({
      ...ALL_RANGE,
      planId: randomUUID(),
    }).expect(200);
    const unknownBody = unknownFilter.body as OverviewBody;
    expect(unknownBody.summary.totalRuns).toBe(0);
    expect(unknownBody.summary.passRatePercent).toBeNull();
    expect(unknownBody.trend).toHaveLength(3);
    expect(unknownBody.topFailedSteps).toEqual([]);

    await seedAnalyticsRun(prisma, {
      fixture: planRounding,
      requestedById: operatorUser.id,
      status: RunStatus.RUNNING,
      startedAt: '2026-10-11T09:00:00.000Z',
      stepStatuses: [step(RunStepStatus.RUNNING)],
    });

    const running = await overview(ALL_RANGE).expect(200);
    const runningBody = running.body as OverviewBody;
    expect(runningBody.summary).toEqual({
      totalRuns: 1,
      completedRuns: 0,
      passedRuns: 0,
      failedRuns: 0,
      runningRuns: 1,
      cancelledRuns: 0,
      interruptedRuns: 0,
      errorRuns: 0,
      passRatePercent: null,
      averageDurationMs: null,
    });
    expect(runningBody.trend).toEqual([
      expect.objectContaining({
        date: '2026-10-10',
        totalRuns: 0,
        passRatePercent: null,
      }),
      expect.objectContaining({
        date: '2026-10-11',
        totalRuns: 1,
        runningRuns: 1,
        completedRuns: 0,
        passRatePercent: null,
      }),
      expect.objectContaining({
        date: '2026-10-12',
        totalRuns: 0,
        passRatePercent: null,
      }),
    ]);
    expect(runningBody.topFailedSteps).toEqual([]);
  });

  it('computes 0%, 100% and half-up decimal strings with PostgreSQL numeric', async () => {
    for (let index = 0; index < 32; index += 1) {
      const startedAt = new Date(
        Date.parse('2026-03-01T00:00:00.000Z') + index * 60_000,
      );
      const durationMs = index >= 30 ? 1001 : 1000;
      const outcome = index === 0 ? RunOutcome.FAILED : RunOutcome.PASSED;
      await seedAnalyticsRun(prisma, {
        fixture: planRounding,
        requestedById: operatorUser.id,
        status: RunStatus.COMPLETED,
        outcome,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date(startedAt.getTime() + durationMs).toISOString(),
        batchNumber: 'ROUND',
        stepStatuses: [step(RunStepStatus.COMPLETED, outcome)],
      });
    }
    for (let index = 0; index < 2; index += 1) {
      const startedAt = new Date(
        Date.parse('2026-03-01T02:00:00.000Z') + index * 60_000,
      );
      await seedAnalyticsRun(prisma, {
        fixture: planRounding,
        requestedById: operatorUser.id,
        status: RunStatus.COMPLETED,
        outcome: RunOutcome.FAILED,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date(startedAt.getTime() + 50).toISOString(),
        batchNumber: 'ZERO',
        stepStatuses: [step(RunStepStatus.COMPLETED, RunOutcome.FAILED)],
      });
    }
    for (let index = 0; index < 3; index += 1) {
      const startedAt = new Date(
        Date.parse('2026-03-01T03:00:00.000Z') + index * 60_000,
      );
      await seedAnalyticsRun(prisma, {
        fixture: planRounding,
        requestedById: operatorUser.id,
        status: RunStatus.COMPLETED,
        outcome: RunOutcome.PASSED,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date(startedAt.getTime() + 150).toISOString(),
        batchNumber: 'FULL',
        stepStatuses: [step(RunStepStatus.COMPLETED, RunOutcome.PASSED)],
      });
    }

    const rounding = await overview({
      from: '2026-03-01T00:00:00.000Z',
      to: '2026-03-02T00:00:00.000Z',
      planId: planRounding.planId,
      batchNumber: 'round',
    }).expect(200);
    const roundingBody = rounding.body as OverviewBody;
    expect(roundingBody.summary).toMatchObject({
      totalRuns: 32,
      completedRuns: 32,
      passedRuns: 31,
      failedRuns: 1,
      passRatePercent: '96.88',
      averageDurationMs: '1000.063',
    });
    expect(roundingBody.topFailedSteps).toEqual([
      expect.objectContaining({
        logicalStepId: planRounding.steps[0]!.logicalStepId,
        completedStepRuns: 32,
        failedStepRuns: 1,
        failureRatePercent: '3.13',
      }),
    ]);

    const zero = await overview({
      from: '2026-03-01T00:00:00.000Z',
      to: '2026-03-02T00:00:00.000Z',
      planId: planRounding.planId,
      batchNumber: 'zero',
    }).expect(200);
    const zeroBody = zero.body as OverviewBody;
    expect(zeroBody.summary).toMatchObject({
      completedRuns: 2,
      passedRuns: 0,
      failedRuns: 2,
      passRatePercent: '0.00',
      averageDurationMs: '50.000',
    });
    expect(zeroBody.topFailedSteps[0]?.failureRatePercent).toBe('100.00');

    const full = await overview({
      from: '2026-03-01T00:00:00.000Z',
      to: '2026-03-02T00:00:00.000Z',
      planId: planRounding.planId,
      batchNumber: 'full',
    }).expect(200);
    const fullBody = full.body as OverviewBody;
    expect(fullBody.summary).toMatchObject({
      completedRuns: 3,
      passedRuns: 3,
      failedRuns: 0,
      passRatePercent: '100.00',
      averageDurationMs: '150.000',
    });
    expect(fullBody.topFailedSteps).toEqual([]);
  });

  it('uses UTC [from,to) bounds and keeps partial first and last days', async () => {
    const from = '2026-10-20T06:00:00.000Z';
    const to = '2026-10-22T18:00:00.000Z';

    await seedAnalyticsRun(prisma, {
      fixture: planAV1,
      requestedById: operatorUser.id,
      status: RunStatus.COMPLETED,
      startedAt: from,
      finishedAt: '2026-10-20T06:00:01.000Z',
      device: deviceA,
      batchNumber: 'BOUNDARY',
      stepStatuses: completedSteps(planAV1),
    });
    await seedAnalyticsRun(prisma, {
      fixture: planAV1,
      requestedById: operatorUser.id,
      status: RunStatus.COMPLETED,
      startedAt: '2026-10-22T17:59:59.999Z',
      finishedAt: '2026-10-22T18:00:00.999Z',
      device: deviceA,
      batchNumber: 'BOUNDARY',
      stepStatuses: completedSteps(planAV1),
    });
    await seedAnalyticsRun(prisma, {
      fixture: planAV1,
      requestedById: operatorUser.id,
      status: RunStatus.COMPLETED,
      startedAt: to,
      finishedAt: '2026-10-22T18:00:01.000Z',
      device: deviceA,
      batchNumber: 'BOUNDARY',
      stepStatuses: completedSteps(planAV1),
    });
    await seedAnalyticsRun(prisma, {
      fixture: planAV1,
      requestedById: operatorUser.id,
      status: RunStatus.COMPLETED,
      startedAt: '2026-10-20T05:59:59.999Z',
      finishedAt: '2026-10-20T06:00:00.999Z',
      device: deviceA,
      batchNumber: 'BOUNDARY',
      stepStatuses: completedSteps(planAV1),
    });

    const response = await overview({
      from,
      to,
      planId: planAV1.planId,
      batchNumber: 'boundary',
    }).expect(200);
    const body = response.body as OverviewBody;

    expect(body.summary.totalRuns).toBe(2);
    expect(body.summary.completedRuns).toBe(2);
    expect(body.trend).toEqual([
      expect.objectContaining({
        date: '2026-10-20',
        totalRuns: 1,
        completedRuns: 1,
        passRatePercent: '100.00',
      }),
      expect.objectContaining({
        date: '2026-10-21',
        totalRuns: 0,
        completedRuns: 0,
        passRatePercent: null,
      }),
      expect.objectContaining({
        date: '2026-10-22',
        totalRuns: 1,
        completedRuns: 1,
        passRatePercent: '100.00',
      }),
    ]);
    expect(body.topFailedSteps).toEqual([]);
  });

  it('applies every filter intersection and treats unknown filters as empty', async () => {
    await seedAnalyticsRun(prisma, {
      fixture: planAV1,
      requestedById: operatorUser.id,
      status: RunStatus.COMPLETED,
      startedAt: '2026-10-25T00:00:00.000Z',
      finishedAt: '2026-10-25T00:00:01.000Z',
      device: deviceA,
      batchNumber: 'INTER-A',
      stepStatuses: completedSteps(planAV1),
    });
    await seedAnalyticsRun(prisma, {
      fixture: planAV1,
      requestedById: operatorUser.id,
      status: RunStatus.COMPLETED,
      startedAt: '2026-10-25T01:00:00.000Z',
      finishedAt: '2026-10-25T01:00:01.000Z',
      device: deviceB,
      batchNumber: 'INTER-B',
      scenario: RunScenario.FORCED_FAILURE,
      stepStatuses: completedSteps(planAV1),
    });
    await seedAnalyticsRun(prisma, {
      fixture: planAV2,
      requestedById: operatorUser.id,
      status: RunStatus.COMPLETED,
      startedAt: '2026-10-25T02:00:00.000Z',
      finishedAt: '2026-10-25T02:00:01.000Z',
      device: deviceA,
      batchNumber: 'INTER-A',
      stepStatuses: completedSteps(planAV2),
    });
    await seedAnalyticsRun(prisma, {
      fixture: planAV2,
      requestedById: operatorUser.id,
      status: RunStatus.COMPLETED,
      startedAt: '2026-10-25T03:00:00.000Z',
      finishedAt: '2026-10-25T03:00:01.000Z',
      device: deviceB,
      batchNumber: 'INTER-B',
      scenario: RunScenario.RANDOM,
      stepStatuses: completedSteps(planAV2),
    });

    const range = {
      from: '2026-10-25T00:00:00.000Z',
      to: '2026-10-26T00:00:00.000Z',
    };

    expect((await overview(range).expect(200)).body.summary.totalRuns).toBe(4);
    expect(
      (await overview({ ...range, planId: planAV1.planId }).expect(200)).body
        .summary.totalRuns,
    ).toBe(4);
    expect(
      (
        await overview({
          ...range,
          planId: planAV1.planId,
          planVersionId: planAV1.revisionId,
        }).expect(200)
      ).body.summary.totalRuns,
    ).toBe(2);
    expect(
      (
        await overview({
          ...range,
          planId: planAV1.planId,
          planVersionId: planAV1.revisionId,
          deviceId: deviceA.id,
        }).expect(200)
      ).body.summary.totalRuns,
    ).toBe(1);
    expect(
      (
        await overview({
          ...range,
          planId: planAV1.planId,
          planVersionId: planAV1.revisionId,
          deviceId: deviceA.id,
          batchNumber: 'inter-a',
          scenario: RunScenario.NORMAL,
        }).expect(200)
      ).body.summary.totalRuns,
    ).toBe(1);
    expect(
      (
        await overview({
          ...range,
          planVersionId: planAV2.revisionId,
        }).expect(200)
      ).body.summary.totalRuns,
    ).toBe(2);
    expect(
      (
        await overview({
          ...range,
          planId: planAV1.planId,
          planVersionId: planAV2.revisionId,
          deviceId: deviceB.id,
          batchNumber: 'INTER-B',
          scenario: RunScenario.RANDOM,
        }).expect(200)
      ).body.summary.totalRuns,
    ).toBe(1);

    const unknownVersion = await overview({
      ...range,
      planId: planAV1.planId,
      planVersionId: randomUUID(),
    }).expect(200);
    expect((unknownVersion.body as OverviewBody).summary.totalRuns).toBe(0);

    const unknownDevice = await overview({
      ...range,
      deviceId: randomUUID(),
    }).expect(200);
    expect((unknownDevice.body as OverviewBody).summary.totalRuns).toBe(0);

    const unknownBatch = await overview({
      ...range,
      batchNumber: 'missing-batch',
    }).expect(200);
    expect((unknownBatch.body as OverviewBody).summary.totalRuns).toBe(0);

    const unknownPlan = await overview({
      ...range,
      planId: randomUUID(),
    }).expect(200);
    expect((unknownPlan.body as OverviewBody).summary.totalRuns).toBe(0);
  });

  it('separates versions and units and returns at most ten deterministically ordered failing steps', async () => {
    await seedAnalyticsRun(prisma, {
      fixture: planAV1,
      requestedById: operatorUser.id,
      status: RunStatus.COMPLETED,
      startedAt: '2026-04-01T00:00:00.000Z',
      finishedAt: '2026-04-01T00:00:01.000Z',
      stepStatuses: completedSteps(planAV1, [0]),
    });
    await seedAnalyticsRun(prisma, {
      fixture: planAV1,
      requestedById: operatorUser.id,
      status: RunStatus.COMPLETED,
      startedAt: '2026-04-01T00:01:00.000Z',
      finishedAt: '2026-04-01T00:01:01.000Z',
      stepStatuses: completedSteps(planAV1, [0]),
    });
    await seedAnalyticsRun(prisma, {
      fixture: planAV2,
      requestedById: operatorUser.id,
      status: RunStatus.COMPLETED,
      startedAt: '2026-04-01T00:02:00.000Z',
      finishedAt: '2026-04-01T00:02:01.000Z',
      stepStatuses: completedSteps(planAV2, [0]),
    });
    await seedAnalyticsRun(prisma, {
      fixture: planAV2,
      requestedById: operatorUser.id,
      status: RunStatus.COMPLETED,
      startedAt: '2026-04-01T00:03:00.000Z',
      finishedAt: '2026-04-01T00:03:01.000Z',
      stepStatuses: completedSteps(planAV2, [0]),
    });
    await seedAnalyticsRun(prisma, {
      fixture: planAV2,
      requestedById: operatorUser.id,
      status: RunStatus.COMPLETED,
      startedAt: '2026-04-01T00:04:00.000Z',
      finishedAt: '2026-04-01T00:04:01.000Z',
      stepStatuses: completedSteps(planAV2),
    });

    const versionResponse = await overview({
      from: '2026-04-01T00:00:00.000Z',
      to: '2026-04-02T00:00:00.000Z',
      planId: planAV1.planId,
    }).expect(200);
    const versionTop = (versionResponse.body as OverviewBody).topFailedSteps;

    expect(versionTop).toHaveLength(2);
    expect(versionTop[0]).toMatchObject({
      planVersionId: planAV2.revisionId,
      logicalStepId: planAV1.steps[0]!.logicalStepId,
      versionNumber: 2,
      completedStepRuns: 3,
      failedStepRuns: 2,
      failureRatePercent: '66.67',
    });
    expect(versionTop[1]).toMatchObject({
      planVersionId: planAV1.revisionId,
      logicalStepId: planAV1.steps[0]!.logicalStepId,
      versionNumber: 1,
      completedStepRuns: 2,
      failedStepRuns: 2,
      failureRatePercent: '100.00',
    });

    const planBRuns = [
      [RunOutcome.FAILED, RunOutcome.FAILED, RunOutcome.FAILED],
      [RunOutcome.FAILED, RunOutcome.FAILED, RunOutcome.FAILED],
      [RunOutcome.PASSED, RunOutcome.PASSED, RunOutcome.FAILED],
      [RunOutcome.PASSED, RunOutcome.PASSED, RunOutcome.PASSED],
      [RunOutcome.PASSED, RunOutcome.PASSED, RunOutcome.PASSED],
    ];
    for (const [index, outcomes] of planBRuns.entries()) {
      await seedAnalyticsRun(prisma, {
        fixture: planB,
        requestedById: operatorUser.id,
        status: RunStatus.COMPLETED,
        startedAt: new Date(
          Date.parse('2026-04-02T00:00:00.000Z') + index * 60_000,
        ).toISOString(),
        finishedAt: new Date(
          Date.parse('2026-04-02T00:00:01.000Z') + index * 60_000,
        ).toISOString(),
        stepStatuses: outcomes.map((outcome) => ({
          status: RunStepStatus.COMPLETED,
          outcome,
        })),
      });
    }

    const unitResponse = await overview({
      from: '2026-04-02T00:00:00.000Z',
      to: '2026-04-03T00:00:00.000Z',
      planId: planB.planId,
    }).expect(200);
    const unitTop = (unitResponse.body as OverviewBody).topFailedSteps;

    expect(unitTop).toHaveLength(3);
    expect(unitTop[0]).toMatchObject({
      logicalStepId: planB.steps[2]!.logicalStepId,
      unit: 'A',
      completedStepRuns: 5,
      failedStepRuns: 3,
      failureRatePercent: '60.00',
    });
    expect(
      unitTop
        .slice(1)
        .map((row) => row.unit)
        .sort(),
    ).toEqual(['mV', '°C']);
    expect(unitTop.slice(1).every((row) => row.failedStepRuns === 2)).toBe(
      true,
    );
    expect(new Set(unitTop.map((row) => row.logicalStepId)).size).toBe(3);

    await seedAnalyticsRun(prisma, {
      fixture: planTie,
      requestedById: operatorUser.id,
      status: RunStatus.COMPLETED,
      startedAt: '2026-04-03T00:00:00.000Z',
      finishedAt: '2026-04-03T00:00:01.000Z',
      stepStatuses: planTie.steps.map(() => ({
        status: RunStepStatus.COMPLETED,
        outcome: RunOutcome.FAILED,
      })),
    });

    const tieQuery = {
      from: '2026-04-03T00:00:00.000Z',
      to: '2026-04-04T00:00:00.000Z',
      planId: planTie.planId,
    };
    const tieFirst = await overview(tieQuery).expect(200);
    const tieSecond = await overview(tieQuery).expect(200);
    const tieTop = (tieFirst.body as OverviewBody).topFailedSteps;

    expect(tieTop).toHaveLength(10);
    expect(tieSecond.body.topFailedSteps).toEqual(tieTop);
    expect(
      tieTop.every(
        (row) =>
          row.completedStepRuns === 1 &&
          row.failedStepRuns === 1 &&
          row.failureRatePercent === '100.00',
      ),
    ).toBe(true);
    const expectedIds = [...planTie.steps]
      .map((fixtureStep) => fixtureStep.logicalStepId)
      .sort()
      .slice(0, 10);
    expect(tieTop.map((row) => row.logicalStepId)).toEqual(expectedIds);
  });

  it('does not load measurements or step history and EXPLAIN stays on run aggregates', async () => {
    const run = await seedAnalyticsRun(prisma, {
      fixture: planRounding,
      requestedById: operatorUser.id,
      status: RunStatus.RUNNING,
      startedAt: '2026-10-11T09:00:00.000Z',
      stepStatuses: [step(RunStepStatus.RUNNING)],
    });
    await seedAnalyticsMeasurement(prisma, {
      runId: run.id,
      runStepId: run.stepIds[0]!,
      recordedAt: '2026-10-11T09:00:00.200Z',
    });

    const response = await overview(ALL_RANGE).expect(200);
    const body = response.body as OverviewBody;

    expect(body.summary.totalRuns).toBe(1);
    expect(body.summary.runningRuns).toBe(1);
    expect(body).not.toHaveProperty('steps');
    expect(body).not.toHaveProperty('measurements');
    expect(JSON.stringify(body)).not.toContain('measurements');

    const config = app.get<AppConfig>(APP_CONFIG);
    const client = new Client({ connectionString: config.databaseUrl });
    await client.connect();
    try {
      const filters = resolveAnalyticsFilters({
        from: ALL_RANGE.from,
        to: ALL_RANGE.to,
      } as AnalyticsOverviewQueryDto);
      const where = buildAnalyticsWhere(filters);

      for (const query of [
        buildSummaryQuery(where),
        buildTrendQuery(where),
        buildTopFailedStepsQuery(where),
      ]) {
        const plan = await client.query<{ 'QUERY PLAN': string }>({
          text: `EXPLAIN (COSTS OFF) ${query.text}`,
          values: query.values,
        });
        const text = plan.rows.map((row) => row['QUERY PLAN']).join('\n');
        expect(text).not.toContain('measurements');
      }
    } finally {
      await client.end();
    }
  });
});
