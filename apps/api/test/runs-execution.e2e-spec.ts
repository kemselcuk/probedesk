import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
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
import { RUN_SCHEDULER } from '../src/runs/run-scheduler.js';
import { RunExecutor } from '../src/runs/run-executor.js';
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
  deleteRunTestRuns,
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

interface PlanStepRequest {
  name: string;
  unit: string;
  minimum: string;
  maximum: string;
  sampleCount: number;
  intervalMs: number;
}

interface PublishedApiStep extends PlanStepRequest {
  logicalStepId: string;
  position: number;
}

interface PublishedApiPlan {
  planId: string;
  revisionId: string;
  versionNumber: number;
  steps: PublishedApiStep[];
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

const FAIL_MEASUREMENT_TRIGGER = 'runs_execution_e2e_fail_measurement';
const FAIL_MEASUREMENT_FUNCTION = 'runs_execution_e2e_fail_measurement';
const SLOW_STEP_EVENT_TRIGGER = 'runs_execution_e2e_slow_step_event';
const SLOW_STEP_EVENT_FUNCTION = 'runs_execution_e2e_slow_step_event';

/**
 * Controlled scheduler that can fire a shutdown hook on an exact `now()` call.
 * The final run completion reads the clock after taking the row lock, so the
 * third clock read after arming is inside the finalization transaction.
 */
/**
 * Controlled timers with a real monotonic clock, so a database delay inside
 * beginStep is observable in the first measurement's elapsedMs.
 */
class RealMonotonicControlledScheduler extends ControlledRunScheduler {
  private readonly origin = performance.now();

  override monotonicMs(): number {
    return performance.now() - this.origin;
  }
}

class FinalizationHookScheduler extends ControlledRunScheduler {
  private remainingNowCalls: number | null = null;
  private hook: (() => void) | null = null;

  fireOnNowCall(count: number, hook: () => void): void {
    this.remainingNowCalls = count;
    this.hook = hook;
  }

