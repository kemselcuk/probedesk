import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from '../src/auth/auth.constants.js';
import { hashToken } from '../src/auth/token.js';
import {
  Role,
  RunEventType,
  RunScenario,
  RunStatus,
} from '../src/prisma/generated/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { RUN_EVENT_STREAM_OPTIONS } from '../src/events/run-events.options.js';
import { RunEventsService } from '../src/events/run-events.service.js';
import { runEventWireType } from '../src/runs/run-domain.js';
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
  createPublishedRunFixture,
  createRunTestProfile,
  createRunTestUser,
  deleteRunTestData,
  deleteRunTestRuns,
  type PublishedRunFixture,
} from './support/run-helpers.js';
import { ControlledRunScheduler } from './support/run-schedulers.js';
import { openSse, type SseConnection, type SseFrame } from './support/sse-client.js';

interface ClientSession {
  cookie: string;
  csrfToken: string;
}

interface StartRunResponseBody {
  runId: string;
  status: RunStatus;
}

interface RunEventEnvelope {
  schemaVersion: number;
  runId: string;
  sequence: number;
  occurredAt: string;
  payload: unknown;
}

const STREAM_OPTIONS = {
  pollIntervalMs: 20,
  heartbeatIntervalMs: 60,
  batchSize: 4,
} as const;

function runKey(): string {
  return `sse-e2e-${randomUUID()}`;
}

