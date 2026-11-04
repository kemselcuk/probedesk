import { randomUUID } from 'node:crypto';
import { Logger, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from '../src/auth/auth.constants.js';
import {
  PlanRevisionState,
  Role,
  RunEventType,
  RunScenario,
  RunStatus,
} from '../src/prisma/generated/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { RunExecutor } from '../src/runs/run-executor.js';
import { RUN_SCHEDULER } from '../src/runs/run-scheduler.js';
import {
  cookieHeader,
  getCookie,
  readSetCookies,
  type TestUser,
} from './support/auth-helpers.js';
import { createTestApplication } from './support/create-test-application.js';
import { MemoryLogger } from './support/memory-logger.js';
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

interface FieldErrorBody {
  path: string;
  code: string;
  message: string;
}

interface PlanResponseBody {
  id: string;
  name: string;
  createdAt: string;
  createdBy?: { id: string };
  draft?: { id: string; editRevision: number } | null;
  published: { id: string; versionNumber: number; publishedAt: string } | null;
}

interface PublishedResponseBody {
  id: string;
  versionNumber: number;
  publishedAt: string;
}

interface DraftResponseBody {
  id: string;
  editRevision: number;
  name: string;
}

const FAIL_RUN_TRIGGER = 'security_e2e_fail_run_insert';
const FAIL_RUN_FUNCTION = 'security_e2e_fail_run_insert';

function idempotencyKey(): string {
  return `security-e2e-${randomUUID()}`;
}

function readFieldErrors(body: unknown): FieldErrorBody[] {
  return (body as { fieldErrors?: FieldErrorBody[] }).fieldErrors ?? [];
}

function expectFieldErrors(
  response: request.Response,
  expectedPaths: readonly string[],
): void {
  expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
  const paths = readFieldErrors(response.body).map((issue) => issue.path);
  for (const path of expectedPaths) {
    expect(paths, `expected field error for ${path}`).toContain(path);
  }
}

function withoutSetCookie(
  headers: Record<string, unknown>,
): Record<string, unknown> {
  const { 'set-cookie': _setCookie, ...rest } = headers;
  return rest;
}

describe('role and request security (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let executor: RunExecutor;
  const scheduler = new ControlledRunScheduler('paused');
  const logger = new MemoryLogger();
  let plannerUser: TestUser;
  let operatorUser: TestUser;
  let viewerUser: TestUser;
  let otherPlannerUser: TestUser;
  let planner: ClientSession;
  let operator: ClientSession;
  let viewer: ClientSession;
  let fixture: PublishedRunFixture;

  const server = () => app.getHttpServer();

  beforeAll(async () => {
    app = await createTestApplication(
      {},
      {
        overrides: [{ provide: RUN_SCHEDULER, useValue: scheduler }],
        logger,
      },
    );
    prisma = app.get(PrismaService);
    executor = app.get(RunExecutor);

    await dropFailureTrigger();
    await deleteRunTestData(prisma);

    plannerUser = await createRunTestUser(prisma, Role.PLANNER);
    otherPlannerUser = await createRunTestUser(prisma, Role.PLANNER);
    operatorUser = await createRunTestUser(prisma, Role.OPERATOR);
    viewerUser = await createRunTestUser(prisma, Role.VIEWER);

    const profile = await createRunTestProfile(prisma);
    fixture = await createPublishedRunFixture(prisma, plannerUser.id, profile, {
      planName: 'Security role matrix plan',
    });

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
    await dropFailureTrigger();
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
        await dropFailureTrigger();
        await deleteRunTestData(prisma);
      }
    } finally {
      scheduler.dispose();
      if (app) {
        await app.close();
      }
      Logger.overrideLogger(false);
    }
  });

  async function login(user: TestUser): Promise<ClientSession> {
    const response = await request(server())
      .post('/api/auth/login')
      .set('Host', 'probedesk.local')
      .set('Origin', 'http://probedesk.local')
      .send({ email: user.email, password: user.password })
      .expect(200);

    const cookies = readSetCookies(response);
    const csrfCookie = getCookie(cookies, CSRF_COOKIE_NAME);

    return {
      cookie: cookieHeader(getCookie(cookies, SESSION_COOKIE_NAME), csrfCookie),
      csrfToken: csrfCookie.value,
    };
  }

  function send(
    session: ClientSession | null,
    method: 'get' | 'post' | 'put',
    path: string,
    body?: Record<string, unknown>,
    options: {
      csrf?: boolean;
      origin?: string | null;
      headers?: Record<string, string>;
    } = {},
  ): request.Test {
    let call = request(server())[method](path);
    const host = 'probedesk.local';
    const origin =
      options.origin === undefined ? `http://${host}` : options.origin;

    call = call.set('Host', host);
    if (origin !== null) {
      call = call.set('Origin', origin);
    }
    if (session) {
      call = call.set('Cookie', session.cookie);
      if (options.csrf !== false) {
        call = call.set('X-XSRF-TOKEN', session.csrfToken);
      }
    }
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      call = call.set(name, value);
    }
    if (body !== undefined) {
      call = call.send(body);
    }
    return call;
  }

  function normalRunBody(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      planVersionId: fixture.revisionId,
      scenario: RunScenario.NORMAL,
      seed: 123_456_789,
      ...overrides,
    };
  }

  async function startRun(): Promise<string> {
    const response = await send(operator, 'post', '/api/runs', normalRunBody(), {
      headers: { 'Idempotency-Key': idempotencyKey() },
    }).expect(202);

    return (response.body as { runId: string }).runId;
  }

  async function createPlan(name: string): Promise<PlanResponseBody> {
    const response = await send(planner, 'post', '/api/plans', {
      name,
      profileId: fixture.profile.id,
    }).expect(201);

    return response.body as PlanResponseBody;
  }

  async function saveDraft(planId: string): Promise<DraftResponseBody> {
    const response = await send(planner, 'put', `/api/plans/${planId}/draft`, {
      name: 'Security draft',
      expectedRevision: 1,
      steps: [
        {
          logicalStepId: '',
          name: 'Output voltage',
          unit: 'V',
          minimum: '4.750000',
          maximum: '5.250000',
          sampleCount: 2,
          intervalMs: 250,
        },
      ],
    }).expect(200);

    return response.body as DraftResponseBody;
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

  async function dropFailureTrigger(): Promise<void> {
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS "${FAIL_RUN_TRIGGER}" ON "test_runs"`,
    );
    await prisma.$executeRawUnsafe(
      `DROP FUNCTION IF EXISTS "${FAIL_RUN_FUNCTION}"()`,
    );
  }

  it('enforces the role matrix with 401 before 403 and no side effects', async () => {
    const plan = await createPlan('Role matrix draft plan');
    const draft = await saveDraft(plan.id);
    const activeRunId = await startRun();
    const planCount = await prisma.testPlan.count({
      where: { createdById: plannerUser.id },
    });
    const runCount = await prisma.testRun.count({
      where: { requestedById: operatorUser.id },
    });

    const cases: Array<{
      label: string;
      session: ClientSession | null;
      method: 'get' | 'post' | 'put';
      path: string;
      body?: Record<string, unknown>;
      headers?: Record<string, string>;
      expected: 401 | 403;
      code: 'UNAUTHENTICATED' | 'FORBIDDEN';
    }> = [
      {
        label: 'viewer cannot start a run',
        session: viewer,
        method: 'post',
        path: '/api/runs',
        body: normalRunBody(),
        headers: { 'Idempotency-Key': idempotencyKey() },
        expected: 403,
        code: 'FORBIDDEN',
      },
      {
        label: 'planner cannot start a run',
        session: planner,
        method: 'post',
        path: '/api/runs',
        body: normalRunBody(),
        headers: { 'Idempotency-Key': idempotencyKey() },
        expected: 403,
        code: 'FORBIDDEN',
      },
      {
        label: 'operator cannot create a plan',
        session: operator,
        method: 'post',
        path: '/api/plans',
        body: { name: 'Operator plan', profileId: fixture.profile.id },
        expected: 403,
        code: 'FORBIDDEN',
      },
      {
        label: 'viewer cannot create a plan',
        session: viewer,
        method: 'post',
        path: '/api/plans',
        body: { name: 'Viewer plan', profileId: fixture.profile.id },
        expected: 403,
        code: 'FORBIDDEN',
      },
      {
        label: 'operator cannot save a draft',
        session: operator,
        method: 'put',
        path: `/api/plans/${plan.id}/draft`,
        body: { name: 'Hijacked draft', expectedRevision: 1, steps: [] },
        expected: 403,
        code: 'FORBIDDEN',
      },
      {
        label: 'operator cannot publish a draft',
        session: operator,
        method: 'post',
        path: `/api/plans/${plan.id}/draft/publish`,
        body: { expectedRevision: 1 },
        expected: 403,
        code: 'FORBIDDEN',
      },
      {
        label: 'operator cannot create a draft',
        session: operator,
        method: 'post',
        path: `/api/plans/${plan.id}/drafts`,
        expected: 403,
        code: 'FORBIDDEN',
      },
      {
        label: 'planner cannot cancel a run',
        session: planner,
        method: 'post',
        path: `/api/runs/${activeRunId}/cancel`,
        expected: 403,
        code: 'FORBIDDEN',
      },
      {
        label: 'viewer cannot cancel a run',
        session: viewer,
        method: 'post',
        path: `/api/runs/${activeRunId}/cancel`,
        expected: 403,
        code: 'FORBIDDEN',
      },
      {
        label: 'missing session cannot start a run',
        session: null,
        method: 'post',
        path: '/api/runs',
        body: normalRunBody(),
        headers: { 'Idempotency-Key': idempotencyKey() },
        expected: 401,
        code: 'UNAUTHENTICATED',
      },
      {
        label: 'missing session cannot create a plan',
        session: null,
        method: 'post',
        path: '/api/plans',
        body: { name: 'Anonymous plan', profileId: fixture.profile.id },
        expected: 401,
        code: 'UNAUTHENTICATED',
      },
      {
        label: 'missing session cannot cancel a run',
        session: null,
        method: 'post',
        path: `/api/runs/${activeRunId}/cancel`,
        expected: 401,
        code: 'UNAUTHENTICATED',
      },
      {
        label: 'missing session cannot read plans',
        session: null,
        method: 'get',
        path: '/api/plans',
        expected: 401,
        code: 'UNAUTHENTICATED',
      },
      {
        label: 'missing session cannot read the active run',
        session: null,
        method: 'get',
        path: '/api/runs/active',
        expected: 401,
        code: 'UNAUTHENTICATED',
      },
    ];

    for (const testCase of cases) {
      const response = await send(
        testCase.session,
        testCase.method,
        testCase.path,
        testCase.body,
        { headers: testCase.headers },
      ).expect(testCase.expected);

      expect(response.body, testCase.label).toMatchObject({
        code: testCase.code,
      });
      expect(response.headers['set-cookie'], testCase.label).toBeUndefined();
    }

    expect(
      await prisma.testPlan.count({ where: { createdById: plannerUser.id } }),
    ).toBe(planCount);
    expect(
      await prisma.testRun.count({ where: { requestedById: operatorUser.id } }),
    ).toBe(runCount);

    const storedPlan = await prisma.testPlan.findUniqueOrThrow({
      where: { id: plan.id },
      include: { revisions: true },
    });
    expect(storedPlan.createdById).toBe(plannerUser.id);
    expect(
      storedPlan.revisions.filter(
        (revision) => revision.state === PlanRevisionState.PUBLISHED,
      ),
    ).toHaveLength(0);
    const storedDraft = storedPlan.revisions.find(
      (revision) => revision.state === PlanRevisionState.DRAFT,
    );
    expect(storedDraft).toMatchObject({
      name: 'Security draft',
      editRevision: draft.editRevision,
    });

    const storedRun = await prisma.testRun.findUniqueOrThrow({
      where: { id: activeRunId },
    });
    expect(storedRun.status).toBe(RunStatus.RUNNING);

    await send(operator, 'post', `/api/runs/${activeRunId}/cancel`).expect(200);
  });

  it('rejects every client-supplied server-owned field without a write', async () => {
    const plan = await createPlan('Server-owned fields plan');
    const draft = await saveDraft(plan.id);
    const planCount = await prisma.testPlan.count({
      where: { createdById: plannerUser.id },
    });
    const runCount = await prisma.testRun.count({
      where: { requestedById: operatorUser.id },
    });
    const serverFields: Record<string, unknown> = {
      status: 'COMPLETED',
      outcome: 'PASSED',
      verdict: 'PASSED',
      createdBy: otherPlannerUser.id,
      publishedBy: otherPlannerUser.id,
      createdAt: '2000-01-01T00:00:00.000Z',
      startedAt: '2000-01-01T00:00:00.000Z',
      finishedAt: '2000-01-01T00:00:00.000Z',
      publishedAt: '2000-01-01T00:00:00.000Z',
      requestedBy: operatorUser.id,
    };
    const expectedPaths = Object.keys(serverFields);

    expectFieldErrors(
      await send(planner, 'post', '/api/plans', {
        name: 'Spoofed plan',
        profileId: fixture.profile.id,
        ...serverFields,
      }).expect(400),
      expectedPaths,
    );

    expectFieldErrors(
      await send(planner, 'put', `/api/plans/${plan.id}/draft`, {
        name: 'Spoofed draft',
        expectedRevision: draft.editRevision,
        steps: [],
        ...serverFields,
      }).expect(400),
      expectedPaths,
    );

    expectFieldErrors(
      await send(planner, 'post', `/api/plans/${plan.id}/draft/publish`, {
        expectedRevision: draft.editRevision,
        ...serverFields,
      }).expect(400),
      expectedPaths,
    );

    expectFieldErrors(
      await send(operator, 'post', '/api/runs', normalRunBody(serverFields), {
        headers: { 'Idempotency-Key': idempotencyKey() },
      }).expect(400),
      expectedPaths,
    );

    // Unknown fields are also rejected inside a nested step.
    expectFieldErrors(
      await send(planner, 'put', `/api/plans/${plan.id}/draft`, {
        name: 'Nested spoof',
        expectedRevision: draft.editRevision,
        steps: [
          {
            logicalStepId: '',
            name: 'Output voltage',
            unit: 'V',
            minimum: '4.750000',
            maximum: '5.250000',
            sampleCount: 1,
            intervalMs: 250,
            outcome: 'PASSED',
            status: 'COMPLETED',
            recordedCount: 999,
          },
        ],
      }).expect(400),
      ['steps.0.outcome', 'steps.0.status', 'steps.0.recordedCount'],
    );

    expect(
      await prisma.testPlan.count({ where: { createdById: plannerUser.id } }),
    ).toBe(planCount);
    expect(
      await prisma.testRun.count({ where: { requestedById: operatorUser.id } }),
    ).toBe(runCount);

    const stored = await prisma.testPlan.findUniqueOrThrow({
      where: { id: plan.id },
      include: { revisions: true },
    });
    expect(stored.revisions).toHaveLength(1);
    expect(stored.revisions[0]).toMatchObject({
      name: 'Security draft',
      editRevision: draft.editRevision,
      state: PlanRevisionState.DRAFT,
    });
  });

  it('rejects missing/wrong CSRF and a foreign Origin on every mutation', async () => {
    const plan = await createPlan('CSRF and origin plan');
    const draft = await saveDraft(plan.id);
    const activeRunId = await startRun();
    const planCount = await prisma.testPlan.count({
      where: { createdById: plannerUser.id },
    });
    const runCount = await prisma.testRun.count({
      where: { requestedById: operatorUser.id },
    });
    const logoutSession = await login(operatorUser);

    const mutations: Array<{
      label: string;
      session: ClientSession;
      method: 'post' | 'put';
      path: string;
      body?: Record<string, unknown>;
      headers?: Record<string, string>;
    }> = [
      {
        label: 'create plan',
        session: planner,
        method: 'post',
        path: '/api/plans',
        body: { name: 'Missing CSRF plan', profileId: fixture.profile.id },
      },
      {
        label: 'save draft',
        session: planner,
        method: 'put',
        path: `/api/plans/${plan.id}/draft`,
        body: { name: 'Missing CSRF draft', expectedRevision: 1, steps: [] },
      },
      {
        label: 'publish draft',
        session: planner,
        method: 'post',
        path: `/api/plans/${plan.id}/draft/publish`,
        body: { expectedRevision: draft.editRevision },
      },
      {
        label: 'create draft',
        session: planner,
        method: 'post',
        path: `/api/plans/${plan.id}/drafts`,
      },
      {
        label: 'start run',
        session: operator,
        method: 'post',
        path: '/api/runs',
        body: normalRunBody(),
        headers: { 'Idempotency-Key': idempotencyKey() },
      },
      {
        label: 'cancel run',
        session: operator,
        method: 'post',
        path: `/api/runs/${activeRunId}/cancel`,
      },
      {
        label: 'logout',
        session: logoutSession,
        method: 'post',
        path: '/api/auth/logout',
      },
    ];

    for (const mutation of mutations) {
      const missing = await send(
        mutation.session,
        mutation.method,
        mutation.path,
        mutation.body,
        { csrf: false, headers: mutation.headers },
      ).expect(403);
      expect(missing.body, `${mutation.label}: missing CSRF`).toMatchObject({
        code: 'FORBIDDEN',
      });

      const wrong = await send(
        mutation.session,
        mutation.method,
        mutation.path,
        mutation.body,
        {
          headers: {
            ...mutation.headers,
            'X-XSRF-TOKEN': 'not-the-token',
          },
          csrf: false,
        },
      ).expect(403);
      expect(wrong.body, `${mutation.label}: wrong CSRF`).toMatchObject({
        code: 'FORBIDDEN',
      });

      const foreignOrigin = await send(
        mutation.session,
        mutation.method,
        mutation.path,
        mutation.body,
        { headers: mutation.headers, origin: 'https://evil.example' },
      ).expect(403);
      expect(
        foreignOrigin.body,
        `${mutation.label}: foreign Origin`,
      ).toMatchObject({ code: 'FORBIDDEN' });
    }

    expect(
      await prisma.testPlan.count({ where: { createdById: plannerUser.id } }),
    ).toBe(planCount);
    expect(
      await prisma.testRun.count({ where: { requestedById: operatorUser.id } }),
    ).toBe(runCount);

    const storedPlan = await prisma.testPlan.findUniqueOrThrow({
      where: { id: plan.id },
      include: { revisions: true },
    });
    expect(storedPlan.revisions).toHaveLength(1);
    expect(storedPlan.revisions[0]).toMatchObject({
      name: 'Security draft',
      editRevision: draft.editRevision,
      state: PlanRevisionState.DRAFT,
    });

    const storedRun = await prisma.testRun.findUniqueOrThrow({
      where: { id: activeRunId },
    });
    expect(storedRun.status).toBe(RunStatus.RUNNING);

    // The dedicated logout session was not revoked by a rejected request.
    await request(server())
      .get('/api/auth/me')
      .set('Cookie', logoutSession.cookie)
      .expect(200);

    // A correctly signed request still works for the same mutation.
    const saved = await send(planner, 'put', `/api/plans/${plan.id}/draft`, {
      name: 'Same-origin saved',
      expectedRevision: draft.editRevision,
      steps: [],
    }).expect(200);
    expect(saved.body).toMatchObject({ name: 'Same-origin saved' });
    await send(operator, 'post', `/api/runs/${activeRunId}/cancel`).expect(200);
    await send(logoutSession, 'post', '/api/auth/logout').expect(204);
  });

  it('keeps login JSON-only and same-origin', async () => {
    const user = await createRunTestUser(prisma, Role.VIEWER);

    const nonJson = await request(server())
      .post('/api/auth/login')
      .set('Host', 'probedesk.local')
      .set('Origin', 'http://probedesk.local')
      .set('Content-Type', 'text/plain')
      .send(`email=${user.email}`)
      .expect(400);
    expect(nonJson.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Content-Type must be application/json.',
    });
    expect(nonJson.headers['set-cookie']).toBeUndefined();

    for (const origin of ['https://evil.example', 'null', 'not a url']) {
      const response = await request(server())
        .post('/api/auth/login')
        .set('Host', 'probedesk.local')
        .set('Origin', origin)
        .send({ email: user.email, password: user.password })
        .expect(403);
      expect(response.body).toMatchObject({ code: 'FORBIDDEN' });
      expect(response.headers['set-cookie']).toBeUndefined();
    }

    const unknownField = await request(server())
      .post('/api/auth/login')
      .set('Host', 'probedesk.local')
      .set('Origin', 'http://probedesk.local')
      .send({ email: user.email, password: user.password, role: 'PLANNER' })
      .expect(400);
    expect(readFieldErrors(unknownField.body)).toContainEqual(
      expect.objectContaining({ path: 'role', code: 'UNKNOWN_FIELD' }),
    );

    const sameOrigin = await request(server())
      .post('/api/auth/login')
      .set('Host', 'probedesk.local')
      .set('Origin', 'http://probedesk.local')
      .send({ email: user.email, password: user.password })
      .expect(200);
    expect(sameOrigin.body).toMatchObject({
      id: user.id,
      email: user.email,
      role: 'VIEWER',
    });
  });

  it('does not expose credentials, token hashes or idempotency internals in responses or logs', async () => {
    logger.clear();
    const sensitivePlan = await createPlan('Sensitive response plan');
    const draft = await saveDraft(sensitivePlan.id);
    const draftPlan = await createPlan('Sensitive draft plan');
    const openDraft = await saveDraft(draftPlan.id);
    const published = await send(
      planner,
      'post',
      `/api/plans/${sensitivePlan.id}/draft/publish`,
      { expectedRevision: draft.editRevision },
    ).expect(201);
    const publishedBody = published.body as PublishedResponseBody;
    expect(publishedBody.id).toEqual(expect.any(String));

    const runId = await startRun();
    await send(operator, 'post', `/api/runs/${runId}/cancel`).expect(200);

    const loginResponse = await request(server())
      .post('/api/auth/login')
      .set('Host', 'probedesk.local')
      .set('Origin', 'http://probedesk.local')
      .send({ email: operatorUser.email, password: operatorUser.password })
      .expect(200);

    const responses: Array<{ label: string; response: request.Response }> = [
      {
        label: 'login',
        response: loginResponse,
      },
      {
        label: 'create plan',
        response: await send(planner, 'post', '/api/plans', {
          name: 'Sensitive second plan',
          profileId: fixture.profile.id,
        }).expect(201),
      },
      {
        label: 'save draft',
        response: await send(planner, 'put', `/api/plans/${draftPlan.id}/draft`, {
          name: 'Sensitive saved',
          expectedRevision: openDraft.editRevision,
          steps: [],
        }).expect(200),
      },
      {
        label: 'list plans',
        response: await send(planner, 'get', '/api/plans').expect(200),
      },
      {
        label: 'plan detail',
        response: await send(planner, 'get', `/api/plans/${sensitivePlan.id}`).expect(200),
      },
      {
        label: 'plan versions',
        response: await send(
          planner,
          'get',
          `/api/plans/${sensitivePlan.id}/versions`,
        ).expect(200),
      },
      {
        label: 'version detail',
        response: await send(
          planner,
          'get',
          `/api/plan-versions/${publishedBody.id}`,
        ).expect(200),
      },
      {
        label: 'device profiles',
        response: await send(planner, 'get', '/api/device-profiles').expect(200),
      },
      {
        label: 'auth me',
        response: await send(planner, 'get', '/api/auth/me').expect(200),
      },
      {
        label: 'run snapshot',
        response: await send(operator, 'get', `/api/runs/${runId}`).expect(200),
      },
      {
        label: 'run history',
        response: await send(operator, 'get', '/api/runs').expect(200),
      },
      {
        label: 'active run',
        response: await send(operator, 'get', '/api/runs/active').expect(200),
      },
    ];

    const session = await prisma.session.findFirstOrThrow({
      where: { userId: operatorUser.id, revokedAt: null },
    });
    const storedPlanner = await prisma.user.findUniqueOrThrow({
      where: { id: plannerUser.id },
    });
    const storedRun = await prisma.testRun.findUniqueOrThrow({
      where: { id: runId },
    });
    const rawToken = operator.cookie
      .split('; ')
      .find((pair) => pair.startsWith(`${SESSION_COOKIE_NAME}=`))!
      .slice(SESSION_COOKIE_NAME.length + 1);
    const freshLoginCookies = readSetCookies(loginResponse);
    const freshSessionToken = getCookie(
      freshLoginCookies,
      SESSION_COOKIE_NAME,
    ).value;

    expect(storedPlanner.passwordHash).toMatch(/^\$argon2id\$/);
    expect(storedRun.idempotencyKey).toEqual(expect.any(String));
    expect(storedRun.requestHash).toMatch(/^[a-f0-9]{64}$/);

    const serialisedResponses = responses
      .map(
        ({ response }) =>
          `${response.text}\n${JSON.stringify(withoutSetCookie(response.headers))}`,
      )
      .join('\n');
    const forbiddenValues = [
      plannerUser.password,
      operatorUser.password,
      rawToken,
      freshSessionToken,
      operator.csrfToken,
      storedPlanner.passwordHash,
      session.tokenHash,
      session.csrfTokenHash ?? '',
      storedRun.idempotencyKey,
      storedRun.requestHash,
    ];

    for (const value of forbiddenValues.filter((value) => value.length > 0)) {
      expect(serialisedResponses).not.toContain(value);
      expect(logger.text).not.toContain(value);
    }

    for (const marker of [
      'passwordHash',
      'tokenHash',
      'csrfTokenHash',
      'idempotencyKey',
      'requestHash',
      'Set-Cookie',
      'postgresql://',
      'postgres://',
    ]) {
      expect(serialisedResponses).not.toContain(marker);
      expect(logger.text).not.toContain(marker);
    }
  });

  it('returns a safe 500 body and log when an unexpected database error occurs', async () => {
    logger.clear();
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${FAIL_RUN_FUNCTION}"()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'forced SELECT failure from postgresql://probedesk:supersecret@db.internal/probedesk';
      END;
      $$
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "${FAIL_RUN_TRIGGER}"
      BEFORE INSERT ON "test_runs"
      FOR EACH ROW
      EXECUTE FUNCTION "${FAIL_RUN_FUNCTION}"()
    `);

    const response = await send(operator, 'post', '/api/runs', normalRunBody(), {
      headers: { 'Idempotency-Key': idempotencyKey() },
    }).expect(500);

    expect(response.body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      requestId: expect.any(String),
    });
    expect(Object.keys(response.body as Record<string, unknown>).sort()).toEqual([
      'code',
      'message',
      'requestId',
    ]);

    const serialised = `${JSON.stringify(response.body)}\n${logger.text}`;
    for (const forbidden of [
      'forced SELECT failure',
      'supersecret',
      'db.internal',
      'postgresql://',
      'SELECT',
      'RAISE',
      'stack',
      FAIL_RUN_TRIGGER,
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
    expect(logger.text).toContain(
      (response.body as { requestId: string }).requestId,
    );
    expect(logger.text).toContain('status=500');
  });

  it('returns only server-assigned publisher and requestedBy values', async () => {
    const response = await send(planner, 'post', '/api/plans', {
      name: 'Server-assigned metadata plan',
      profileId: fixture.profile.id,
    }).expect(201);
    const plan = response.body as PlanResponseBody;
    expect(plan.createdAt).toEqual(expect.any(String));
    expect(Date.parse(plan.createdAt)).toBeGreaterThan(
      Date.parse('2026-01-01T00:00:00.000Z'),
    );

    const storedPlan = await prisma.testPlan.findUniqueOrThrow({
      where: { id: plan.id },
    });
    expect(storedPlan.createdById).toBe(plannerUser.id);

    const draft = await saveDraft(plan.id);
    const publishResponse = await send(
      planner,
      'post',
      `/api/plans/${plan.id}/draft/publish`,
      { expectedRevision: draft.editRevision },
    ).expect(201);
    const published = publishResponse.body as PublishedResponseBody;
    expect(Date.parse(published.publishedAt)).toBeGreaterThan(
      Date.parse('2026-01-01T00:00:00.000Z'),
    );

    const versionsResponse = await send(
      planner,
      'get',
      `/api/plans/${plan.id}/versions`,
    ).expect(200);
    const versions = versionsResponse.body as Array<{
      id: string;
      publishedBy: { id: string };
    }>;
    expect(versions).toContainEqual(
      expect.objectContaining({
        id: published.id,
        publishedBy: expect.objectContaining({ id: plannerUser.id }),
      }),
    );

    const storedRevision = await prisma.planRevision.findUniqueOrThrow({
      where: { id: published.id },
    });
    expect(storedRevision.publishedById).toBe(plannerUser.id);

    const key = idempotencyKey();
    const runResponse = await send(operator, 'post', '/api/runs', normalRunBody(), {
      headers: { 'Idempotency-Key': key },
    }).expect(202);
    const runId = (runResponse.body as { runId: string }).runId;
    const storedRun = await prisma.testRun.findUniqueOrThrow({
      where: { id: runId },
    });
    expect(storedRun.requestedById).toBe(operatorUser.id);
    expect(storedRun.status).toBe(RunStatus.RUNNING);
    expect(storedRun.outcome).toBeNull();
    expect(storedRun.idempotencyKey).toBe(key);
    expect(storedRun.requestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      await prisma.runEvent.count({
        where: { runId, type: RunEventType.RUN_STARTED },
      }),
    ).toBe(1);

    await send(operator, 'post', `/api/runs/${runId}/cancel`).expect(200);
  });
});