  override now(): Date {
    const value = super.now();

    if (this.remainingNowCalls !== null) {
      this.remainingNowCalls -= 1;
      if (this.remainingNowCalls === 0) {
        const pending = this.hook;
        this.remainingNowCalls = null;
        this.hook = null;
        pending?.();
      }
    }

    return value;
  }
}

function runKey(): string {
  return `runs-execution-e2e-${randomUUID()}`;
}

function planStep(overrides: Partial<PlanStepRequest> = {}): PlanStepRequest {
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

function expectedEventTypes(steps: readonly { sampleCount: number }[]) {
  const types: RunEventType[] = [RunEventType.RUN_STARTED];

  for (const step of steps) {
    types.push(RunEventType.STEP_STARTED);
    for (let index = 0; index < step.sampleCount; index += 1) {
      types.push(RunEventType.MEASUREMENT_RECORDED);
    }
    types.push(RunEventType.STEP_COMPLETED);
  }

  types.push(RunEventType.RUN_COMPLETED);
  return types;
}

function expectedStatistics(values: readonly string[]): {
  minimum: string;
  maximum: string;
  average: string;
  sampleCount: number;
} {
  if (values.length === 0) {
    throw new Error('expectedStatistics requires at least one value');
  }

  const decimals = values.map((value) => new Prisma.Decimal(value));
  const minimum = decimals.reduce((current, value) =>
    value.lt(current) ? value : current,
  );
  const maximum = decimals.reduce((current, value) =>
    value.gt(current) ? value : current,
  );
  const total = decimals.reduce(
    (current, value) => current.plus(value),
    new Prisma.Decimal(0),
  );

  return {
    minimum: minimum.toFixed(6),
    maximum: maximum.toFixed(6),
    average: total.div(decimals.length).toFixed(6),
    sampleCount: values.length,
  };
}

describe('sequential run execution (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let executor: RunExecutor;
  const scheduler = new ControlledRunScheduler('auto');
  let plannerUser: TestUser;
  let operatorUser: TestUser;
  let planner: ClientSession;
  let operator: ClientSession;
  let profileId: string;
  let normalPlan: PublishedApiPlan;
  let forcedPlan: PublishedApiPlan;
  let equalPlan: PublishedApiPlan;

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

    await dropFailureTrigger();
    await dropSlowStepEventTrigger();
    await deleteRunTestData(prisma);

    plannerUser = await createRunTestUser(prisma, Role.PLANNER);
    operatorUser = await createRunTestUser(prisma, Role.OPERATOR);
    profileId = (await createRunTestProfile(prisma)).id;

    planner = await login(plannerUser);
    operator = await login(operatorUser);

    normalPlan = await createPublishedPlan('Execution normal plan', [
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

    forcedPlan = await createPublishedPlan('Execution forced failure plan', [
      planStep({ sampleCount: 3 }),
      planStep({
        name: 'Current Draw',
        unit: 'A',
        minimum: '0.450000',
        maximum: '0.550000',
        sampleCount: 2,
      }),
    ]);

    equalPlan = await createPublishedPlan('Execution equal bounds plan', [
      planStep({
        name: 'Fixed Rail',
        unit: 'V',
        minimum: '1.000000',
        maximum: '1.000000',
        sampleCount: 3,
      }),
      planStep({
        name: 'Follow-up Rail',
        unit: 'V',
        minimum: '1.000000',
        maximum: '1.000000',
        sampleCount: 1,
      }),
    ]);
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
        await dropFailureTrigger();
        await dropSlowStepEventTrigger();
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

  /** The plan/revision fixture is created through the real product API. */
  async function createPublishedPlan(
    name: string,
    steps: readonly PlanStepRequest[],
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
    const revision = published.body as {
      id: string;
      versionNumber: number;
      steps: PublishedApiStep[];
    };

    return {
      planId: plan.id,
      revisionId: revision.id,
      versionNumber: revision.versionNumber,
      steps: revision.steps,
    };
  }

  async function startRun(
    plan: PublishedApiPlan,
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

  async function loadEvents(runId: string) {
    return prisma.runEvent.findMany({
      where: { runId },
      orderBy: { sequence: 'asc' },
    });
  }

  async function loadMeasurements(runId: string) {
    return prisma.measurement.findMany({
      where: { runId },
      orderBy: [{ runStepId: 'asc' }, { sampleIndex: 'asc' }],
    });
  }

  function groupMeasurementsByStep(
    measurements: Awaited<ReturnType<typeof loadMeasurements>>,
  ) {
    const grouped = new Map<string, typeof measurements>();
    for (const measurement of measurements) {
      const group = grouped.get(measurement.runStepId) ?? [];
      group.push(measurement);
      grouped.set(measurement.runStepId, group);
    }
    return grouped;
  }

  function expectGapFree(events: Awaited<ReturnType<typeof loadEvents>>): void {
    expect(events.map((event) => event.sequence)).toEqual(
      events.map((_, index) => index + 1),
    );
    for (const event of events) {
      expect(event.schemaVersion).toBe(1);
    }
  }

  async function dropFailureTrigger(): Promise<void> {
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS "${FAIL_MEASUREMENT_TRIGGER}" ON "measurements"`,
    );
    await prisma.$executeRawUnsafe(
      `DROP FUNCTION IF EXISTS "${FAIL_MEASUREMENT_FUNCTION}"()`,
    );
  }

  async function dropSlowStepEventTrigger(): Promise<void> {
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS "${SLOW_STEP_EVENT_TRIGGER}" ON "run_events"`,
    );
    await prisma.$executeRawUnsafe(
      `DROP FUNCTION IF EXISTS "${SLOW_STEP_EVENT_FUNCTION}"()`,
    );
  }

  it('completes a NORMAL run as PASSED with exact counters, statistics and gap-free events', async () => {
    const started = await startRun(normalPlan, {
      scenario: RunScenario.NORMAL,
    });
    const run = await waitForTerminal(started.runId);

    expect(run).toMatchObject({
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.PASSED,
      reasonCode: null,
      expectedSampleCount: 6,
      recordedSampleCount: 6,
    });
    expect(run.finishedAt).toBeInstanceOf(Date);

    const stored = await prisma.testRun.findUniqueOrThrow({
      where: { id: started.runId },
      include: { steps: { orderBy: { position: 'asc' } } },
    });
    expect(stored.steps).toHaveLength(3);

    for (const [index, step] of stored.steps.entries()) {
      const expected = normalPlan.steps[index]!;
      expect(step).toMatchObject({
        logicalStepId: expected.logicalStepId,
        position: expected.position,
        sampleCount: expected.sampleCount,
        intervalMs: expected.intervalMs,
        status: RunStepStatus.COMPLETED,
        outcome: RunOutcome.PASSED,
        recordedCount: expected.sampleCount,
        outOfToleranceCount: 0,
        firstFailureSampleIndex: null,
      });
      expect(step.startedAt).toBeInstanceOf(Date);
      expect(step.finishedAt).toBeInstanceOf(Date);
      expect(step.statistics).toEqual(
        expect.objectContaining({ sampleCount: expected.sampleCount }),
      );
    }

    for (let index = 1; index < stored.steps.length; index += 1) {
      expect(
        stored.steps[index]!.startedAt!.getTime(),
        'a step must not start before the previous step completes',
      ).toBeGreaterThanOrEqual(stored.steps[index - 1]!.finishedAt!.getTime());
    }

    const measurements = await loadMeasurements(started.runId);
    expect(measurements).toHaveLength(6);
    const byStep = groupMeasurementsByStep(measurements);

    for (const step of stored.steps) {
      const samples = byStep.get(step.id) ?? [];
      expect(samples.map((sample) => sample.sampleIndex)).toEqual(
        Array.from({ length: step.sampleCount }, (_, index) => index),
      );
      expect(samples.map((sample) => sample.elapsedMs)).toEqual(
        Array.from(
          { length: step.sampleCount },
          (_, index) => (index + 1) * step.intervalMs,
        ),
      );
      for (const sample of samples) {
        expect(sample.isWithinTolerance).toBe(true);
      }
      expect(step.statistics).toEqual(
        expectedStatistics(samples.map((sample) => sample.value.toFixed(6))),
      );
    }

    const events = await loadEvents(started.runId);
    expectGapFree(events);
    expect(events.map((event) => event.type)).toEqual(
      expectedEventTypes(normalPlan.steps),
    );
    expect(stored.eventSequence).toBe(events.length);

    const measurementEvents = events.filter(
      (event) => event.type === RunEventType.MEASUREMENT_RECORDED,
    );
    expect(measurementEvents).toHaveLength(6);
    let flatIndex = 0;
    for (const step of stored.steps) {
      const samples = byStep.get(step.id) ?? [];
      for (const sample of samples) {
        expect(measurementEvents[flatIndex]?.payload).toMatchObject({
          stepId: step.id,
          position: step.position,
          sampleIndex: sample.sampleIndex,
          value: sample.value.toFixed(6),
          isWithinTolerance: true,
          recordedCount: sample.sampleIndex + 1,
          outOfToleranceCount: 0,
          firstFailureSampleIndex: null,
          hasOutOfTolerance: false,
          recordedSampleCount: flatIndex + 1,
          expectedSampleCount: 6,
        });
        flatIndex += 1;
      }
    }
    expect(flatIndex).toBe(6);

    const flatEvents = measurementEvents.map((event) => {
      const payload = event.payload as { recordedSampleCount: number };
      return payload.recordedSampleCount;
    });
    expect(flatEvents).toEqual([1, 2, 3, 4, 5, 6]);

    const completed = events.at(-1)!;
    expect(completed.type).toBe(RunEventType.RUN_COMPLETED);
    expect(completed.payload).toMatchObject({
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.PASSED,
      recordedSampleCount: 6,
      expectedSampleCount: 6,
      stepCount: 3,
      passedStepCount: 3,
      failedStepCount: 0,
    });
  });

  it('records exactly one FORCED_FAILURE sample at the documented index and continues later steps', async () => {
    const failureStep = forcedPlan.steps[0]!;
    const started = await startRun(forcedPlan, {
      scenario: RunScenario.FORCED_FAILURE,
      failureStepId: failureStep.logicalStepId,
    });
    const run = await waitForTerminal(started.runId);

    expect(run).toMatchObject({
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.FAILED,
      expectedSampleCount: 5,
      recordedSampleCount: 5,
    });

    const stored = await prisma.testRun.findUniqueOrThrow({
      where: { id: started.runId },
      include: { steps: { orderBy: { position: 'asc' } } },
    });
    const measuredSteps = stored.steps;
    const failureIndex = Math.floor((failureStep.sampleCount - 1) / 2);

    expect(measuredSteps[0]).toMatchObject({
      status: RunStepStatus.COMPLETED,
      outcome: RunOutcome.FAILED,
      recordedCount: failureStep.sampleCount,
      outOfToleranceCount: 1,
      firstFailureSampleIndex: failureIndex,
    });
    expect(measuredSteps[1]).toMatchObject({
      status: RunStepStatus.COMPLETED,
      outcome: RunOutcome.PASSED,
      recordedCount: 2,
      outOfToleranceCount: 0,
      firstFailureSampleIndex: null,
    });

    const measurements = await loadMeasurements(started.runId);
    const byStep = groupMeasurementsByStep(measurements);
    const failedSamples = byStep.get(measuredSteps[0]!.id) ?? [];
    const laterSamples = byStep.get(measuredSteps[1]!.id) ?? [];

    expect(failedSamples.map((sample) => sample.sampleIndex)).toEqual([
      0, 1, 2,
    ]);
    expect(
      failedSamples
        .filter((sample) => !sample.isWithinTolerance)
        .map((sample) => sample.sampleIndex),
    ).toEqual([failureIndex]);
    expect(failedSamples[failureIndex]!.value.toFixed(6)).toBe('5.500000');
    expect(
      failedSamples
        .filter((sample) => sample.sampleIndex > failureIndex)
        .every((sample) => sample.isWithinTolerance),
    ).toBe(true);
    expect(laterSamples).toHaveLength(2);
    expect(laterSamples.every((sample) => sample.isWithinTolerance)).toBe(true);

    const events = await loadEvents(started.runId);
    expectGapFree(events);
    expect(events.map((event) => event.type)).toEqual(
      expectedEventTypes(forcedPlan.steps),
    );
    const failureEvent = events.find(
      (event) =>
        event.type === RunEventType.MEASUREMENT_RECORDED &&
        (event.payload as { sampleIndex: number }).sampleIndex ===
          failureIndex &&
        (event.payload as { position: number }).position === 1,
    );
    expect(failureEvent?.payload).toMatchObject({
      sampleIndex: failureIndex,
      value: '5.500000',
      isWithinTolerance: false,
      outOfToleranceCount: 1,
      firstFailureSampleIndex: failureIndex,
      hasOutOfTolerance: true,
    });
    expect(events.at(-1)?.payload).toMatchObject({
      outcome: RunOutcome.FAILED,
      recordedSampleCount: 5,
      expectedSampleCount: 5,
      passedStepCount: 1,
      failedStepCount: 1,
    });
  });

  it('accepts T01/T02 equal boundaries and rejects one micro-unit outside', async () => {
    const boundaryRun = await startRun(equalPlan, {
      scenario: RunScenario.NORMAL,
    });
    const boundaryTerminal = await waitForTerminal(boundaryRun.runId);
    expect(boundaryTerminal).toMatchObject({
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.PASSED,
    });

    const boundaryMeasurements = await loadMeasurements(boundaryRun.runId);
    expect(boundaryMeasurements).toHaveLength(4);
    expect(
      boundaryMeasurements.every(
        (sample) =>
          sample.isWithinTolerance && sample.value.toFixed(6) === '1.000000',
      ),
    ).toBe(true);

    const outsideRun = await startRun(equalPlan, {
      scenario: RunScenario.FORCED_FAILURE,
      failureStepId: equalPlan.steps[0]!.logicalStepId,
    });
    const outsideTerminal = await waitForTerminal(outsideRun.runId);
    expect(outsideTerminal).toMatchObject({
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.FAILED,
    });

    const outsideSteps = await prisma.runStep.findMany({
      where: { runId: outsideRun.runId },
      orderBy: { position: 'asc' },
    });
    expect(outsideSteps[0]).toMatchObject({
      outcome: RunOutcome.FAILED,
      outOfToleranceCount: 1,
      firstFailureSampleIndex: 1,
    });
    expect(outsideSteps[1]).toMatchObject({
      status: RunStepStatus.COMPLETED,
      outcome: RunOutcome.PASSED,
    });

    const outsideMeasurements = await loadMeasurements(outsideRun.runId);
    const byStep = groupMeasurementsByStep(outsideMeasurements);
    const samples = byStep.get(outsideSteps[0]!.id) ?? [];
    expect(samples.map((sample) => sample.value.toFixed(6))).toEqual([
      '1.000000',
      '1.000001',
      '1.000000',
    ]);
    expect(samples.map((sample) => sample.isWithinTolerance)).toEqual([
      true,
      false,
      true,
    ]);
    expect(byStep.get(outsideSteps[1]!.id)).toHaveLength(1);

    const events = await loadEvents(outsideRun.runId);
    expectGapFree(events);
    const afterFailure = events.find(
      (event) =>
        event.type === RunEventType.MEASUREMENT_RECORDED &&
        (event.payload as { position: number; sampleIndex: number })
          .position === 1 &&
        (event.payload as { sampleIndex: number }).sampleIndex === 2,
    );
    expect(afterFailure?.payload).toMatchObject({
      value: '1.000000',
      isWithinTolerance: true,
      outOfToleranceCount: 1,
      firstFailureSampleIndex: 1,
      hasOutOfTolerance: true,
    });
  });

  it('cannot mark an incomplete step or run COMPLETED', async () => {
    scheduler.setMode('paused');
    const started = await startRun(normalPlan, {
      scenario: RunScenario.NORMAL,
    });
    await waitFor(
      () => executor.activeExecutionCount === 1,
      'the paused executor to claim the run',
    );

    const step = await prisma.runStep.findFirstOrThrow({
      where: { runId: started.runId, position: 1 },
    });

    await expect(
      prisma.runStep.update({
        where: { id: step.id },
        data: {
          status: RunStepStatus.COMPLETED,
          outcome: RunOutcome.PASSED,
          recordedCount: step.sampleCount - 1,
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.testRun.update({
        where: { id: started.runId },
        data: {
          status: RunStatus.COMPLETED,
          outcome: RunOutcome.PASSED,
          recordedSampleCount: 0,
          finishedAt: new Date(),
        },
      }),
    ).rejects.toThrow();

    const unchanged = await prisma.testRun.findUniqueOrThrow({
      where: { id: started.runId },
      include: { steps: { orderBy: { position: 'asc' } } },
    });
    expect(unchanged.status).toBe(RunStatus.RUNNING);
    expect(unchanged.recordedSampleCount).toBe(0);
    expect(
      unchanged.steps.every((item) => item.status === RunStepStatus.PENDING),
    ).toBe(true);

    await prisma.testRun.update({
      where: { id: started.runId },
      data: {
        status: RunStatus.CANCELLED,
        finishedAt: new Date(scheduler.now().getTime() + 1_000),
      },
    });
  });

  it('leaves the run RUNNING when shutdown begins inside finalization', async () => {
    const shutdownScheduler = new FinalizationHookScheduler('paused');
    let shutdownApp = await createTestApplication(
      {},
      {
        overrides: [{ provide: RUN_SCHEDULER, useValue: shutdownScheduler }],
      },
    );

    try {
      const shutdownExecutor = shutdownApp.get(RunExecutor);
      const created = await request(shutdownApp.getHttpServer())
        .post('/api/runs')
        .set('Cookie', operator.cookie)
        .set('X-XSRF-TOKEN', operator.csrfToken)
        .set('Idempotency-Key', runKey())
        .send({
          planVersionId: normalPlan.revisionId,
          scenario: RunScenario.NORMAL,
          seed: 123_456_789,
        })
        .expect(202);
      const runId = (created.body as StartRunResponseBody).runId;

      const release = async (label: string): Promise<void> => {
        await waitFor(() => shutdownScheduler.pendingCount === 1, label);
        shutdownScheduler.releasePending();
      };

      await waitFor(
        () => shutdownExecutor.activeExecutionCount === 1,
        'the shutdown executor to claim the run',
      );
      await release('the start delay');

      await waitFor(async () => {
        const step = await prisma.runStep.findFirst({
          where: { runId, position: 1 },
        });
        return (
          step?.status === RunStepStatus.RUNNING &&
          shutdownScheduler.pendingCount === 1
        );
      }, 'step 1 to start');
      await release('step 1 sample 0');
      await waitFor(async () => {
        const step = await prisma.runStep.findFirst({
          where: { runId, position: 1 },
        });
        return (
          step?.recordedCount === 1 && shutdownScheduler.pendingCount === 1
        );
      }, 'step 1 sample 0 to commit');
      await release('step 1 sample 1');
      await waitFor(async () => {
        const first = await prisma.runStep.findFirst({
          where: { runId, position: 1 },
        });
        const second = await prisma.runStep.findFirst({
          where: { runId, position: 2 },
        });
        return (
          first?.status === RunStepStatus.COMPLETED &&
          second?.status === RunStepStatus.RUNNING &&
          shutdownScheduler.pendingCount === 1
        );
      }, 'step 1 to complete and step 2 to start');

      for (let index = 0; index < 3; index += 1) {
        await release(`step 2 sample ${index}`);
        await waitFor(async () => {
          const step = await prisma.runStep.findFirst({
            where: { runId, position: 2 },
          });
          return (
            step?.recordedCount === index + 1 &&
            (index === 2
              ? step.status === RunStepStatus.COMPLETED &&
                shutdownScheduler.pendingCount === 1
              : shutdownScheduler.pendingCount === 1)
          );
        }, `step 2 sample ${index} to commit`);
      }

      await waitFor(async () => {
        const step = await prisma.runStep.findFirst({
          where: { runId, position: 3 },
        });
        return (
          step?.status === RunStepStatus.RUNNING &&
          shutdownScheduler.pendingCount === 1
        );
      }, 'the final step to start');

      // Every prior clock read is done. The next three reads are the final
      // sample's recordedAt, the final step's finishedAt and completeRun's
      // finishedAt inside the locked completion transaction.
      shutdownScheduler.fireOnNowCall(3, () => {
        shutdownExecutor.beginShutdown();
      });
      shutdownScheduler.releasePending();

      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const stored = await prisma.testRun.findUniqueOrThrow({
        where: { id: runId },
        include: { steps: { orderBy: { position: 'asc' } } },
      });
      expect(stored.status).toBe(RunStatus.RUNNING);
      expect(stored.outcome).toBeNull();
      expect(stored.finishedAt).toBeNull();
      expect(stored.recordedSampleCount).toBe(6);
      expect(stored.steps.map((step) => step.status)).toEqual([
        RunStepStatus.COMPLETED,
        RunStepStatus.COMPLETED,
        RunStepStatus.COMPLETED,
      ]);
      expect(
        await prisma.runEvent.count({
          where: { runId, type: RunEventType.RUN_COMPLETED },
        }),
      ).toBe(0);
      expect(shutdownScheduler.pendingCount).toBe(0);
    } finally {
      shutdownScheduler.dispose();
      if (shutdownApp) {
        await shutdownApp.close();
        shutdownApp = undefined as unknown as INestApplication;
      }
    }
  });

  it('includes the beginStep commit duration in the first sample elapsedMs', async () => {
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION "${SLOW_STEP_EVENT_FUNCTION}"()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        PERFORM pg_sleep(0.15);
        RETURN NEW;
      END;
      $$
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "${SLOW_STEP_EVENT_TRIGGER}"
      BEFORE INSERT ON "run_events"
      FOR EACH ROW
      WHEN (NEW."type" = 'step.started')
      EXECUTE FUNCTION "${SLOW_STEP_EVENT_FUNCTION}"()
    `);

    const slowScheduler = new RealMonotonicControlledScheduler('paused');
    let slowApp = await createTestApplication(
      {},
      {
        overrides: [{ provide: RUN_SCHEDULER, useValue: slowScheduler }],
      },
    );

    try {
      const slowExecutor = slowApp.get(RunExecutor);
      const created = await request(slowApp.getHttpServer())
        .post('/api/runs')
        .set('Cookie', operator.cookie)
        .set('X-XSRF-TOKEN', operator.csrfToken)
        .set('Idempotency-Key', runKey())
        .send({
          planVersionId: normalPlan.revisionId,
          scenario: RunScenario.NORMAL,
          seed: 123_456_789,
        })
        .expect(202);
      const runId = (created.body as StartRunResponseBody).runId;

      await waitFor(
        () => slowExecutor.activeExecutionCount === 1,
        'the slow executor to claim the run',
      );
      await waitFor(() => slowScheduler.pendingCount === 1, 'the start delay');
      slowScheduler.releasePending();
      await waitFor(async () => {
        const step = await prisma.runStep.findFirst({
          where: { runId, position: 1 },
        });
        return (
          step?.status === RunStepStatus.RUNNING &&
          slowScheduler.pendingCount === 1
        );
      }, 'the slow step start to commit');

      slowScheduler.releasePending();
      await waitFor(async () => {
        const measurement = await prisma.measurement.findFirst({
          where: { runId },
          orderBy: { sampleIndex: 'asc' },
        });
        return measurement !== null;
      }, 'the first slow sample to commit');

      const first = await prisma.measurement.findFirstOrThrow({
        where: { runId, sampleIndex: 0 },
      });
      // The step.started event insert slept 150 ms inside beginStep. If the
      // monotonic reference were captured after that commit the value would be
      // near the controlled interval instead.
      expect(first.elapsedMs).toBeGreaterThanOrEqual(120);

      await request(slowApp.getHttpServer())
        .post(`/api/runs/${runId}/cancel`)
        .set('Cookie', operator.cookie)
        .set('X-XSRF-TOKEN', operator.csrfToken)
        .expect(200);
      await waitFor(
        () => slowExecutor.activeExecutionCount === 0,
        'the slow executor to stop after cancel',
      );
    } finally {
      slowScheduler.dispose();
      if (slowApp) {
        await slowApp.close();
        slowApp = undefined as unknown as INestApplication;
      }
      await dropSlowStepEventTrigger();
    }
  });

  it('rejects stale execution writes after a terminal status', async () => {
    scheduler.setMode('paused');
    const started = await startRun(normalPlan, {
      scenario: RunScenario.NORMAL,
    });
    await waitFor(
      () => executor.activeExecutionCount === 1,
      'the paused executor to claim the run',
    );

    await prisma.testRun.update({
      where: { id: started.runId },
      data: {
        status: RunStatus.CANCELLED,
        finishedAt: new Date(scheduler.now().getTime() + 1_000),
      },
    });

    scheduler.releasePending();
    await waitFor(
      () => executor.activeExecutionCount === 0,
      'the stale executor to stop',
    );

    expect(
      await prisma.measurement.count({ where: { runId: started.runId } }),
    ).toBe(0);
    expect(
      await prisma.runEvent.count({ where: { runId: started.runId } }),
    ).toBe(1);
    expect(
      await prisma.runStep.count({
        where: { runId: started.runId, status: RunStepStatus.RUNNING },
      }),
    ).toBe(0);
    expect(
      await prisma.runEvent.count({
        where: {
          runId: started.runId,
          type: RunEventType.MEASUREMENT_RECORDED,
        },
      }),
    ).toBe(0);
  });

  it('rejects duplicate measurement inserts and a stale executor restart after completion', async () => {
    const started = await startRun(normalPlan, {
      scenario: RunScenario.NORMAL,
    });
    const run = await waitForTerminal(started.runId);
    expect(run.outcome).toBe(RunOutcome.PASSED);

    const step = await prisma.runStep.findFirstOrThrow({
      where: { runId: started.runId, position: 1 },
    });
    const existing = await prisma.measurement.findFirstOrThrow({
      where: { runStepId: step.id, sampleIndex: 0 },
    });

    await expect(
      prisma.measurement.create({
        data: {
          runId: started.runId,
          runStepId: step.id,
          sampleIndex: existing.sampleIndex,
          value: existing.value,
          isWithinTolerance: existing.isWithinTolerance,
          recordedAt: new Date(),
          elapsedMs: 0,
        },
      }),
    ).rejects.toThrow();

    const eventCount = await prisma.runEvent.count({
      where: { runId: started.runId },
    });
    const measurementCount = await prisma.measurement.count({
      where: { runId: started.runId },
    });

    executor.start(started.runId);
    await waitFor(
      () => executor.activeExecutionCount === 0,
      'the terminal executor retry to stop',
    );

    expect(
      await prisma.runEvent.count({ where: { runId: started.runId } }),
    ).toBe(eventCount);
    expect(
      await prisma.measurement.count({ where: { runId: started.runId } }),
    ).toBe(measurementCount);

    const terminal = await prisma.testRun.findUniqueOrThrow({
      where: { id: started.runId },
    });
    expect(terminal).toMatchObject({
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.PASSED,
      recordedSampleCount: 6,
    });
  });

  it('rejects new measurements, rule edits and stale step writes after the run is terminal', async () => {
    const started = await startRun(normalPlan, {
      scenario: RunScenario.NORMAL,
    });
    const run = await waitForTerminal(started.runId);
    expect(run.status).toBe(RunStatus.COMPLETED);

    const step = await prisma.runStep.findFirstOrThrow({
      where: { runId: started.runId, position: 1 },
    });

    await expect(
      prisma.measurement.create({
        data: {
          runId: started.runId,
          runStepId: step.id,
          sampleIndex: step.sampleCount,
          value: '4.750000',
          isWithinTolerance: true,
          recordedAt: new Date(),
          elapsedMs: 0,
        },
      }),
    ).rejects.toThrow(/Measurements cannot be added to a terminal run/);

    await expect(
      prisma.runStep.update({
        where: { id: step.id },
        data: { status: RunStepStatus.RUNNING, startedAt: new Date() },
      }),
    ).rejects.toThrow(/A terminal step status is immutable/);

    await expect(
      prisma.runStep.update({
        where: { id: step.id },
        data: { minimum: '0.000000' },
      }),
    ).rejects.toThrow(/Run rule copy fields are immutable/);

    await expect(
      prisma.testRun.update({
        where: { id: started.runId },
        data: { planNameSnapshot: 'Changed after completion' },
      }),
    ).rejects.toThrow(/Run snapshot fields are immutable/);

    expect(
      await prisma.measurement.count({ where: { runId: started.runId } }),
    ).toBe(6);
    expect(
      await prisma.runEvent.count({
        where: { runId: started.runId, type: RunEventType.RUN_COMPLETED },
      }),
    ).toBe(1);
  });

  it('marks an unexpected execution failure ERROR and emits run.errored', async () => {
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION "${FAIL_MEASUREMENT_FUNCTION}"()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'forced measurement failure' USING ERRCODE = '23514';
      END;
      $$
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "${FAIL_MEASUREMENT_TRIGGER}"
      BEFORE INSERT ON "measurements"
      FOR EACH ROW
      EXECUTE FUNCTION "${FAIL_MEASUREMENT_FUNCTION}"()
    `);

    try {
      const started = await startRun(normalPlan, {
        scenario: RunScenario.NORMAL,
      });
      const run = await waitForTerminal(started.runId);

      expect(run).toMatchObject({
        status: RunStatus.ERROR,
        outcome: null,
        reasonCode: 'EXECUTION_FAILED',
        recordedSampleCount: 0,
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

      expect(
        await prisma.measurement.count({ where: { runId: started.runId } }),
      ).toBe(0);

      const events = await loadEvents(started.runId);
      expectGapFree(events);
      expect(events.map((event) => event.type)).toEqual([
        RunEventType.RUN_STARTED,
        RunEventType.STEP_STARTED,
        RunEventType.RUN_ERRORED,
      ]);
      expect(events.at(-1)?.payload).toMatchObject({
        status: RunStatus.ERROR,
        reasonCode: 'EXECUTION_FAILED',
        recordedSampleCount: 0,
        expectedSampleCount: 6,
      });
    } finally {
      await dropFailureTrigger();
    }
  });
});
