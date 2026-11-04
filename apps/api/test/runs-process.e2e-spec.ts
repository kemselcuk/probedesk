import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/prisma/generated/client.js';
import {
  Role,
  RunEventType,
  RunScenario,
  RunStatus,
  RunStepStatus,
} from '../src/prisma/generated/client.js';
import {
  createPublishedRunFixture,
  createRunTestProfile,
  createRunTestUser,
  deleteRunTestData,
  deleteRunTestRuns,
  type PublishedRunFixture,
  type RunFixtureStepTemplate,
} from './support/run-helpers.js';
import {
  loginToApi,
  mutation,
  startApiProcess,
  waitFor,
  type ApiProcess,
  type ApiSession,
} from './support/api-process.js';

interface RunStartBody {
  runId: string;
  status: string;
  outcome: string | null;
}

const PROCESS_STEPS: readonly RunFixtureStepTemplate[] = [
  {
    name: 'Long output voltage',
    unit: 'V',
    minimum: '4.750000',
    maximum: '5.250000',
    sampleCount: 2,
    intervalMs: 1500,
  },
  {
    name: 'Long current draw',
    unit: 'A',
    minimum: '0.450000',
    maximum: '0.550000',
    sampleCount: 2,
    intervalMs: 1500,
  },
];

describe('run races, forced kill and controlled shutdown (e2e)', () => {
  let prisma: PrismaClient;
  let plannerUser: { id: string; email: string; password: string };
  let operatorUser: { id: string; email: string; password: string };
  let fixture: PublishedRunFixture;
  const processes: ApiProcess[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: requiredDatabaseUrl(),
        application_name: 'probedesk-race-e2e',
      }),
    });

    await deleteRunTestData(prisma);

    plannerUser = await createRunTestUser(prisma, Role.PLANNER);
    operatorUser = await createRunTestUser(prisma, Role.OPERATOR);
    const profile = await createRunTestProfile(prisma);
    fixture = await createPublishedRunFixture(prisma, plannerUser.id, profile, {
      planName: 'Process race and recovery plan',
      steps: PROCESS_STEPS,
    });
  });

  afterEach(async () => {
    await stopProcesses();
    if (prisma) {
      await deleteRunTestRuns(prisma);
    }
  });

  afterAll(async () => {
    try {
      await stopProcesses();
      if (prisma) {
        await deleteRunTestData(prisma);
      }
    } finally {
      if (prisma) {
        await prisma.$disconnect();
      }
    }
  });

  async function startTrackedProcess(label: string): Promise<ApiProcess> {
    const api = await startApiProcess({ label });
    processes.push(api);
    return api;
  }

  async function stopProcesses(): Promise<void> {
    const running = processes.splice(0);
    await Promise.all(
      running.map(async (api) => {
        await api.stop();
      }),
    );
  }

  async function startRun(
    api: ApiProcess,
    session: ApiSession,
    key: string,
  ): Promise<string> {
    const response = await mutation(
      api,
      session,
      'POST',
      '/api/runs',
      {
        planVersionId: fixture.revisionId,
        scenario: RunScenario.NORMAL,
        seed: 123_456_789,
      },
      { idempotencyKey: key },
    );
    expect(response.status).toBe(202);
    const body = response.body as RunStartBody;
    expect(body).toMatchObject({
      runId: expect.any(String),
      status: RunStatus.RUNNING,
      outcome: null,
    });
    return body.runId;
  }

  async function waitForMeasurements(
    runId: string,
    minimum: number,
  ): Promise<number> {
    return waitFor(
      async () => {
        const count = await prisma.measurement.count({ where: { runId } });
        return count >= minimum ? count : false;
      },
      `run ${runId} to commit ${minimum} measurement(s)`,
      15_000,
      25,
    );
  }

  async function loadEvents(runId: string) {
    return prisma.runEvent.findMany({
      where: { runId },
      orderBy: { sequence: 'asc' },
    });
  }

  function expectGapFree(
    events: Awaited<ReturnType<typeof loadEvents>>,
  ): void {
    expect(events.map((event) => event.sequence)).toEqual(
      events.map((_, index) => index + 1),
    );
  }

  it(
    'accepts exactly one of two concurrent starts across two API processes for repeated rounds',
    async () => {
      const first = await startTrackedProcess('race-a');
      const second = await startTrackedProcess('race-b');
      expect(first.port).not.toBe(second.port);

      const session = await loginToApi(
        first,
        operatorUser.email,
        operatorUser.password,
      );
      const body = {
        planVersionId: fixture.revisionId,
        scenario: RunScenario.NORMAL,
        seed: 123_456_789,
      };

      for (let round = 0; round < 5; round += 1) {
        const firstKey = `race-a-${round}-${randomUUID()}`;
        const secondKey = `race-b-${round}-${randomUUID()}`;

        const [firstResponse, secondResponse] = await Promise.all([
          mutation(first, session, 'POST', '/api/runs', body, {
            idempotencyKey: firstKey,
          }),
          mutation(second, session, 'POST', '/api/runs', body, {
            idempotencyKey: secondKey,
          }),
        ]);

        expect(
          [firstResponse.status, secondResponse.status].sort((a, b) => a - b),
          `round ${round}`,
        ).toEqual([202, 409]);

        const accepted =
          firstResponse.status === 202
            ? { api: first, response: firstResponse, key: firstKey }
            : { api: second, response: secondResponse, key: secondKey };
        const rejected =
          firstResponse.status === 409 ? firstResponse : secondResponse;
        const acceptedBody = accepted.response.body as RunStartBody;
        const rejectedBody = rejected.body as {
          code: string;
          details?: { activeRunId?: string };
        };

        expect(rejectedBody).toMatchObject({
          code: 'RUN_ALREADY_ACTIVE',
          details: { activeRunId: acceptedBody.runId },
        });
        expect(acceptedBody.status).toBe(RunStatus.RUNNING);

        const rows = await prisma.testRun.findMany({
          where: {
            idempotencyKey: {
              in: [firstKey, secondKey],
            },
          },
        });
        expect(rows, `round ${round}`).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          id: acceptedBody.runId,
          status: RunStatus.RUNNING,
          requestedById: operatorUser.id,
        });
        expect(
          await prisma.testRun.count({ where: { status: RunStatus.RUNNING } }),
        ).toBe(1);

        const cancel = await mutation(
          accepted.api,
          session,
          'POST',
          `/api/runs/${acceptedBody.runId}/cancel`,
          undefined,
        );
        expect(cancel.status).toBe(200);
        expect(cancel.body).toMatchObject({
          id: acceptedBody.runId,
          status: RunStatus.CANCELLED,
        });
        expect(
          await prisma.testRun.count({ where: { status: RunStatus.RUNNING } }),
        ).toBe(0);
      }

      const runs = await prisma.testRun.findMany({
        where: { requestedById: operatorUser.id },
        select: { id: true, status: true },
      });
      expect(runs).toHaveLength(5);
      expect(runs.every((run) => run.status === RunStatus.CANCELLED)).toBe(true);
      for (const run of runs) {
        expectGapFree(await loadEvents(run.id));
      }
    },
    60_000,
  );

  it(
    'preserves measurements across SIGKILL, recovers to INTERRUPTED before readiness and never resumes',
    async () => {
      const api = await startTrackedProcess('sigkill-api');
      const session = await loginToApi(
        api,
        operatorUser.email,
        operatorUser.password,
      );
      const runId = await startRun(api, session, `sigkill-${randomUUID()}`);
      await waitForMeasurements(runId, 1);

      const before = await prisma.testRun.findUniqueOrThrow({
        where: { id: runId },
      });
      const beforeMeasurements = await prisma.measurement.count({
        where: { runId },
      });
      const beforeEvents = await loadEvents(runId);
      expect(before.status).toBe(RunStatus.RUNNING);
      expect(before.recordedSampleCount).toBe(beforeMeasurements);
      expect(
        beforeEvents.some((event) => event.type === RunEventType.RUN_COMPLETED),
      ).toBe(false);

      const exit = await api.kill('SIGKILL');
      expect(exit.signal).toBe('SIGKILL');
      expect(exit.code).toBeNull();

      const killed = await prisma.testRun.findUniqueOrThrow({
        where: { id: runId },
        include: { steps: { orderBy: { position: 'asc' } } },
      });
      expect(killed.status).toBe(RunStatus.RUNNING);
      expect(killed.finishedAt).toBeNull();
      expect(
        await prisma.measurement.count({ where: { runId } }),
      ).toBe(beforeMeasurements);
      expect(await loadEvents(runId)).toEqual(beforeEvents);

      const recoveredApi = await startTrackedProcess('sigkill-recovery-api');
      const ready = await fetch(`${recoveredApi.baseUrl}/api/health/ready`);
      expect(ready.status).toBe(200);
      expect(await ready.json()).toMatchObject({
        status: 'ok',
        checks: { database: 'ok', migrations: 'ok' },
      });

      const recovered = await prisma.testRun.findUniqueOrThrow({
        where: { id: runId },
        include: { steps: { orderBy: { position: 'asc' } } },
      });
      expect(recovered).toMatchObject({
        status: RunStatus.INTERRUPTED,
        outcome: null,
        reasonCode: 'SERVER_RESTART',
        recordedSampleCount: before.recordedSampleCount,
        expectedSampleCount: before.expectedSampleCount,
      });
      expect(recovered.finishedAt).toBeInstanceOf(Date);
      expect(recovered.eventSequence).toBe(beforeEvents.length + 1);

      for (const step of recovered.steps) {
        if (step.status === RunStepStatus.INTERRUPTED) {
          expect(step.outcome).toBeNull();
          expect(step.finishedAt).toBeInstanceOf(Date);
        }
        if (step.status === RunStepStatus.NOT_RUN) {
          expect(step.outcome).toBeNull();
          expect(step.finishedAt).toBeNull();
        }
        if (step.status === RunStepStatus.COMPLETED) {
          expect(step.outcome).not.toBeNull();
        }
      }

      const recoveredMeasurements = await prisma.measurement.count({
        where: { runId },
      });
      expect(recoveredMeasurements).toBe(beforeMeasurements);
      const recoveredEvents = await loadEvents(runId);
      const recoveredSteps = recovered.steps.map((step) => ({
        id: step.id,
        position: step.position,
        status: step.status,
        outcome: step.outcome,
        recordedCount: step.recordedCount,
        startedAt: step.startedAt,
        finishedAt: step.finishedAt,
      }));
      expectGapFree(recoveredEvents);
      expect(recoveredEvents.at(-1)?.type).toBe(
        RunEventType.RUN_INTERRUPTED,
      );
      expect(
        recoveredEvents.filter(
          (event) => event.type === RunEventType.RUN_COMPLETED,
        ),
      ).toEqual([]);

      // Starting a retry proves execution still works, while the old run must
      // stay byte-for-byte unchanged even as the new run commits samples.
      const retryId = await startRun(
        recoveredApi,
        session,
        `sigkill-retry-${randomUUID()}`,
      );
      expect(retryId).not.toBe(runId);
      await waitForMeasurements(retryId, 1);

      const afterRetry = await prisma.testRun.findUniqueOrThrow({
        where: { id: runId },
        include: { steps: { orderBy: { position: 'asc' } } },
      });
      expect(afterRetry).toMatchObject({
        status: RunStatus.INTERRUPTED,
        outcome: null,
        reasonCode: 'SERVER_RESTART',
        recordedSampleCount: before.recordedSampleCount,
        expectedSampleCount: before.expectedSampleCount,
        finishedAt: recovered.finishedAt,
        eventSequence: recovered.eventSequence,
      });
      expect(
        afterRetry.steps.map((step) => ({
          id: step.id,
          position: step.position,
          status: step.status,
          outcome: step.outcome,
          recordedCount: step.recordedCount,
          startedAt: step.startedAt,
          finishedAt: step.finishedAt,
        })),
      ).toEqual(recoveredSteps);
      expect(await loadEvents(runId)).toEqual(recoveredEvents);
      expect(await prisma.measurement.count({ where: { runId } })).toBe(
        recoveredMeasurements,
      );

      const cancelRetry = await mutation(
        recoveredApi,
        session,
        'POST',
        `/api/runs/${retryId}/cancel`,
        undefined,
      );
      expect(cancelRetry.status).toBe(200);
      expect(cancelRetry.body).toMatchObject({
        id: retryId,
        status: RunStatus.CANCELLED,
      });

      const afterCancel = await prisma.testRun.findUniqueOrThrow({
        where: { id: runId },
        include: { steps: { orderBy: { position: 'asc' } } },
      });
      expect(afterCancel).toMatchObject({
        status: RunStatus.INTERRUPTED,
        recordedSampleCount: before.recordedSampleCount,
        finishedAt: recovered.finishedAt,
        eventSequence: recovered.eventSequence,
      });
      expect(
        afterCancel.steps.map((step) => ({
          id: step.id,
          position: step.position,
          status: step.status,
          outcome: step.outcome,
          recordedCount: step.recordedCount,
          startedAt: step.startedAt,
          finishedAt: step.finishedAt,
        })),
      ).toEqual(recoveredSteps);
      expect(await loadEvents(runId)).toEqual(recoveredEvents);
    },
    90_000,
  );

  it(
    'leaves the run RUNNING on controlled shutdown and commits no COMPLETED event',
    async () => {
      const api = await startTrackedProcess('sigterm-api');
      const session = await loginToApi(
        api,
        operatorUser.email,
        operatorUser.password,
      );
      const runId = await startRun(api, session, `sigterm-${randomUUID()}`);
      const measurementsBeforeShutdown = await waitForMeasurements(runId, 1);

      const exit = await api.kill('SIGTERM');
      // Nest finishes the shutdown hooks and then re-raises the same signal, so
      // the OS reports the signal rather than a zero exit code.
      expect(exit.signal).toBe('SIGTERM');
      expect(exit.code).toBeNull();

      const leftRunning = await prisma.testRun.findUniqueOrThrow({
        where: { id: runId },
        include: { steps: { orderBy: { position: 'asc' } } },
      });
      expect(leftRunning).toMatchObject({
        status: RunStatus.RUNNING,
        outcome: null,
        finishedAt: null,
        recordedSampleCount: measurementsBeforeShutdown,
      });
      expect(
        await prisma.measurement.count({ where: { runId } }),
      ).toBe(measurementsBeforeShutdown);

      const events = await loadEvents(runId);
      expectGapFree(events);
      expect(
        events.filter((event) => event.type === RunEventType.RUN_COMPLETED),
      ).toEqual([]);

      const recoveryApi = await startTrackedProcess('sigterm-recovery-api');
      const ready = await fetch(`${recoveryApi.baseUrl}/api/health/ready`);
      expect(ready.status).toBe(200);

      const recovered = await prisma.testRun.findUniqueOrThrow({
        where: { id: runId },
      });
      expect(recovered).toMatchObject({
        status: RunStatus.INTERRUPTED,
        outcome: null,
        reasonCode: 'SERVER_RESTART',
        recordedSampleCount: measurementsBeforeShutdown,
      });
      expect(await prisma.measurement.count({ where: { runId } })).toBe(
        measurementsBeforeShutdown,
      );
      expect(
        (await loadEvents(runId)).filter(
          (event) => event.type === RunEventType.RUN_INTERRUPTED,
        ),
      ).toHaveLength(1);
    },
    60_000,
  );
});

function requiredDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL must point at the isolated test database.');
  }
  return url;
}
