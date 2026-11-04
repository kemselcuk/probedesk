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
  RunOutcome,
  RunScenario,
  RunStatus,
  RunStepStatus,
} from '../src/prisma/generated/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { RunExecutor } from '../src/runs/run-executor.js';
import { RunRecoveryService } from '../src/runs/run-recovery.service.js';
import { RUN_SCHEDULER } from '../src/runs/run-scheduler.js';
import {
  cookieHeader,
  getCookie,
  readSetCookies,
  type TestUser,
} from './support/auth-helpers.js';
import { createTestApplication } from './support/create-test-application.js';
import {
  createRunTestProfile,
  createRunTestUser,
  deleteRunTestData,
} from './support/run-helpers.js';
import { ControlledRunScheduler } from './support/run-schedulers.js';

interface ClientSession {
  cookie: string;
  csrfToken: string;
}

interface DraftStepRequest {
  logicalStepId?: string;
  name: string;
  unit: string;
  minimum: string;
  maximum: string;
  sampleCount: number;
  intervalMs: number;
}

interface PublishedApiStep extends DraftStepRequest {
  logicalStepId: string;
  position: number;
}

interface PublishedApiPlan {
  planId: string;
  revisionId: string;
  planName: string;
  versionNumber: number;
  steps: PublishedApiStep[];
}

interface StatisticsBody {
  minimum: string | null;
  maximum: string | null;
  average: string | null;
  sampleCount: number | null;
}

interface MeasurementBody {
  sampleIndex: number;
  value: string;
  isWithinTolerance: boolean;
  recordedAt: string;
  elapsedMs: number;
}

interface ComparisonStepBody {
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
  status: RunStatus;
  outcome: RunOutcome | null;
  reasonCode: string | null;
  expectedSampleCount: number;
  recordedSampleCount: number;
  steps: ComparisonStepBody[];
}

interface DecimalValueBody {
  left: string | null;
  right: string | null;
  delta: string | null;
}

interface CountValueBody {
  left: number | null;
  right: number | null;
  delta: number | null;
}

interface NumericComparisonBody {
  comparable: boolean;
  reason: 'SAME_UNIT' | 'UNIT_MISMATCH';
  statistics: {
    minimum: DecimalValueBody;
    maximum: DecimalValueBody;
    average: DecimalValueBody;
    sampleCount: CountValueBody;
  } | null;
}

interface RuleChangeBody {
  field: string;
  left: string | number;
  right: string | number;
}

interface ComparisonRunSummaryBody {
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
  requestedBy: { id: string; email: string; role: Role };
  reasonCode: string | null;
  expectedSampleCount: number;
  recordedSampleCount: number;
  outOfToleranceCount: number;
  stepCount: number;
  partial: boolean;
}

interface MatchedStepBody {
  logicalStepId: string;
  changedFields: RuleChangeBody[];
  numericComparison: NumericComparisonBody;
  left: ComparisonStepBody;
  right: ComparisonStepBody;
}

interface ComparisonBody {
  planId: string;
  versionDifference: {
    sameVersion: boolean;
    leftVersionNumber: number;
    rightVersionNumber: number;
  };
  leftRun: ComparisonRunSummaryBody;
  rightRun: ComparisonRunSummaryBody;
  matchedSteps: MatchedStepBody[];
  addedSteps: ComparisonStepBody[];
  removedSteps: ComparisonStepBody[];
}

interface FieldErrorBody {
  path: string;
  code: string;
  message: string;
}

const COMPARISON_KEYS = [
  'addedSteps',
  'leftRun',
  'matchedSteps',
  'planId',
  'removedSteps',
  'rightRun',
  'versionDifference',
] as const;

const RUN_SUMMARY_KEYS = [
  'errorProbability',
  'evaluationVersion',
  'expectedSampleCount',
  'failureStepId',
  'finishedAt',
  'id',
  'outOfToleranceCount',
  'outcome',
  'partial',
  'planId',
  'planName',
  'planVersionId',
  'profile',
  'reasonCode',
  'recordedSampleCount',
  'requestedBy',
  'scenario',
  'seed',
  'simulatorVersion',
  'startedAt',
  'status',
  'stepCount',
  'versionNumber',
] as const;

