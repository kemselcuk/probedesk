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
  createDraftOnlyRunFixture,
  createPublishedRunFixture,
  createRunTestProfile,
  createRunTestUser,
  deleteRunTestData,
  deleteRunTestRuns,
  type PublishedRunFixture,
} from './support/run-helpers.js';

interface ClientSession {
  cookie: string;
  csrfToken: string;
}

interface RunStartResponseBody {
  runId: string;
  status: RunStatus;
  outcome: string | null;
  snapshotUrl: string;
  eventsUrl: string;
}

interface FieldErrorBody {
  path: string;
  code: string;
  message: string;
}

const FAIL_EVENT_TRIGGER = 'runs_e2e_fail_run_event';
const FAIL_EVENT_FUNCTION = 'runs_e2e_fail_run_event';

function runKey(): string {
  return `runs-api-e2e-${randomUUID()}`;
}

describe('runs API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let plannerUser: TestUser;
  let operatorUser: TestUser;
  let otherOperatorUser: TestUser;
  let viewerUser: TestUser;
  let operator: ClientSession;
  let otherOperator: ClientSession;
  let planner: ClientSession;
  let viewer: ClientSession;
  let fixture: PublishedRunFixture;
  let draftOnly: { planId: string; revisionId: string };

  const server = () => app.getHttpServer();
  const testUserIds = () => [
    plannerUser.id,
    operatorUser.id,
    otherOperatorUser.id,
    viewerUser.id,
  ];

  beforeAll(async () => {
    app = await createTestApplication();
    prisma = app.get(PrismaService);

    await dropFailureTrigger();
    await deleteRunTestData(prisma);

    plannerUser = await createRunTestUser(prisma, Role.PLANNER);
    operatorUser = await createRunTestUser(prisma, Role.OPERATOR);
    otherOperatorUser = await createRunTestUser(prisma, Role.OPERATOR);
    viewerUser = await createRunTestUser(prisma, Role.VIEWER);

    const profile = await createRunTestProfile(prisma);
    fixture = await createPublishedRunFixture(prisma, plannerUser.id, profile, {
      planName: 'Run start published plan',
    });
    draftOnly = await createDraftOnlyRunFixture(
      prisma,
      plannerUser.id,
      profile.id,
    );

    planner = await login(plannerUser);
    operator = await login(operatorUser);
    otherOperator = await login(otherOperatorUser);
    viewer = await login(viewerUser);
  });

  afterEach(async () => {
    if (prisma) {
      await deleteRunTestRuns(prisma);
    }
  });

  afterAll(async () => {
    if (prisma) {
      await dropFailureTrigger();
      await deleteRunTestData(prisma);
      await prisma.$disconnect();
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

  function normalBody(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      planVersionId: fixture.revisionId,
      scenario: RunScenario.NORMAL,
      seed: 123_456_789,
      ...overrides,
    };
  }

  function postRun(
    session: ClientSession | null,
    key: string | undefined,
    body: Record<string, unknown>,
    options: { csrf?: boolean } = {},
  ): request.Test {
    let call = request(server()).post('/api/runs');

    if (session) {
      call = call.set('Cookie', session.cookie);
      if (options.csrf !== false) {
        call = call.set('X-XSRF-TOKEN', session.csrfToken);
      }
    }

    if (key !== undefined) {
      call = call.set('Idempotency-Key', key);
    }

    return call.send(body);
  }

  function readFieldErrors(body: unknown): FieldErrorBody[] {
    return (body as { fieldErrors?: FieldErrorBody[] }).fieldErrors ?? [];
  }

  async function expectValidationError(
    body: Record<string, unknown>,
    expectedPaths: readonly string[],
  ): Promise<void> {
    const response = await postRun(operator, runKey(), body).expect(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    const paths = readFieldErrors(response.body).map((issue) => issue.path);
    for (const path of expectedPaths) {
      expect(paths, `expected field error for ${path}`).toContain(path);
    }
  }

  async function dropFailureTrigger(): Promise<void> {
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS "${FAIL_EVENT_TRIGGER}" ON "run_events"`,
    );
    await prisma.$executeRawUnsafe(
      `DROP FUNCTION IF EXISTS "${FAIL_EVENT_FUNCTION}"()`,
    );
  }

  it('creates the run, all rule-copy steps and run.started in one snapshot', async () => {
    const key = runKey();
    const response = await postRun(operator, key, normalBody()).expect(202);
    const created = response.body as RunStartResponseBody;

    expect(created).toEqual({
      runId: expect.any(String),
      status: RunStatus.RUNNING,
      outcome: null,
      snapshotUrl: `/api/runs/${created.runId}`,
      eventsUrl: `/api/runs/${created.runId}/events`,
    });

    const run = await prisma.testRun.findUniqueOrThrow({
      where: { id: created.runId },
      include: {
        steps: { orderBy: { position: 'asc' } },
        events: { orderBy: { sequence: 'asc' } },
      },
    });

    expect(run).toMatchObject({
      planId: fixture.planId,
      planRevisionId: fixture.revisionId,
      planNameSnapshot: fixture.planName,
      versionNumberSnapshot: fixture.versionNumber,
      profileSnapshot: fixture.profile,
      status: RunStatus.RUNNING,
      outcome: null,
      requestedById: operatorUser.id,
      scenario: RunScenario.NORMAL,
      errorProbability: null,
      failureStepId: null,
      simulatorVersion: SIMULATOR_VERSION,
      evaluationVersion: RUN_EVALUATION_VERSION,
      idempotencyKey: key,
      eventSequence: 1,
      expectedSampleCount: 6,
      recordedSampleCount: 0,
      finishedAt: null,
      cancelledById: null,
      reasonCode: null,
    });
    expect(run.seed).toBe(123_456_789n);
    expect(run.requestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(run.startedAt).toBeInstanceOf(Date);

    expect(run.steps).toHaveLength(fixture.steps.length);
    for (const [index, expected] of fixture.steps.entries()) {
      const step = run.steps[index]!;

      expect(step).toMatchObject({
        logicalStepId: expected.logicalStepId,
        position: expected.position,
        name: expected.name,
        unit: expected.unit,
        sampleCount: expected.sampleCount,
        intervalMs: expected.intervalMs,
        status: RunStepStatus.PENDING,
        outcome: null,
        recordedCount: 0,
        outOfToleranceCount: 0,
        firstFailureSampleIndex: null,
        startedAt: null,
        finishedAt: null,
        statistics: null,
      });
      expect(step.minimum.toFixed(6)).toBe(expected.minimum);
      expect(step.maximum.toFixed(6)).toBe(expected.maximum);
    }

    expect(run.events).toHaveLength(1);
    const event = run.events[0]!;
    expect(event.sequence).toBe(1);
    expect(event.type).toBe(RunEventType.RUN_STARTED);
    expect(event.schemaVersion).toBe(1);
    expect(event.occurredAt.getTime()).toBe(run.startedAt.getTime());
    expect(event.payload).toMatchObject({
      status: RunStatus.RUNNING,
      planId: fixture.planId,
      planVersionId: fixture.revisionId,
      planName: fixture.planName,
      versionNumber: fixture.versionNumber,
      scenario: RunScenario.NORMAL,
      expectedSampleCount: 6,
      stepCount: fixture.steps.length,
    });

    const storedEvent = await prisma.$queryRaw<
      Array<{ type: string; schemaVersion: number }>
    >`
      SELECT "type"::text AS "type", "schemaVersion"
      FROM "run_events"
      WHERE "runId" = ${created.runId}::uuid
    `;
    expect(storedEvent).toEqual([{ type: 'run.started', schemaVersion: 1 }]);
  });

  it('stores the canonical RANDOM probability, max seed and no failure step', async () => {
    const response = await postRun(
      operator,
      runKey(),
      normalBody({
        scenario: RunScenario.RANDOM,
        errorProbability: '0.05',
        seed: 4_294_967_295,
      }),
    ).expect(202);

    const run = await prisma.testRun.findUniqueOrThrow({
      where: { id: (response.body as RunStartResponseBody).runId },
    });
    expect(run.scenario).toBe(RunScenario.RANDOM);
    expect(run.seed).toBe(4_294_967_295n);
    expect(run.errorProbability?.toFixed(6)).toBe('0.050000');
    expect(run.failureStepId).toBeNull();
  });

  it('rejects drafts and unknown versions with the same 404 and no write', async () => {
    const draftResponse = await postRun(
      operator,
      runKey(),
      normalBody({ planVersionId: draftOnly.revisionId }),
    ).expect(404);
    expect(draftResponse.body).toMatchObject({ code: 'NOT_FOUND' });

    const unknownResponse = await postRun(
      operator,
      runKey(),
      normalBody({ planVersionId: randomUUID() }),
    ).expect(404);
    expect(unknownResponse.body).toMatchObject({ code: 'NOT_FOUND' });

    expect(
      await prisma.testRun.count({
        where: { requestedById: operatorUser.id },
      }),
    ).toBe(0);
  });

  it('rejects scenario-mismatched settings with field paths', async () => {
    const failureStepId = fixture.steps[0]!.logicalStepId;

    await expectValidationError(
      normalBody({ scenario: RunScenario.NORMAL, failureStepId }),
      ['failureStepId'],
    );
    await expectValidationError(
      normalBody({
        scenario: RunScenario.NORMAL,
        errorProbability: '0.050000',
      }),
      ['errorProbability'],
    );
    await expectValidationError(
      normalBody({
        scenario: RunScenario.FORCED_FAILURE,
        failureStepId,
        errorProbability: '0.050000',
      }),
      ['errorProbability'],
    );
    await expectValidationError(
      normalBody({ scenario: RunScenario.FORCED_FAILURE }),
      ['failureStepId'],
    );
    await expectValidationError(
      normalBody({
        scenario: RunScenario.FORCED_FAILURE,
        failureStepId: randomUUID(),
      }),
      ['failureStepId'],
    );
    await expectValidationError(
      normalBody({
        scenario: RunScenario.RANDOM,
        failureStepId,
      }),
      ['failureStepId'],
    );
    await expectValidationError(normalBody({ scenario: RunScenario.RANDOM }), [
      'errorProbability',
    ]);
    await expectValidationError(
      normalBody({
        scenario: RunScenario.RANDOM,
        errorProbability: '1.000001',
      }),
      ['errorProbability'],
    );

    expect(
      await prisma.testRun.count({
        where: { requestedById: operatorUser.id },
      }),
    ).toBe(0);
  });

  it('rejects client-supplied status, outcome and other unknown fields', async () => {
    const response = await postRun(operator, runKey(), {
      ...normalBody(),
      status: RunStatus.COMPLETED,
      outcome: 'PASSED',
      expectedSampleCount: 1,
    }).expect(400);

    expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    const errors = readFieldErrors(response.body);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'status', code: 'UNKNOWN_FIELD' }),
        expect.objectContaining({ path: 'outcome', code: 'UNKNOWN_FIELD' }),
        expect.objectContaining({
          path: 'expectedSampleCount',
          code: 'UNKNOWN_FIELD',
        }),
      ]),
    );
  });

  it('rejects a bad seed, probability, id or failure step', async () => {
    await expectValidationError(normalBody({ seed: -1 }), ['seed']);
    await expectValidationError(normalBody({ seed: 4_294_967_296 }), ['seed']);
    await expectValidationError(normalBody({ seed: 1.5 }), ['seed']);
    await expectValidationError(normalBody({ seed: '42' }), ['seed']);
    await expectValidationError(normalBody({ planVersionId: 'not-a-uuid' }), [
      'planVersionId',
    ]);
    await expectValidationError(
      normalBody({
        scenario: RunScenario.FORCED_FAILURE,
        failureStepId: 'not-a-uuid',
      }),
      ['failureStepId'],
    );

    for (const errorProbability of [
      '1e-2',
      '0,05',
      '0.1234567',
      ' 0.05',
      0.05,
    ]) {
      await expectValidationError(
        normalBody({ scenario: RunScenario.RANDOM, errorProbability }),
        ['errorProbability'],
      );
    }

    expect(
      await prisma.testRun.count({
        where: { requestedById: operatorUser.id },
      }),
    ).toBe(0);
  });

  it('requires an Operator session, CSRF and a bounded idempotency key', async () => {
    const unauthenticated = await postRun(null, runKey(), normalBody()).expect(
      401,
    );
    expect(unauthenticated.body).toMatchObject({ code: 'UNAUTHENTICATED' });

    for (const session of [planner, viewer]) {
      const forbidden = await postRun(session, runKey(), normalBody()).expect(
        403,
      );
      expect(forbidden.body).toMatchObject({ code: 'FORBIDDEN' });
    }

    const missingCsrf = await postRun(operator, runKey(), normalBody(), {
      csrf: false,
    }).expect(403);
    expect(missingCsrf.body).toMatchObject({ code: 'FORBIDDEN' });

    const wrongCsrf = await request(server())
      .post('/api/runs')
      .set('Cookie', operator.cookie)
      .set('X-XSRF-TOKEN', 'not-the-token')
      .set('Idempotency-Key', runKey())
      .send(normalBody())
      .expect(403);
    expect(wrongCsrf.body).toMatchObject({ code: 'FORBIDDEN' });

    const missingKey = await postRun(operator, undefined, normalBody()).expect(
      400,
    );
    expect(readFieldErrors(missingKey.body)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'Idempotency-Key', code: 'REQUIRED' }),
      ]),
    );

    const blankKey = await postRun(operator, '   ', normalBody()).expect(400);
    expect(readFieldErrors(blankKey.body)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'Idempotency-Key', code: 'REQUIRED' }),
      ]),
    );

    const longKey = await postRun(
      operator,
      'k'.repeat(201),
      normalBody(),
    ).expect(400);
    expect(readFieldErrors(longKey.body)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'Idempotency-Key',
          code: 'INVALID_VALUE',
        }),
      ]),
    );

    expect(
      await prisma.testRun.count({
        where: { requestedById: operatorUser.id },
      }),
    ).toBe(0);
  });

  it('replays the same key and request, including after the run is terminal', async () => {
    const key = runKey();
    const body = normalBody();

    const first = await postRun(operator, key, body).expect(202);
    const runId = (first.body as RunStartResponseBody).runId;

    const replay = await postRun(operator, key, body).expect(200);
    expect(replay.body).toEqual({
      runId,
      status: RunStatus.RUNNING,
      outcome: null,
      snapshotUrl: `/api/runs/${runId}`,
      eventsUrl: `/api/runs/${runId}/events`,
    });

    expect(
      await prisma.testRun.count({ where: { requestedById: operatorUser.id } }),
    ).toBe(1);
    expect(await prisma.runStep.count({ where: { runId } })).toBe(
      fixture.steps.length,
    );
    expect(await prisma.runEvent.count({ where: { runId } })).toBe(1);

    await prisma.testRun.update({
      where: { id: runId },
      data: {
        status: RunStatus.CANCELLED,
        finishedAt: new Date(),
        reasonCode: 'USER_CANCELLED',
      },
    });

    const terminalReplay = await postRun(operator, key, body).expect(200);
    expect(terminalReplay.body).toMatchObject({
      runId,
      status: RunStatus.CANCELLED,
      outcome: null,
    });
    expect(
      await prisma.testRun.count({ where: { requestedById: operatorUser.id } }),
    ).toBe(1);
  });

  it('rejects the same key with a different request and keeps the first run', async () => {
    const key = runKey();
    const first = await postRun(operator, key, normalBody()).expect(202);
    const runId = (first.body as RunStartResponseBody).runId;

    const conflict = await postRun(
      operator,
      key,
      normalBody({ seed: 123_456_790 }),
    ).expect(409);
    expect(conflict.body).toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });

    const draftConflict = await postRun(
      operator,
      key,
      normalBody({ planVersionId: draftOnly.revisionId }),
    ).expect(409);
    expect(draftConflict.body).toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });

    expect(
      await prisma.testRun.count({ where: { requestedById: operatorUser.id } }),
    ).toBe(1);
    expect(
      await prisma.testRun.findUnique({ where: { id: runId } }),
    ).not.toBeNull();
  });

  it('scopes the key to the request user', async () => {
    const key = runKey();
    const first = await postRun(operator, key, normalBody()).expect(202);
    const firstId = (first.body as RunStartResponseBody).runId;

    await prisma.testRun.update({
      where: { id: firstId },
      data: { status: RunStatus.CANCELLED, finishedAt: new Date() },
    });

    const other = await postRun(otherOperator, key, normalBody()).expect(202);
    expect((other.body as RunStartResponseBody).runId).not.toBe(firstId);
    expect(
      await prisma.testRun.count({
        where: { requestedById: otherOperatorUser.id, idempotencyKey: key },
      }),
    ).toBe(1);
  });

  it('returns RUN_ALREADY_ACTIVE with the active run id and does not queue', async () => {
    const first = await postRun(operator, runKey(), normalBody()).expect(202);
    const activeRunId = (first.body as RunStartResponseBody).runId;

    const secondKey = runKey();
    const conflict = await postRun(operator, secondKey, normalBody()).expect(
      409,
    );

    expect(conflict.body).toMatchObject({
      code: 'RUN_ALREADY_ACTIVE',
      details: { activeRunId },
    });
    expect(
      await prisma.testRun.count({ where: { idempotencyKey: secondKey } }),
    ).toBe(0);
    expect(
      await prisma.testRun.count({ where: { requestedById: operatorUser.id } }),
    ).toBe(1);
  });

  it('accepts exactly one of two concurrent starts with different keys', async () => {
    for (let round = 0; round < 3; round += 1) {
      const firstKey = runKey();
      const secondKey = runKey();
      const responses = await Promise.all([
        postRun(operator, firstKey, normalBody()),
        postRun(otherOperator, secondKey, normalBody()),
      ]);
      const statuses = responses
        .map((response) => response.status)
        .sort((left, right) => left - right);

      expect(statuses).toEqual([202, 409]);

      const accepted = responses.find((response) => response.status === 202)!;
      const rejected = responses.find((response) => response.status === 409)!;
      const acceptedRunId = (accepted.body as RunStartResponseBody).runId;

      expect(accepted.body).toMatchObject({
        status: RunStatus.RUNNING,
        outcome: null,
      });
      expect(rejected.body).toMatchObject({
        code: 'RUN_ALREADY_ACTIVE',
        details: { activeRunId: acceptedRunId },
      });

      expect(
        await prisma.testRun.count({
          where: { idempotencyKey: { in: [firstKey, secondKey] } },
        }),
      ).toBe(1);
      expect(
        await prisma.runEvent.count({ where: { runId: acceptedRunId } }),
      ).toBe(1);
      expect(
        await prisma.runStep.count({ where: { runId: acceptedRunId } }),
      ).toBe(fixture.steps.length);

      await deleteRunTestRuns(prisma);
    }

    expect(
      await prisma.testRun.count({
        where: { requestedById: { in: testUserIds() } },
      }),
    ).toBe(0);
  });

  it('returns one run for two concurrent starts with the same key and body', async () => {
    const key = runKey();
    const body = normalBody();
    const responses = await Promise.all([
      postRun(operator, key, body),
      postRun(operator, key, body),
    ]);

    expect(
      responses
        .map((response) => response.status)
        .sort((left, right) => left - right),
    ).toEqual([200, 202]);
    const firstId = (responses[0]!.body as RunStartResponseBody).runId;
    const secondId = (responses[1]!.body as RunStartResponseBody).runId;
    expect(firstId).toBe(secondId);

    expect(
      await prisma.testRun.count({
        where: { requestedById: operatorUser.id, idempotencyKey: key },
      }),
    ).toBe(1);
    expect(await prisma.runEvent.count({ where: { runId: firstId } })).toBe(1);
  });

  it('rolls back the run and steps when the first event cannot commit', async () => {
    const key = runKey();

    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION "${FAIL_EVENT_FUNCTION}"()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'forced run event failure' USING ERRCODE = '23514';
      END;
      $$
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "${FAIL_EVENT_TRIGGER}"
      BEFORE INSERT ON "run_events"
      FOR EACH ROW
      EXECUTE FUNCTION "${FAIL_EVENT_FUNCTION}"()
    `);

    try {
      const failed = await postRun(operator, key, normalBody()).expect(500);
      expect(failed.body).toMatchObject({ code: 'INTERNAL_ERROR' });
    } finally {
      await dropFailureTrigger();
    }

    expect(
      await prisma.testRun.count({
        where: { requestedById: operatorUser.id, idempotencyKey: key },
      }),
    ).toBe(0);
    expect(
      await prisma.runStep.count({
        where: { run: { requestedById: operatorUser.id } },
      }),
    ).toBe(0);
    expect(
      await prisma.runEvent.count({
        where: { run: { requestedById: operatorUser.id } },
      }),
    ).toBe(0);

    // With no committed idempotency record, the same key can retry cleanly.
    await postRun(operator, key, normalBody()).expect(202);
  });

  it('leaves no run rows after cleanup', async () => {
    await postRun(operator, runKey(), normalBody()).expect(202);
    await deleteRunTestRuns(prisma);

    expect(
      await prisma.testRun.count({
        where: { requestedById: { in: testUserIds() } },
      }),
    ).toBe(0);
    expect(
      await prisma.runStep.count({
        where: { run: { requestedById: { in: testUserIds() } } },
      }),
    ).toBe(0);
    expect(
      await prisma.runEvent.count({
        where: { run: { requestedById: { in: testUserIds() } } },
      }),
    ).toBe(0);
  });
});