describe('run event SSE stream (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let executor: RunExecutor;
  let runEvents: RunEventsService;
  let baseUrl: string;
  const scheduler = new ControlledRunScheduler('auto');
  const connections = new Set<SseConnection>();

  let planner: ClientSession;
  let operator: ClientSession;
  let viewer: ClientSession;
  let operatorUser: TestUser;
  let viewerUser: TestUser;
  let fixture: PublishedRunFixture;

  const server = () => app.getHttpServer();

  beforeAll(async () => {
    app = await createTestApplication(
      {},
      {
        overrides: [
          { provide: RUN_SCHEDULER, useValue: scheduler },
          { provide: RUN_EVENT_STREAM_OPTIONS, useValue: STREAM_OPTIONS },
        ],
      },
    );

    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;

    prisma = app.get(PrismaService);
    executor = app.get(RunExecutor);
    runEvents = app.get(RunEventsService);

    await deleteRunTestData(prisma);

    const plannerUser = await createRunTestUser(prisma, Role.PLANNER);
    operatorUser = await createRunTestUser(prisma, Role.OPERATOR);
    viewerUser = await createRunTestUser(prisma, Role.VIEWER);
    const profile = await createRunTestProfile(prisma);
    fixture = await createPublishedRunFixture(prisma, plannerUser.id, profile, {
      planName: 'SSE e2e plan',
    });

    planner = await login(plannerUser);
    operator = await login(operatorUser);
    viewer = await login(viewerUser);
  });

  afterEach(async () => {
    for (const connection of connections) {
      connection.abort();
    }
    connections.clear();

    await waitFor(
      () => runEvents.activeStreamCount === 0,
      'SSE connections to release their resources',
    );

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
      for (const connection of connections) {
        connection.abort();
      }
      connections.clear();

      if (runEvents) {
        await waitFor(
          () => runEvents.activeStreamCount === 0,
          'SSE connections to close before cleanup',
        );
      }

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

  async function startRun(): Promise<StartRunResponseBody> {
    const response = await request(server())
      .post('/api/runs')
      .set('Cookie', operator.cookie)
      .set('X-XSRF-TOKEN', operator.csrfToken)
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

  async function waitForTerminal(runId: string): Promise<RunStatus> {
    let status: RunStatus | null = null;

    await waitFor(async () => {
      const run = await prisma.testRun.findUnique({
        where: { id: runId },
        select: { status: true },
      });
      status = run?.status ?? null;
      return status !== null && status !== RunStatus.RUNNING;
    }, `run ${runId} to reach a terminal status`);

    await waitFor(
      () => executor.activeExecutionCount === 0,
      'executor to release the terminal run',
    );

    if (status === null) {
      throw new Error('The terminal run disappeared.');
    }
    return status;
  }

  async function driveToTerminal(runId: string): Promise<RunStatus> {
    const deadline = Date.now() + 10_000;

    for (;;) {
      const run = await prisma.testRun.findUnique({
        where: { id: runId },
        select: { status: true },
      });

      if (!run) {
        throw new Error('The run disappeared while it was being driven.');
      }
      if (run.status !== RunStatus.RUNNING) {
        break;
      }
      if (Date.now() > deadline) {
        throw new Error('Timed out driving the paused run to a terminal status.');
      }

      if (scheduler.pendingCount > 0) {
        scheduler.releasePending();
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    await waitFor(
      () => executor.activeExecutionCount === 0,
      'executor to release the driven run',
    );

    const terminal = await prisma.testRun.findUniqueOrThrow({
      where: { id: runId },
      select: { status: true },
    });
    return terminal.status;
  }

  async function completedRun(): Promise<{
    runId: string;
    events: Awaited<ReturnType<typeof loadEvents>>;
  }> {
    scheduler.setMode('auto');
    const started = await startRun();
    const status = await waitForTerminal(started.runId);
    expect(status).toBe(RunStatus.COMPLETED);

    return {
      runId: started.runId,
      events: await loadEvents(started.runId),
    };
  }

  async function loadEvents(runId: string) {
    return prisma.runEvent.findMany({
      where: { runId },
      orderBy: { sequence: 'asc' },
    });
  }

  async function openStream(
    runId: string,
    session: ClientSession,
    options: { after?: string; lastEventId?: string } = {},
  ): Promise<SseConnection> {
    const query =
      options.after !== undefined
        ? `?after=${encodeURIComponent(options.after)}`
        : '';
    const connection = await openSse(
      `${baseUrl}/api/runs/${runId}/events${query}`,
      {
        cookie: session.cookie,
        ...(options.lastEventId !== undefined
          ? { lastEventId: options.lastEventId }
          : {}),
      },
    );

    connections.add(connection);
    return connection;
  }

  function eventFrames(connection: SseConnection): SseFrame[] {
    return connection.frames.filter((frame) => frame.id !== null);
  }

  function envelope(frame: SseFrame): RunEventEnvelope {
    if (frame.data === null) {
      throw new Error('Expected an SSE frame with a data field.');
    }
    return JSON.parse(frame.data) as RunEventEnvelope;
  }

  function expectReplayMatches(
    connection: SseConnection,
    events: Awaited<ReturnType<typeof loadEvents>>,
  ): void {
    const frames = eventFrames(connection);

    expect(frames.map((frame) => frame.id)).toEqual(
      events.map((event) => String(event.sequence)),
    );
    expect(frames.map((frame) => frame.event)).toEqual(
      events.map((event) => runEventWireType(event.type)),
    );

    for (const [index, frame] of frames.entries()) {
      const event = events[index]!;
      expect(envelope(frame)).toEqual({
        schemaVersion: 1,
        runId: events[0]!.runId,
        sequence: event.sequence,
        occurredAt: event.occurredAt.toISOString(),
        payload: event.payload,
      });
    }
  }

  async function expectJsonError(
    path: string,
    status: number,
    session?: ClientSession,
    lastEventId?: string,
  ): Promise<void> {
    let call = request(server()).get(path);
    if (session) {
      call = call.set('Cookie', session.cookie);
    }
    if (lastEventId !== undefined) {
      call = call.set('Last-Event-ID', lastEventId);
    }

    const response = await call.expect(status);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['content-type']).not.toContain('text/event-stream');
    expect(response.body).toMatchObject({
      code: status === 404 ? 'NOT_FOUND' : expect.any(String),
      requestId: expect.any(String),
    });
  }

  it('replays every committed event after after=0 and closes on the terminal event', async () => {
    const { runId, events } = await completedRun();
    expect(events.length).toBeGreaterThan(4);
    expect(events.at(-1)?.type).toBe(RunEventType.RUN_COMPLETED);

    const connection = await openStream(runId, operator, { after: '0' });
    await connection.waitForClose();

    expect(connection.statusCode).toBe(200);
    expect(connection.headers['content-type']).toContain('text/event-stream');
    expect(connection.headers['cache-control']).toContain('no-cache');
    expect(connection.headers['x-accel-buffering']).toBe('no');
    expect(connection.headers['connection']).toBe('keep-alive');

    expectReplayMatches(connection, events);
    expect(eventFrames(connection).at(-1)?.event).toBe('run.completed');

    const raw = connection.frames.map((frame) => frame.raw).join('\n');
    for (const forbidden of [
      'passwordHash',
      'password',
      'csrf',
      'idempotencyKey',
      'requestHash',
      'sessionToken',
      operatorUser.email,
    ]) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it('replays only events newer than a mid cursor', async () => {
    const { runId, events } = await completedRun();

    const connection = await openStream(runId, operator, { after: '3' });
    await connection.waitForClose();

    expect(connection.statusCode).toBe(200);
    expectReplayMatches(connection, events.filter((event) => event.sequence > 3));
    expect(connection.frames.slice(0, 1)[0]?.id).toBe('4');
  });

  it('gives Last-Event-ID precedence over after, including an ignored malformed after', async () => {
    const { runId, events } = await completedRun();

    const headerWins = await openStream(runId, operator, {
      after: '1',
      lastEventId: '4',
    });
    await headerWins.waitForClose();
    expectReplayMatches(
      headerWins,
      events.filter((event) => event.sequence > 4),
    );
    expect(eventFrames(headerWins)[0]?.id).toBe('5');

    const headerWithBadQuery = await openStream(runId, operator, {
      after: 'not-an-integer',
      lastEventId: '2',
    });
    await headerWithBadQuery.waitForClose();
    expectReplayMatches(
      headerWithBadQuery,
      events.filter((event) => event.sequence > 2),
    );
    expect(eventFrames(headerWithBadQuery)[0]?.id).toBe('3');
  });

  it('rejects malformed, negative and future cursors before writing SSE headers', async () => {
    const { runId, events } = await completedRun();
    const lastSequence = events.at(-1)!.sequence;
    const base = `/api/runs/${runId}/events`;

    for (const query of [
      '?after=-1',
      '?after=abc',
      '?after=1.5',
      `?after=${lastSequence + 1}`,
      '?after=1&after=2',
      '?after=0&limit=1',
    ]) {
      await expectJsonError(`${base}${query}`, 400, operator);
    }

    await expectJsonError(`${base}?after=0`, 400, operator, 'bad');
    await expectJsonError(
      `${base}?after=0`,
      400,
      operator,
      String(lastSequence + 1),
    );
  });

  it('returns 401 without a session, 404 for an unknown run and 400 for a malformed id', async () => {
    const { runId } = await completedRun();

    await expectJsonError(`/api/runs/${runId}/events?after=0`, 401);
    await expectJsonError(
      `/api/runs/${randomUUID()}/events?after=0`,
      404,
      operator,
    );
    await expectJsonError('/api/runs/not-a-uuid/events?after=0', 400, operator);
  });

  it('allows Planner, Operator and Viewer to replay a run stream', async () => {
    const { runId, events } = await completedRun();

    for (const session of [planner, operator, viewer]) {
      const connection = await openStream(runId, session, { after: '0' });
      await connection.waitForClose();
      expect(connection.statusCode).toBe(200);
      expectReplayMatches(connection, events);
    }
  });

  it('returns 204 instead of opening a stream when a terminal run has no backlog', async () => {
    const { runId, events } = await completedRun();
    const lastSequence = events.at(-1)!.sequence;

    const afterResponse = await request(server())
      .get(`/api/runs/${runId}/events?after=${lastSequence}`)
      .set('Cookie', operator.cookie)
      .expect(204);
    expect(afterResponse.text).toBeFalsy();
    expect(afterResponse.headers['content-type'] ?? '').not.toContain(
      'text/event-stream',
    );

    const headerResponse = await request(server())
      .get(`/api/runs/${runId}/events`)
      .set('Cookie', operator.cookie)
      .set('Last-Event-ID', String(lastSequence))
      .expect(204);
    expect(headerResponse.text).toBeFalsy();
  });

  it('follows live events without gaps or duplicates and closes after run.completed', async () => {
    scheduler.setMode('paused');
    const started = await startRun();
    await waitFor(
      () => executor.activeExecutionCount === 1,
      'the paused executor to claim the run',
    );

    const connection = await openStream(started.runId, operator, { after: '0' });
    await connection.waitForEventCount(1);
    expect(eventFrames(connection)[0]?.id).toBe('1');

    const status = await driveToTerminal(started.runId);
    expect(status).toBe(RunStatus.COMPLETED);

    await connection.waitForClose(10_000);
    const events = await loadEvents(started.runId);

    expect(connection.statusCode).toBe(200);
    expectReplayMatches(connection, events);
    expect(eventFrames(connection).at(-1)?.event).toBe('run.completed');

    const ids = eventFrames(connection).map((frame) => Number(frame.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(events.map((event) => event.sequence));
  });

  it('sends observable heartbeats that consume no domain sequence', async () => {
    scheduler.setMode('paused');
    const started = await startRun();
    await waitFor(
      () => executor.activeExecutionCount === 1,
      'the paused executor to claim the run',
    );

    const connection = await openStream(started.runId, operator, { after: '0' });
    await connection.waitForEventCount(1);

    const before = await prisma.runEvent.count({
      where: { runId: started.runId },
    });
    await connection.waitForComment('heartbeat');
    const after = await prisma.runEvent.count({
      where: { runId: started.runId },
    });

    expect(after).toBe(before);
    expect(connection.comments.some((value) => value.includes('heartbeat'))).toBe(
      true,
    );
    expect(eventFrames(connection)).toHaveLength(1);
    expect(connection.frames.some((frame) => frame.id === null)).toBe(true);

    connection.abort();
    await waitFor(
      () => runEvents.activeStreamCount === 0,
      'the heartbeat stream to release its timers',
    );
  });

  it('cleans up on client abort without stopping the executor', async () => {
    scheduler.setMode('paused');
    const started = await startRun();
    await waitFor(
      () => executor.activeExecutionCount === 1,
      'the paused executor to claim the run',
    );

    const connection = await openStream(started.runId, operator, { after: '0' });
    await connection.waitForEventCount(1);
    expect(runEvents.activeStreamCount).toBe(1);

    connection.abort();
    await waitFor(
      () => runEvents.activeStreamCount === 0,
      'the aborted stream to release its polling and heartbeat timers',
    );

    const status = await driveToTerminal(started.runId);
    expect(status).toBe(RunStatus.COMPLETED);
    expect(runEvents.activeStreamCount).toBe(0);

    const events = await loadEvents(started.runId);
    expect(events.at(-1)?.type).toBe(RunEventType.RUN_COMPLETED);
  });

  it('closes the stream at the next heartbeat after session revocation', async () => {
    scheduler.setMode('paused');
    const started = await startRun();
    await waitFor(
      () => executor.activeExecutionCount === 1,
      'the paused executor to claim the run',
    );

    const dedicated = await login(operatorUser);
    const connection = await openStream(started.runId, dedicated, {
      after: '0',
    });
    await connection.waitForEventCount(1);

    await request(server())
      .post('/api/auth/logout')
      .set('Cookie', dedicated.cookie)
      .set('X-XSRF-TOKEN', dedicated.csrfToken)
      .expect(204);

    await connection.waitForClose();
    expect(connection.statusCode).toBe(200);
    expect(connection.streamError).toBeNull();
    expect(eventFrames(connection).at(-1)?.event).not.toBe('run.completed');

    const status = await driveToTerminal(started.runId);
    expect(status).toBe(RunStatus.COMPLETED);
  });

  it('closes the stream at the next heartbeat after session expiry', async () => {
    scheduler.setMode('paused');
    const started = await startRun();
    await waitFor(
      () => executor.activeExecutionCount === 1,
      'the paused executor to claim the run',
    );

    const dedicated = await login(operatorUser);
    const connection = await openStream(started.runId, dedicated, {
      after: '0',
    });
    await connection.waitForEventCount(1);

    const token = sessionTokenFromCookie(dedicated.cookie);
    const session = await prisma.session.findUniqueOrThrow({
      where: { tokenHash: hashToken(token) },
    });
    await prisma.session.update({
      where: { id: session.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    await connection.waitForClose();
    expect(connection.statusCode).toBe(200);
    expect(connection.streamError).toBeNull();
    expect(eventFrames(connection).at(-1)?.event).not.toBe('run.completed');

    const status = await driveToTerminal(started.runId);
    expect(status).toBe(RunStatus.COMPLETED);
  });
});

function sessionTokenFromCookie(cookie: string): string {
  const prefix = `${SESSION_COOKIE_NAME}=`;
  const pair = cookie.split('; ').find((value) => value.startsWith(prefix));

  if (!pair) {
    throw new Error('Expected a session cookie in the test client.');
  }

  return pair.slice(prefix.length);
}