const MATCHED_STEP_KEYS = [
  'changedFields',
  'left',
  'logicalStepId',
  'numericComparison',
  'right',
] as const;

function runKey(): string {
  return `comparisons-e2e-${randomUUID()}`;
}

function planStep(overrides: Partial<DraftStepRequest> = {}): DraftStepRequest {
  return {
    name: 'Output Voltage',
    unit: 'V',
    minimum: '4.750000',
    maximum: '5.250000',
    sampleCount: 2,
    intervalMs: 100,
    ...overrides,
  };
}

function decimalDelta(left: string | null, right: string | null) {
  if (left === null || right === null) {
    return null;
  }

  return new Prisma.Decimal(right).minus(left).toFixed(6);
}

describe('run comparison API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let executor: RunExecutor;
  const scheduler = new ControlledRunScheduler('auto');

  let plannerUser: TestUser;
  let operatorUser: TestUser;
  let viewerUser: TestUser;
  let planner: ClientSession;
  let operator: ClientSession;
  let viewer: ClientSession;
  let profileId: string;

  let basePlan: PublishedApiPlan;
  let basePassedRunId: string;
  let baseFailedRunId: string;

  let variantV1: PublishedApiPlan;
  let variantV1RunId: string;
  let variantV1SnapshotBefore: RunSnapshotBody;
  let variantV2: PublishedApiPlan;
  let variantV2RunId: string;

  let otherPlan: PublishedApiPlan;
  let otherRunId: string;

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
    profileId = profile.id;
    planner = await login(plannerUser);
    operator = await login(operatorUser);
    viewer = await login(viewerUser);

    basePlan = await createPublishedPlan('Comparison base plan', [
      planStep(),
      planStep({
        name: 'Current Draw',
        unit: 'A',
        minimum: '0.450000',
        maximum: '0.550000',
        sampleCount: 3,
      }),
      planStep({
        name: 'Case Temperature',
        unit: '°C',
        minimum: '20.000000',
        maximum: '60.000000',
        sampleCount: 1,
      }),
    ]);

    basePassedRunId = await runToCompletion(basePlan, {
      scenario: RunScenario.NORMAL,
      seed: 111,
    });
    baseFailedRunId = await runToCompletion(basePlan, {
      scenario: RunScenario.FORCED_FAILURE,
      seed: 111,
      failureStepId: basePlan.steps[0]!.logicalStepId,
    });

    variantV1 = await createPublishedPlan('Variant plan v1', [
      planStep({ name: 'Supply Voltage' }),
      planStep({
        name: 'Current Draw',
        unit: 'A',
        minimum: '0.450000',
        maximum: '0.550000',
        sampleCount: 2,
      }),
      planStep({
        name: 'Legacy Probe',
        unit: 'V',
        minimum: '0.000000',
        maximum: '1.000000',
        sampleCount: 1,
      }),
    ]);

    variantV1RunId = await runToCompletion(variantV1, {
      scenario: RunScenario.NORMAL,
      seed: 222,
    });
    variantV1SnapshotBefore = await getRunSnapshot(variantV1RunId);

    const supply = variantV1.steps[0]!;
    const current = variantV1.steps[1]!;

    // Version 2 renames and reorders the first two identities, changes the
    // current unit and its bounds, changes supply sampling, removes the legacy
    // identity and adds a NEW identity with the same display name.
    variantV2 = await createNextVersion(variantV1, 'Variant plan v2', [
      {
        logicalStepId: current.logicalStepId,
        name: 'Current Draw',
        unit: 'mA',
        minimum: '450.000000',
        maximum: '550.000000',
        sampleCount: 2,
        intervalMs: 100,
      },
      {
        logicalStepId: supply.logicalStepId,
        name: 'Supply Voltage (filtered)',
        unit: 'V',
        minimum: '4.500000',
        maximum: '5.500000',
        sampleCount: 3,
        intervalMs: 150,
      },
      {
        name: 'Legacy Probe',
        unit: 'mV',
        minimum: '0.000000',
        maximum: '500.000000',
        sampleCount: 2,
        intervalMs: 100,
      },
    ]);

    variantV2RunId = await runToCompletion(variantV2, {
      scenario: RunScenario.NORMAL,
      seed: 222,
    });

    otherPlan = await createPublishedPlan('Other comparison plan', [
      planStep({ name: 'Other Rail', sampleCount: 1 }),
    ]);
    otherRunId = await runToCompletion(otherPlan, {
      scenario: RunScenario.NORMAL,
      seed: 333,
    });
  });

  afterEach(async () => {
    scheduler.setMode('auto');
    scheduler.releasePending();
    await waitForExecutorIdle();
  });

  afterAll(async () => {
    try {
      if (prisma) {
        scheduler.setMode('auto');
        scheduler.releasePending();
        await waitForExecutorIdle();
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

  function putAs(session: ClientSession, path: string): request.Test {
    return request(server())
      .put(path)
      .set('Cookie', session.cookie)
      .set('X-XSRF-TOKEN', session.csrfToken);
  }

  async function createPublishedPlan(
    name: string,
    steps: readonly DraftStepRequest[],
  ): Promise<PublishedApiPlan> {
    const created = await postAs(planner, '/api/plans')
      .send({ name, profileId })
      .expect(201);
    const plan = created.body as {
      id: string;
      draft: { id: string; editRevision: number };
    };

    const saved = await putAs(planner, `/api/plans/${plan.id}/draft`)
      .send({
        name,
        expectedRevision: plan.draft.editRevision,
        steps,
      })
      .expect(200);
    const draft = saved.body as { editRevision: number };

    const published = await postAs(
      planner,
      `/api/plans/${plan.id}/draft/publish`,
    )
      .send({ expectedRevision: draft.editRevision })
      .expect(201);

    return toPublishedPlan(plan.id, published.body);
  }

  async function createNextVersion(
    plan: PublishedApiPlan,
    name: string,
    steps: readonly DraftStepRequest[],
  ): Promise<PublishedApiPlan> {
    const created = await postAs(
      planner,
      `/api/plans/${plan.planId}/drafts`,
    )
      .send({})
      .expect(201);
    const draft = created.body as { editRevision: number };

    const saved = await putAs(planner, `/api/plans/${plan.planId}/draft`)
      .send({ name, expectedRevision: draft.editRevision, steps })
      .expect(200);
    const savedDraft = saved.body as { editRevision: number };

    const published = await postAs(
      planner,
      `/api/plans/${plan.planId}/draft/publish`,
    )
      .send({ expectedRevision: savedDraft.editRevision })
      .expect(201);

    return toPublishedPlan(plan.planId, published.body);
  }

  function toPublishedPlan(planId: string, body: unknown): PublishedApiPlan {
    const revision = body as {
      id: string;
      name: string;
      versionNumber: number;
      steps: PublishedApiStep[];
    };

    return {
      planId,
      revisionId: revision.id,
      planName: revision.name,
      versionNumber: revision.versionNumber,
      steps: revision.steps.map((step) => ({
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

  async function startRun(
    plan: PublishedApiPlan,
    body: Record<string, unknown>,
  ): Promise<string> {
    const response = await postAs(operator, '/api/runs')
      .set('Idempotency-Key', runKey())
      .send({ planVersionId: plan.revisionId, ...body })
      .expect(202);

    return (response.body as { runId: string }).runId;
  }

  async function runToCompletion(
    plan: PublishedApiPlan,
    body: Record<string, unknown>,
  ): Promise<string> {
    const runId = await startRun(plan, body);
    const run = await waitForTerminal(runId);
    expect(run.status).toBe(RunStatus.COMPLETED);
    await waitForExecutorIdle();
    return runId;
  }

  async function waitForTerminal(
    runId: string,
  ): Promise<{ status: RunStatus }> {
    let status: RunStatus | null = null;

    await waitFor(async () => {
      const run = await prisma.testRun.findUnique({
        where: { id: runId },
        select: { status: true },
      });
      status = run?.status ?? null;
      return status !== null && status !== RunStatus.RUNNING;
    }, `run ${runId} to become terminal`);

    if (status === null) {
      throw new Error(`Run ${runId} disappeared while waiting for a status.`);
    }

    return { status };
  }

  async function waitForExecutorIdle(): Promise<void> {
    await waitFor(
      () => executor.activeExecutionCount === 0,
      'executor to become idle',
    );
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

  async function getRunSnapshot(runId: string): Promise<RunSnapshotBody> {
    const response = await request(server())
      .get(`/api/runs/${runId}`)
      .set('Cookie', operator.cookie)
      .expect(200);
    return response.body as RunSnapshotBody;
  }

  async function compare(
    leftRunId: string,
    rightRunId: string,
    session: ClientSession = operator,
  ): Promise<ComparisonBody> {
    const response = await request(server())
      .get('/api/comparisons')
      .query({ leftRunId, rightRunId })
      .set('Cookie', session.cookie)
      .expect(200);
    return response.body as ComparisonBody;
  }

  async function cancelRun(runId: string): Promise<void> {
    await postAs(operator, `/api/runs/${runId}/cancel`).expect(200);
    await waitForTerminal(runId);
    await waitForExecutorIdle();
  }

  it('matches the same plan version by logicalStepId and keeps both verdicts', async () => {
    const body = await compare(basePassedRunId, baseFailedRunId);

    expect(Object.keys(body).sort()).toEqual([...COMPARISON_KEYS]);
    expect(Object.keys(body.leftRun).sort()).toEqual([...RUN_SUMMARY_KEYS]);
    expect(body.planId).toBe(basePlan.planId);
    expect(body.versionDifference).toEqual({
      sameVersion: true,
      leftVersionNumber: 1,
      rightVersionNumber: 1,
    });
    expect(body.leftRun).toMatchObject({
      id: basePassedRunId,
      planVersionId: basePlan.revisionId,
      planName: 'Comparison base plan',
      versionNumber: 1,
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.PASSED,
      reasonCode: null,
      expectedSampleCount: 6,
      recordedSampleCount: 6,
      outOfToleranceCount: 0,
      stepCount: 3,
      partial: false,
    });
    expect(body.rightRun).toMatchObject({
      id: baseFailedRunId,
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.FAILED,
      expectedSampleCount: 6,
      recordedSampleCount: 6,
      outOfToleranceCount: 1,
      stepCount: 3,
      partial: false,
    });

    expect(body.matchedSteps).toHaveLength(3);
    expect(body.addedSteps).toEqual([]);
    expect(body.removedSteps).toEqual([]);

    for (const matched of body.matchedSteps) {
      expect(Object.keys(matched).sort()).toEqual([...MATCHED_STEP_KEYS]);
      expect(matched.changedFields).toEqual([]);
      expect(matched.numericComparison).toMatchObject({
        comparable: true,
        reason: 'SAME_UNIT',
      });

      const statistics = matched.numericComparison.statistics;
      expect(statistics).not.toBeNull();
      expect(statistics!.minimum.delta).toBe(
        decimalDelta(statistics!.minimum.left, statistics!.minimum.right),
      );
      expect(statistics!.maximum.delta).toBe(
        decimalDelta(statistics!.maximum.left, statistics!.maximum.right),
      );
      expect(statistics!.average.delta).toBe(
        decimalDelta(statistics!.average.left, statistics!.average.right),
      );
      expect(statistics!.sampleCount.delta).toBe(
        statistics!.sampleCount.right! - statistics!.sampleCount.left!,
      );
    }

    const supply = body.matchedSteps[0]!;
    expect(supply.left.name).toBe('Output Voltage');
    expect(supply.left.outcome).toBe(RunOutcome.PASSED);
    expect(supply.right.outcome).toBe(RunOutcome.FAILED);
    expect(supply.left.measurements).toHaveLength(2);
    expect(supply.right.measurements).toHaveLength(2);
    expect(
      supply.left.measurements.every((sample) => sample.isWithinTolerance),
    ).toBe(true);

    const failingSample = supply.right.measurements.find(
      (sample) => !sample.isWithinTolerance,
    );
    expect(failingSample).toBeDefined();
    expect(
      new Prisma.Decimal(failingSample!.value).gt(supply.right.maximum),
    ).toBe(true);
    expect(supply.right.firstFailureSampleIndex).toBe(
      failingSample!.sampleIndex,
    );
    expect(supply.right.maximum).toBe(supply.left.maximum);
    expect(supply.right.minimum).toBe(supply.left.minimum);

    // The response is byte-stable for the same stored data.
    const again = await compare(basePassedRunId, baseFailedRunId);
    expect(JSON.stringify(again)).toBe(JSON.stringify(body));

    const raw = JSON.stringify(body);
    expect(raw).not.toContain('idempotencyKey');
    expect(raw).not.toContain('requestHash');
    expect(raw).not.toContain('passwordHash');
    expect(raw).not.toContain('tokenHash');
  });

  it('treats uppercase and lowercase UUIDs as the same runs', async () => {
    const canonical = await compare(basePassedRunId, baseFailedRunId);
    const uppercase = await compare(
      basePassedRunId.toUpperCase(),
      baseFailedRunId.toUpperCase(),
    );

    expect(uppercase).toEqual(canonical);
    expect(uppercase.leftRun.id).toBe(basePassedRunId);
    expect(uppercase.rightRun.id).toBe(baseFailedRunId);

    const mixedSameRun = await request(server())
      .get('/api/comparisons')
      .query({
        leftRunId: basePassedRunId.toUpperCase(),
        rightRunId: basePassedRunId,
      })
      .set('Cookie', operator.cookie)
      .expect(400);
    expect(mixedSameRun.body).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('compares versions by identity through rename, reorder, unit and sampling changes', async () => {
    const body = await compare(variantV1RunId, variantV2RunId);

    expect(body.planId).toBe(variantV1.planId);
    expect(body.versionDifference).toEqual({
      sameVersion: false,
      leftVersionNumber: 1,
      rightVersionNumber: 2,
    });
    expect(body.leftRun.planName).toBe('Variant plan v1');
    expect(body.rightRun.planName).toBe('Variant plan v2');
    expect(body.leftRun.versionNumber).toBe(1);
    expect(body.rightRun.versionNumber).toBe(2);

    // Matched order follows the LEFT run's position; the right run reordered
    // the same identities, which must not lose either match.
    expect(body.matchedSteps.map((step) => step.logicalStepId)).toEqual([
      variantV1.steps[0]!.logicalStepId,
      variantV1.steps[1]!.logicalStepId,
    ]);

    const supply = body.matchedSteps[0]!;
    expect(supply.left.name).toBe('Supply Voltage');
    expect(supply.right.name).toBe('Supply Voltage (filtered)');
    expect(supply.changedFields).toEqual([
      { field: 'name', left: 'Supply Voltage', right: 'Supply Voltage (filtered)' },
      { field: 'position', left: 1, right: 2 },
      { field: 'minimum', left: '4.750000', right: '4.500000' },
      { field: 'maximum', left: '5.250000', right: '5.500000' },
      { field: 'sampleCount', left: 2, right: 3 },
      { field: 'intervalMs', left: 100, right: 150 },
    ]);

    // Same unit: side-by-side summaries and right - left deltas are allowed.
    expect(supply.numericComparison.comparable).toBe(true);
    expect(supply.numericComparison.reason).toBe('SAME_UNIT');
    const supplyStatistics = supply.numericComparison.statistics!;
    expect(supplyStatistics.sampleCount).toEqual({
      left: 2,
      right: 3,
      delta: 1,
    });
    expect(supplyStatistics.minimum.delta).toBe(
      decimalDelta(
        supplyStatistics.minimum.left,
        supplyStatistics.minimum.right,
      ),
    );

    // Each series keeps its own elapsedMs and sample indexes. The shorter
    // left series is not padded, interpolated or index-aligned to the right.
    expect(supply.left.measurements.map((sample) => sample.sampleIndex)).toEqual(
      [0, 1],
    );
    expect(
      supply.left.measurements.map((sample) => sample.elapsedMs),
    ).toEqual([100, 200]);
    expect(
      supply.right.measurements.map((sample) => sample.sampleIndex),
    ).toEqual([0, 1, 2]);
    expect(
      supply.right.measurements.map((sample) => sample.elapsedMs),
    ).toEqual([150, 300, 450]);

    const current = body.matchedSteps[1]!;
    expect(current.left.unit).toBe('A');
    expect(current.right.unit).toBe('mA');
    expect(current.changedFields).toEqual([
      { field: 'unit', left: 'A', right: 'mA' },
      { field: 'position', left: 2, right: 1 },
      { field: 'minimum', left: '0.450000', right: '450.000000' },
      { field: 'maximum', left: '0.550000', right: '550.000000' },
    ]);
    expect(current.numericComparison).toEqual({
      comparable: false,
      reason: 'UNIT_MISMATCH',
      statistics: null,
    });
    expect(JSON.stringify(current.numericComparison)).not.toContain('delta');
    expect(current.left.measurements).toHaveLength(2);
    expect(current.right.measurements).toHaveLength(2);

    // Removed and re-added display names are distinct identities. Neither side
    // is fabricated: the removed step has LEFT content only and the added step
    // has RIGHT content only.
    expect(body.removedSteps).toHaveLength(1);
    expect(body.removedSteps[0]!.logicalStepId).toBe(
      variantV1.steps[2]!.logicalStepId,
    );
    expect(body.removedSteps[0]!.name).toBe('Legacy Probe');

    expect(body.addedSteps).toHaveLength(1);
    expect(body.addedSteps[0]!.name).toBe('Legacy Probe');
    expect(body.addedSteps[0]!.logicalStepId).not.toBe(
      variantV1.steps[2]!.logicalStepId,
    );
    expect(body.addedSteps[0]!.unit).toBe('mV');
    expect(body.addedSteps[0]!.measurements).toHaveLength(2);

    // Swapping the argument order mirrors the runs without changing identity
    // matching or the version comparison.
    const swapped = await compare(variantV2RunId, variantV1RunId);
    expect(swapped.leftRun.id).toBe(variantV2RunId);
    expect(swapped.rightRun.id).toBe(variantV1RunId);
    expect(swapped.matchedSteps.map((step) => step.logicalStepId).sort()).toEqual(
      [
        variantV1.steps[0]!.logicalStepId,
        variantV1.steps[1]!.logicalStepId,
      ].sort(),
    );
    expect(swapped.addedSteps[0]!.logicalStepId).toBe(
      variantV1.steps[2]!.logicalStepId,
    );
  });

  it('keeps the old snapshot and rules after a newer version is published', async () => {
    const afterPublish = await getRunSnapshot(variantV1RunId);

    expect(afterPublish).toEqual(variantV1SnapshotBefore);
    expect(afterPublish.planName).toBe('Variant plan v1');
    expect(afterPublish.versionNumber).toBe(1);

    const comparison = await compare(variantV1RunId, variantV2RunId);
    const supply = comparison.matchedSteps[0]!;
    expect(supply.left.name).toBe('Supply Voltage');
    expect(supply.left.minimum).toBe(variantV1SnapshotBefore.steps[0]!.minimum);
    expect(supply.left.maximum).toBe(variantV1SnapshotBefore.steps[0]!.maximum);
    expect(supply.left.sampleCount).toBe(2);
    expect(supply.left.intervalMs).toBe(100);
    expect(supply.left.measurements).toEqual(
      variantV1SnapshotBefore.steps[0]!.measurements,
    );
  });

  it('rejects runs from different plans with 422 COMPARISON_PLAN_MISMATCH', async () => {
    for (const [leftRunId, rightRunId] of [
      [basePassedRunId, otherRunId],
      [otherRunId, basePassedRunId],
    ] as const) {
      const response = await request(server())
        .get('/api/comparisons')
        .query({ leftRunId, rightRunId })
        .set('Cookie', operator.cookie)
        .expect(422);

      expect(response.body).toMatchObject({
        code: 'COMPARISON_PLAN_MISMATCH',
        requestId: expect.any(String),
        details: {
          leftPlanId: expect.any(String),
          rightPlanId: expect.any(String),
        },
      });
      expect(
        (response.body as { details: { leftPlanId: string } }).details
          .leftPlanId,
      ).not.toBe(
        (response.body as { details: { rightPlanId: string } }).details
          .rightPlanId,
      );
    }
  });

  it('rejects a RUNNING run with 409 RUN_NOT_TERMINAL', async () => {
    scheduler.setMode('paused');
    const runningRunId = await startRun(basePlan, {
      scenario: RunScenario.NORMAL,
      seed: 444,
    });

    const response = await request(server())
      .get('/api/comparisons')
      .query({ leftRunId: runningRunId, rightRunId: basePassedRunId })
      .set('Cookie', operator.cookie)
      .expect(409);

    expect(response.body).toMatchObject({
      code: 'RUN_NOT_TERMINAL',
      requestId: expect.any(String),
      details: {
        leftStatus: RunStatus.RUNNING,
        rightStatus: RunStatus.COMPLETED,
      },
    });

    // A RUNNING self-comparison reports the stronger terminal-state error,
    // not the same-id validation error.
    const self = await request(server())
      .get('/api/comparisons')
      .query({ leftRunId: runningRunId, rightRunId: runningRunId })
      .set('Cookie', operator.cookie)
      .expect(409);
    expect(self.body).toMatchObject({ code: 'RUN_NOT_TERMINAL' });

    await cancelRun(runningRunId);
  });

  it('compares a partial CANCELLED run with explicit nulls, never zeros', async () => {
    scheduler.setMode('paused');
    const cancelledRunId = await startRun(basePlan, {
      scenario: RunScenario.NORMAL,
      seed: 555,
    });
    await cancelRun(cancelledRunId);

    const body = await compare(cancelledRunId, basePassedRunId);

    expect(body.versionDifference.sameVersion).toBe(true);
    expect(body.leftRun).toMatchObject({
      id: cancelledRunId,
      status: RunStatus.CANCELLED,
      outcome: null,
      reasonCode: 'USER_CANCELLED',
      expectedSampleCount: 6,
      recordedSampleCount: 0,
      outOfToleranceCount: 0,
      stepCount: 3,
      partial: true,
    });
    expect(body.leftRun.finishedAt).toEqual(expect.any(String));

    expect(body.matchedSteps).toHaveLength(3);
    for (const matched of body.matchedSteps) {
      expect(matched.left.status).toBe(RunStepStatus.NOT_RUN);
      expect(matched.left.outcome).toBeNull();
      expect(matched.left.recordedCount).toBe(0);
      expect(matched.left.statistics).toEqual({
        minimum: null,
        maximum: null,
        average: null,
        sampleCount: null,
      });
      expect(matched.left.measurements).toEqual([]);

      expect(matched.numericComparison.comparable).toBe(true);
      expect(matched.numericComparison.statistics).toEqual({
        minimum: {
          left: null,
          right: expect.any(String),
          delta: null,
        },
        maximum: {
          left: null,
          right: expect.any(String),
          delta: null,
        },
        average: {
          left: null,
          right: expect.any(String),
          delta: null,
        },
        sampleCount: { left: null, right: expect.any(Number), delta: null },
      });
    }
  });

  it('accepts INTERRUPTED and ERROR runs with explicit missing data', async () => {
    const recovery = app.get(RunRecoveryService);

    // INTERRUPTED through the real startup-recovery path.
    scheduler.setMode('paused');
    const interruptedRunId = await startRun(basePlan, {
      scenario: RunScenario.NORMAL,
      seed: 666,
    });
    recovery.markDirty();
    await expect(recovery.ensureCompleted()).resolves.toBe(true);
    const interrupted = await waitForTerminal(interruptedRunId);
    expect(interrupted.status).toBe(RunStatus.INTERRUPTED);
    executor.cancel(interruptedRunId);
    await waitForExecutorIdle();

    // ERROR terminal transition directly, so this read test isolates the
    // comparison endpoint from the executor failure-injection seam.
    scheduler.setMode('paused');
    const erroredRunId = await startRun(basePlan, {
      scenario: RunScenario.NORMAL,
      seed: 777,
    });
    await prisma.testRun.update({
      where: { id: erroredRunId },
      data: {
        status: RunStatus.ERROR,
        outcome: null,
        finishedAt: new Date(),
        reasonCode: 'EXECUTION_FAILED',
      },
    });
    await prisma.runStep.updateMany({
      where: { runId: erroredRunId },
      data: { status: RunStepStatus.NOT_RUN, outcome: null },
    });
    executor.cancel(erroredRunId);
    await waitForExecutorIdle();

    for (const [runId, status, reasonCode] of [
      [interruptedRunId, RunStatus.INTERRUPTED, 'SERVER_RESTART'],
      [erroredRunId, RunStatus.ERROR, 'EXECUTION_FAILED'],
    ] as const) {
      const body = await compare(runId, basePassedRunId);
      expect(body.leftRun).toMatchObject({
        id: runId,
        status,
        outcome: null,
        reasonCode,
        expectedSampleCount: 6,
        recordedSampleCount: 0,
        outOfToleranceCount: 0,
        stepCount: 3,
        partial: true,
      });

      for (const matched of body.matchedSteps) {
        expect(matched.left.statistics).toEqual({
          minimum: null,
          maximum: null,
          average: null,
          sampleCount: null,
        });
        expect(matched.left.measurements).toEqual([]);
        expect(matched.numericComparison.statistics).toMatchObject({
          minimum: { left: null, delta: null },
          maximum: { left: null, delta: null },
          average: { left: null, delta: null },
          sampleCount: { left: null, delta: null },
        });
      }
    }
  });

  it('validates both ids and rejects comparing a run with itself', async () => {
    const missing = await request(server())
      .get('/api/comparisons')
      .set('Cookie', operator.cookie)
      .expect(400);
    expect(missing.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(
      (missing.body as { fieldErrors: FieldErrorBody[] }).fieldErrors
        .map((error) => error.path)
        .sort(),
    ).toEqual(['leftRunId', 'rightRunId']);

    const malformed = await request(server())
      .get('/api/comparisons')
      .query({ leftRunId: 'not-a-uuid', rightRunId: basePassedRunId })
      .set('Cookie', operator.cookie)
      .expect(400);
    expect(malformed.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(
      (malformed.body as { fieldErrors: FieldErrorBody[] }).fieldErrors,
    ).toEqual([
      expect.objectContaining({
        path: 'leftRunId',
        code: 'INVALID_TYPE',
        message: 'leftRunId must be a UUID',
      }),
    ]);

    const unknownParameter = await request(server())
      .get('/api/comparisons')
      .query({
        leftRunId: basePassedRunId,
        rightRunId: baseFailedRunId,
        planId: basePlan.planId,
      })
      .set('Cookie', operator.cookie)
      .expect(400);
    expect(unknownParameter.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      fieldErrors: [
        expect.objectContaining({ path: 'planId', code: 'UNKNOWN_FIELD' }),
      ],
    });

    const duplicated = await request(server())
      .get('/api/comparisons')
      .query(`leftRunId=${basePassedRunId}&leftRunId=${baseFailedRunId}`)
      .set('Cookie', operator.cookie)
      .expect(400);
    expect(duplicated.body).toMatchObject({ code: 'VALIDATION_ERROR' });

    const same = await request(server())
      .get('/api/comparisons')
      .query({ leftRunId: basePassedRunId, rightRunId: basePassedRunId })
      .set('Cookie', operator.cookie)
      .expect(400);
    expect(same.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      fieldErrors: [
        expect.objectContaining({
          path: 'rightRunId',
          code: 'INVALID_VALUE',
          message: 'rightRunId must differ from leftRunId',
        }),
      ],
    });
  });

  it('returns 404 for unknown runs on either side', async () => {
    const unknownRunId = randomUUID();
    const cases = [
      { leftRunId: unknownRunId, rightRunId: basePassedRunId },
      { leftRunId: basePassedRunId, rightRunId: unknownRunId },
      { leftRunId: unknownRunId, rightRunId: randomUUID() },
    ];

    for (const query of cases) {
      const response = await request(server())
        .get('/api/comparisons')
        .query(query)
        .set('Cookie', operator.cookie)
        .expect(404);
      expect(response.body).toMatchObject({
        code: 'NOT_FOUND',
        message: 'The requested resource was not found.',
        requestId: expect.any(String),
      });
    }
  });

  it('serves the comparison to every role and requires a session', async () => {
    const asOperator = await compare(basePassedRunId, baseFailedRunId, operator);
    const asPlanner = await compare(basePassedRunId, baseFailedRunId, planner);
    const asViewer = await compare(basePassedRunId, baseFailedRunId, viewer);

    expect(asPlanner).toEqual(asOperator);
    expect(asViewer).toEqual(asOperator);

    const unauthenticated = await request(server())
      .get('/api/comparisons')
      .query({ leftRunId: basePassedRunId, rightRunId: baseFailedRunId })
      .expect(401);
    expect(unauthenticated.body).toMatchObject({
      code: 'UNAUTHENTICATED',
      requestId: expect.any(String),
    });
  });
});
