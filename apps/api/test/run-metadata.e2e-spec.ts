import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import {
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from '../src/auth/auth.constants.js';
import {
  Role,
  RunScenario,
  RunStatus,
} from '../src/prisma/generated/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { RUN_SCHEDULER } from '../src/runs/run-scheduler.js';
import {
  cookieHeader,
  getCookie,
  readSetCookies,
  type TestUser,
} from './support/auth-helpers.js';
import { createTestApplication } from './support/create-test-application.js';
import {
  createRunMetadataTestDevice,
  createRunMetadataTestProfile,
  createRunMetadataTestUser,
  deleteRunMetadataDevices,
  deleteRunMetadataRuns,
  deleteRunMetadataTestData,
  seedMetadataRun,
  waitForLockWaiter,
} from './support/run-metadata-helpers.js';
import {
  createPublishedRunFixture,
  type PublishedRunFixture,
} from './support/run-helpers.js';
import { ControlledRunScheduler } from './support/run-schedulers.js';

interface ClientSession {
  cookie: string;
  csrfToken: string;
}

interface DeviceSnapshotBody {
  id: string;
  name: string;
  serialNumber: string;
  deviceProfileId: string;
}

interface RunSnapshotBody {
  id: string;
  planId: string;
  planVersionId: string;
  planName: string;
  versionNumber: number;
  deviceId: string | null;
  deviceSnapshot: DeviceSnapshotBody | null;
  batchNumber: string | null;
  scenario: RunScenario;
  status: RunStatus;
  steps: unknown[];
}

interface HistoryItemBody {
  id: string;
  planId: string;
  planVersionId: string;
  deviceId: string | null;
  deviceSnapshot: DeviceSnapshotBody | null;
  batchNumber: string | null;
  scenario: RunScenario;
  startedAt: string;
}

interface HistoryPageBody {
  items: HistoryItemBody[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface RunStartBody {
  runId: string;
  status: RunStatus;
  outcome: string | null;
  snapshotUrl: string;
  eventsUrl: string;
}

interface ComparisonBody {
  leftRun: {
    id: string;
    deviceId: string | null;
    deviceSnapshot: DeviceSnapshotBody | null;
    batchNumber: string | null;
  };
  rightRun: {
    id: string;
    deviceId: string | null;
    deviceSnapshot: DeviceSnapshotBody | null;
    batchNumber: string | null;
  };
}

const HISTORY_ITEM_KEYS = [
  'batchNumber',
  'deviceId',
  'deviceSnapshot',
  'expectedSampleCount',
  'finishedAt',
  'firstFailure',
  'id',
  'outcome',
  'outOfToleranceCount',
  'partial',
  'planId',
  'planName',
  'planVersionId',
  'recordedSampleCount',
  'requestedBy',
  'scenario',
  'seed',
  'startedAt',
  'status',
  'versionNumber',
] as const;

const DEVICE_SNAPSHOT_KEYS = [
  'deviceProfileId',
  'id',
  'name',
  'serialNumber',
] as const;

function runKey(): string {
  return `run-metadata-e2e-${randomUUID()}`;
}

function v1Hash(
  planVersionId: string,
  scenario: RunScenario,
  seed: number,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        'probedesk-run-start-v1',
        planVersionId,
        scenario,
        seed,
        null,
        null,
      ]),
      'utf8',
    )
    .digest('hex');
}

function v2Hash(
  planVersionId: string,
  scenario: RunScenario,
  seed: number,
  deviceId: string | null,
  batchNumberKey: string | null,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        'probedesk-run-start-v2',
        planVersionId,
        scenario,
        seed,
        null,
        null,
        deviceId,
        batchNumberKey,
      ]),
      'utf8',
    )
    .digest('hex');
}

describe('run metadata API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const scheduler = new ControlledRunScheduler('paused');

  let plannerUser: TestUser;
  let operatorUser: TestUser;
  let viewerUser: TestUser;
  let planner: ClientSession;
  let operator: ClientSession;
  let viewer: ClientSession;
  let fixture: PublishedRunFixture;
  let otherFixture: PublishedRunFixture;
  let profile: PublishedRunFixture['profile'];

  const server = () => app.getHttpServer();

  beforeAll(async () => {
    app = await createTestApplication(
      {},
      { overrides: [{ provide: RUN_SCHEDULER, useValue: scheduler }] },
    );
    prisma = app.get(PrismaService);

    await deleteRunMetadataTestData(prisma);

    plannerUser = await createRunMetadataTestUser(prisma, Role.PLANNER);
    operatorUser = await createRunMetadataTestUser(prisma, Role.OPERATOR);
    viewerUser = await createRunMetadataTestUser(prisma, Role.VIEWER);

    profile = await createRunMetadataTestProfile(prisma);
    fixture = await createPublishedRunFixture(prisma, plannerUser.id, profile, {
      planName: 'Run metadata plan',
    });
    otherFixture = await createPublishedRunFixture(
      prisma,
      plannerUser.id,
      profile,
      { planName: 'Run metadata second plan', versionNumber: 2 },
    );

    planner = await login(plannerUser);
    operator = await login(operatorUser);
    viewer = await login(viewerUser);
  });

  afterEach(async () => {
    if (prisma) {
      await deleteRunMetadataRuns(prisma);
    }
  });

  afterAll(async () => {
    try {
      if (prisma) {
        await deleteRunMetadataDevices(prisma);
        await deleteRunMetadataTestData(prisma);
        await prisma.$disconnect();
      }
    } finally {
      if (app) {
        await app.close();
      }
      scheduler.dispose();
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
    session: ClientSession,
    key: string,
    body: Record<string, unknown>,
  ): request.Test {
    return request(server())
      .post('/api/runs')
      .set('Cookie', session.cookie)
      .set('X-XSRF-TOKEN', session.csrfToken)
      .set('Idempotency-Key', key)
      .send(body);
  }

  function getRun(session: ClientSession, runId: string): request.Test {
    return request(server())
      .get(`/api/runs/${runId}`)
      .set('Cookie', session.cookie);
  }

  function listRuns(
    session: ClientSession,
    query: Record<string, string | number> = {},
  ): request.Test {
    return request(server())
      .get('/api/runs')
      .set('Cookie', session.cookie)
      .query(query);
  }

  function patchDevice(
    session: ClientSession,
    deviceId: string,
    body: Record<string, unknown>,
  ): request.Test {
    return request(server())
      .patch(`/api/devices/${deviceId}`)
      .set('Cookie', session.cookie)
      .set('X-XSRF-TOKEN', session.csrfToken)
      .send(body);
  }

  function archiveDevice(
    session: ClientSession,
    deviceId: string,
    expectedRevision: number,
  ): request.Test {
    return request(server())
      .post(`/api/devices/${deviceId}/archive`)
      .set('Cookie', session.cookie)
      .set('X-XSRF-TOKEN', session.csrfToken)
      .send({ expectedRevision });
  }

  async function cancelRun(runId: string): Promise<void> {
    await request(server())
      .post(`/api/runs/${runId}/cancel`)
      .set('Cookie', operator.cookie)
      .set('X-XSRF-TOKEN', operator.csrfToken)
      .expect(200);
  }

  async function readStoredRun(runId: string) {
    return prisma.testRun.findUniqueOrThrow({
      where: { id: runId },
    });
  }

  it('keeps the v1 hash and stores SQL NULL metadata for a device-less run', async () => {
    const key = runKey();
    const response = await postRun(operator, key, normalBody()).expect(202);
    const created = response.body as RunStartBody;

    const run = await readStoredRun(created.runId);
    expect(run.requestHash).toBe(
      v1Hash(fixture.revisionId, RunScenario.NORMAL, 123_456_789),
    );
    expect(run.deviceId).toBeNull();
    expect(run.deviceSnapshot).toBeNull();
    expect(run.batchNumber).toBeNull();
    expect(run.batchNumberKey).toBeNull();

    const raw = await prisma.$queryRaw<
      Array<{
        deviceSnapshotIsNull: boolean;
        batchNumberIsNull: boolean;
      }>
    >`
      SELECT
        "deviceSnapshot" IS NULL AS "deviceSnapshotIsNull",
        "batchNumber" IS NULL AS "batchNumberIsNull"
      FROM "test_runs"
      WHERE "id" = ${created.runId}::uuid
    `;
    expect(raw).toEqual([
      { deviceSnapshotIsNull: true, batchNumberIsNull: true },
    ]);

    const snapshot = (await getRun(viewer, created.runId).expect(200))
      .body as RunSnapshotBody;
    expect(snapshot.deviceId).toBeNull();
    expect(snapshot.deviceSnapshot).toBeNull();
    expect(snapshot.batchNumber).toBeNull();
    expect(snapshot.steps).toHaveLength(fixture.steps.length);

    const history = (await listRuns(viewer).expect(200))
      .body as HistoryPageBody;
    const item = history.items.find((entry) => entry.id === created.runId)!;
    expect(item).toMatchObject({
      deviceId: null,
      deviceSnapshot: null,
      batchNumber: null,
    });
    expect(Object.keys(item).sort()).toEqual([...HISTORY_ITEM_KEYS].sort());
    expect(item).not.toHaveProperty('steps');
    expect(item).not.toHaveProperty('measurements');

    await cancelRun(created.runId);
  });

  it('copies active device values and canonicalizes batch without a live join', async () => {
    const device = await createRunMetadataTestDevice(prisma, {
      deviceProfileId: profile.id,
      createdById: plannerUser.id,
      name: '  Bench A  ',
      serialNumber: 'META-AbC/01',
    });
    const key = runKey();
    const response = await postRun(
      operator,
      key,
      normalBody({
        deviceId: device.id.toUpperCase(),
        batchNumber: '  Batch-AbC/01  ',
      }),
    ).expect(202);
    const created = response.body as RunStartBody;

    const run = await readStoredRun(created.runId);
    expect(run.deviceId).toBe(device.id);
    expect(run.deviceSnapshot).toEqual({
      id: device.id,
      name: 'Bench A',
      serialNumber: 'META-AbC/01',
      deviceProfileId: profile.id,
    });
    expect(run.batchNumber).toBe('Batch-AbC/01');
    expect(run.batchNumberKey).toBe('BATCH-ABC/01');
    expect(run.requestHash).toBe(
      v2Hash(
        fixture.revisionId,
        RunScenario.NORMAL,
        123_456_789,
        device.id,
        'BATCH-ABC/01',
      ),
    );

    const snapshot = (await getRun(viewer, created.runId).expect(200))
      .body as RunSnapshotBody;
    expect(snapshot.deviceId).toBe(device.id);
    expect(snapshot.deviceSnapshot).toEqual(run.deviceSnapshot);
    expect(Object.keys(snapshot.deviceSnapshot!).sort()).toEqual(
      [...DEVICE_SNAPSHOT_KEYS].sort(),
    );
    expect(snapshot.batchNumber).toBe('Batch-AbC/01');
    expect(JSON.stringify(snapshot)).not.toContain('batchNumberKey');

    await cancelRun(created.runId);
  });

  it('allows batch metadata without a device and hashes it with the v2 marker', async () => {
    const key = runKey();
    const response = await postRun(
      operator,
      key,
      normalBody({ batchNumber: ' Batch-Only/7 ' }),
    ).expect(202);
    const created = response.body as RunStartBody;

    const run = await readStoredRun(created.runId);
    expect(run.deviceId).toBeNull();
    expect(run.deviceSnapshot).toBeNull();
    expect(run.batchNumber).toBe('Batch-Only/7');
    expect(run.batchNumberKey).toBe('BATCH-ONLY/7');
    expect(run.requestHash).toBe(
      v2Hash(
        fixture.revisionId,
        RunScenario.NORMAL,
        123_456_789,
        null,
        'BATCH-ONLY/7',
      ),
    );

    const snapshot = (await getRun(viewer, created.runId).expect(200))
      .body as RunSnapshotBody;
    expect(snapshot.deviceId).toBeNull();
    expect(snapshot.deviceSnapshot).toBeNull();
    expect(snapshot.batchNumber).toBe('Batch-Only/7');

    await cancelRun(created.runId);
  });

  it('rejects unknown, archived and profile-mismatched devices without writing a run', async () => {
    const archived = await createRunMetadataTestDevice(prisma, {
      deviceProfileId: profile.id,
      createdById: plannerUser.id,
      name: 'Archived Bench',
      serialNumber: 'META-ARCH/01',
      archivedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const otherProfile = await createRunMetadataTestProfile(prisma);
    const mismatched = await createRunMetadataTestDevice(prisma, {
      deviceProfileId: otherProfile.id,
      createdById: plannerUser.id,
      name: 'Other Profile Bench',
      serialNumber: 'META-OTHER/01',
    });

    const unknown = await postRun(
      operator,
      runKey(),
      normalBody({ deviceId: randomUUID() }),
    ).expect(404);
    expect(unknown.body).toMatchObject({ code: 'NOT_FOUND' });

    const archivedResponse = await postRun(
      operator,
      runKey(),
      normalBody({ deviceId: archived.id }),
    ).expect(409);
    expect(archivedResponse.body).toMatchObject({ code: 'DEVICE_ARCHIVED' });

    const mismatchResponse = await postRun(
      operator,
      runKey(),
      normalBody({ deviceId: mismatched.id }),
    ).expect(422);
    expect(mismatchResponse.body).toMatchObject({
      code: 'DEVICE_PROFILE_MISMATCH',
    });

    const badBatch = await postRun(
      operator,
      runKey(),
      normalBody({ batchNumber: 'BATCH WITH SPACE' }),
    ).expect(400);
    expect(
      (badBatch.body as { fieldErrors?: Array<{ path: string }> }).fieldErrors,
    ).toContainEqual(expect.objectContaining({ path: 'batchNumber' }));

    const badDevice = await postRun(
      operator,
      runKey(),
      normalBody({ deviceId: 'not-a-uuid' }),
    ).expect(400);
    expect(
      (badDevice.body as { fieldErrors?: Array<{ path: string }> }).fieldErrors,
    ).toContainEqual(expect.objectContaining({ path: 'deviceId' }));

    expect(
      await prisma.testRun.count({
        where: { requestedById: operatorUser.id },
      }),
    ).toBe(0);
  });

  it('replays after device rename and archive but conflicts on different metadata', async () => {
    const device = await createRunMetadataTestDevice(prisma, {
      deviceProfileId: profile.id,
      createdById: plannerUser.id,
      name: 'Original Bench',
      serialNumber: 'META-IDEM/01',
    });
    const otherDevice = await createRunMetadataTestDevice(prisma, {
      deviceProfileId: profile.id,
      createdById: plannerUser.id,
      name: 'Other Bench',
      serialNumber: 'META-IDEM/02',
    });
    const key = runKey();
    const created = (
      await postRun(
        operator,
        key,
        normalBody({
          deviceId: device.id.toUpperCase(),
          batchNumber: 'Batch-AbC/01',
        }),
      ).expect(202)
    ).body as RunStartBody;

    const renamed = await patchDevice(planner, device.id, {
      expectedRevision: 1,
      name: 'Renamed Bench',
      serialNumber: 'META-IDEM/99',
    }).expect(200);
    expect(renamed.body).toMatchObject({
      name: 'Renamed Bench',
      serialNumber: 'META-IDEM/99',
      editRevision: 2,
    });

    const archived = await archiveDevice(
      planner,
      device.id,
      (renamed.body as { editRevision: number }).editRevision,
    ).expect(200);
    expect(archived.body).toMatchObject({ editRevision: 3 });
    expect((archived.body as { archivedAt: string | null }).archivedAt).toEqual(
      expect.any(String),
    );

    const replay = await postRun(
      operator,
      key,
      normalBody({
        deviceId: device.id.toUpperCase(),
        batchNumber: 'batch-abc/01',
      }),
    ).expect(200);
    expect((replay.body as RunStartBody).runId).toBe(created.runId);

    const snapshot = (await getRun(viewer, created.runId).expect(200))
      .body as RunSnapshotBody;
    expect(snapshot.deviceSnapshot).toEqual({
      id: device.id,
      name: 'Original Bench',
      serialNumber: 'META-IDEM/01',
      deviceProfileId: profile.id,
    });

    const differentBatch = await postRun(
      operator,
      key,
      normalBody({
        deviceId: device.id,
        batchNumber: 'Batch-Other/02',
      }),
    ).expect(409);
    expect(differentBatch.body).toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
      details: { reason: 'REQUEST_MISMATCH' },
    });

    const differentDevice = await postRun(
      operator,
      key,
      normalBody({
        deviceId: otherDevice.id,
        batchNumber: 'Batch-AbC/01',
      }),
    ).expect(409);
    expect(differentDevice.body).toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
      details: { reason: 'REQUEST_MISMATCH' },
    });

    // A new key does not bypass the archived-device rule, even while the first
    // run is still RUNNING.
    const archivedNewStart = await postRun(
      operator,
      runKey(),
      normalBody({ deviceId: device.id }),
    ).expect(409);
    expect(archivedNewStart.body).toMatchObject({ code: 'DEVICE_ARCHIVED' });

    await cancelRun(created.runId);
  });

  it('filters history by device, canonical batch, version and scenario with stable paging', async () => {
    const deviceA = await createRunMetadataTestDevice(prisma, {
      deviceProfileId: profile.id,
      createdById: plannerUser.id,
      name: 'Filter Bench A',
      serialNumber: 'META-FILTER/01',
    });
    const deviceB = await createRunMetadataTestDevice(prisma, {
      deviceProfileId: profile.id,
      createdById: plannerUser.id,
      name: 'Filter Bench B',
      serialNumber: 'META-FILTER/02',
    });

    const runA = await seedMetadataRun(prisma, {
      fixture,
      requestedById: operatorUser.id,
      startedAt: '2026-02-01T00:00:00.000Z',
      device: snapshotOf(deviceA),
      batchNumber: 'Batch-A',
    });
    const runB = await seedMetadataRun(prisma, {
      fixture,
      requestedById: operatorUser.id,
      startedAt: '2026-02-02T00:00:00.000Z',
      device: snapshotOf(deviceA),
      batchNumber: 'Batch-B',
    });
    const runC = await seedMetadataRun(prisma, {
      fixture,
      requestedById: operatorUser.id,
      startedAt: '2026-02-03T00:00:00.000Z',
      device: snapshotOf(deviceB),
      batchNumber: null,
    });

    const byDeviceAndBatch = (
      await listRuns(viewer, {
        deviceId: deviceA.id.toUpperCase(),
        batchNumber: ' batch-a ',
      }).expect(200)
    ).body as HistoryPageBody;
    expect(byDeviceAndBatch.total).toBe(1);
    expect(byDeviceAndBatch.totalPages).toBe(1);
    expect(byDeviceAndBatch.items.map((item) => item.id)).toEqual([runA.id]);
    expect(byDeviceAndBatch.items[0]).toMatchObject({
      deviceId: deviceA.id,
      deviceSnapshot: snapshotOf(deviceA),
      batchNumber: 'Batch-A',
    });

    const byDevice = (
      await listRuns(viewer, { deviceId: deviceA.id }).expect(200)
    ).body as HistoryPageBody;
    expect(byDevice.items.map((item) => item.id)).toEqual([runB.id, runA.id]);

    const byVersionScenario = (
      await listRuns(viewer, {
        planVersionId: fixture.revisionId,
        scenario: RunScenario.NORMAL,
      }).expect(200)
    ).body as HistoryPageBody;
    expect(byVersionScenario.items.map((item) => item.id).sort()).toEqual(
      [runA.id, runB.id, runC.id].sort(),
    );

    const secondPage = (
      await listRuns(viewer, {
        deviceId: deviceA.id,
        page: 2,
        limit: 1,
      }).expect(200)
    ).body as HistoryPageBody;
    expect(secondPage).toMatchObject({
      page: 2,
      limit: 1,
      total: 2,
      totalPages: 2,
    });
    expect(secondPage.items.map((item) => item.id)).toEqual([runA.id]);

    const halfOpenRange = (
      await listRuns(viewer, {
        from: '2026-02-02',
        to: '2026-02-03',
      }).expect(200)
    ).body as HistoryPageBody;
    expect(halfOpenRange.items.map((item) => item.id)).toEqual([runB.id]);

    const emptyFilterQueries: Array<Record<string, string>> = [
      { deviceId: randomUUID() },
      { planVersionId: randomUUID() },
      { batchNumber: 'NO-SUCH-BATCH' },
    ];
    for (const query of emptyFilterQueries) {
      const empty = (await listRuns(viewer, query).expect(200))
        .body as HistoryPageBody;
      expect(empty).toMatchObject({
        items: [],
        page: 1,
        total: 0,
        totalPages: 0,
      });
    }

    const mismatch = await listRuns(viewer, {
      planId: fixture.planId,
      planVersionId: otherFixture.revisionId,
    }).expect(400);
    expect(
      (mismatch.body as { fieldErrors?: Array<{ path: string }> }).fieldErrors,
    ).toContainEqual(expect.objectContaining({ path: 'planVersionId' }));

    const unknownVersionWithPlan = (
      await listRuns(viewer, {
        planId: fixture.planId,
        planVersionId: randomUUID(),
      }).expect(200)
    ).body as HistoryPageBody;
    expect(unknownVersionWithPlan.total).toBe(0);

    // Metadata is copied at start, so renaming a device does not rewrite
    // history rows.
    await patchDevice(planner, deviceA.id, {
      expectedRevision: 1,
      name: 'Filter Bench A renamed',
    }).expect(200);

    const afterRename = (
      await listRuns(viewer, { deviceId: deviceA.id }).expect(200)
    ).body as HistoryPageBody;
    expect(afterRename.items.map((item) => item.id)).toEqual([
      runB.id,
      runA.id,
    ]);
    expect(afterRename.items.map((item) => item.deviceSnapshot?.name)).toEqual([
      'Filter Bench A',
      'Filter Bench A',
    ]);
  });

  it('projects stored metadata into comparison summaries without joining the live device', async () => {
    const device = await createRunMetadataTestDevice(prisma, {
      deviceProfileId: profile.id,
      createdById: plannerUser.id,
      name: 'Compare Original',
      serialNumber: 'META-COMPARE/01',
    });
    const left = await seedMetadataRun(prisma, {
      fixture,
      requestedById: operatorUser.id,
      startedAt: '2026-02-10T00:00:00.000Z',
      device: snapshotOf(device),
      batchNumber: 'Batch-Left',
    });
    const right = await seedMetadataRun(prisma, {
      fixture,
      requestedById: operatorUser.id,
      startedAt: '2026-02-11T00:00:00.000Z',
      device: null,
      batchNumber: 'Batch-Right',
    });

    await patchDevice(planner, device.id, {
      expectedRevision: 1,
      name: 'Compare Renamed',
      serialNumber: 'META-COMPARE/99',
    }).expect(200);

    const comparison = (
      await request(server())
        .get('/api/comparisons')
        .set('Cookie', viewer.cookie)
        .query({ leftRunId: left.id, rightRunId: right.id })
        .expect(200)
    ).body as ComparisonBody;

    expect(comparison.leftRun).toMatchObject({
      id: left.id,
      deviceId: device.id,
      deviceSnapshot: snapshotOf(device),
      batchNumber: 'Batch-Left',
    });
    expect(comparison.rightRun).toMatchObject({
      id: right.id,
      deviceId: null,
      deviceSnapshot: null,
      batchNumber: 'Batch-Right',
    });

    const snapshot = (await getRun(viewer, left.id).expect(200))
      .body as RunSnapshotBody;
    expect(snapshot.deviceSnapshot).toEqual(snapshotOf(device));
  });

  it('serializes a real concurrent start and archive on the same device row', async () => {
    const device = await createRunMetadataTestDevice(prisma, {
      deviceProfileId: profile.id,
      createdById: plannerUser.id,
      name: 'Race Bench',
      serialNumber: 'META-RACE/01',
    });

    const lockClient = new Client({
      connectionString: process.env.DATABASE_URL,
      application_name: 'run-metadata-race-lock',
    });
    await lockClient.connect();

    try {
      await lockClient.query('BEGIN');
      await lockClient.query(
        'SELECT "id" FROM "devices" WHERE "id" = $1::uuid FOR UPDATE',
        [device.id],
      );

      const startRequest = postRun(
        operator,
        runKey(),
        normalBody({ deviceId: device.id, batchNumber: 'Batch-Race' }),
      ).then((response) => response);

      // The start transaction must be the first queued lock waiter, so the
      // archive request exercises the FOR UPDATE vs FOR SHARE ordering.
      await waitForLockWaiter(prisma, 'FOR SHARE');

      const archiveRequest = archiveDevice(planner, device.id, 1).then(
        (response) => response,
      );
      await waitForLockWaiter(prisma, 'FOR UPDATE');

      await lockClient.query('COMMIT');

      const started = await startRequest;
      expect(started.status).toBe(202);
      expect(started.body).toMatchObject({
        status: RunStatus.RUNNING,
      });

      const archived = await archiveRequest;
      expect(archived.status).toBe(200);
      expect(
        (archived.body as { archivedAt: string | null }).archivedAt,
      ).toEqual(expect.any(String));

      const runId = (started.body as RunStartBody).runId;
      const stored = await readStoredRun(runId);
      expect(stored.deviceSnapshot).toEqual({
        id: device.id,
        name: 'Race Bench',
        serialNumber: 'META-RACE/01',
        deviceProfileId: profile.id,
      });

      const snapshot = (await getRun(viewer, runId).expect(200))
        .body as RunSnapshotBody;
      expect(snapshot.deviceSnapshot).toEqual(stored.deviceSnapshot);

      await cancelRun(runId);
    } finally {
      await lockClient.query('ROLLBACK').catch(() => undefined);
      await lockClient.end();
    }
  });
});

function snapshotOf(device: {
  id: string;
  name: string;
  serialNumber: string;
  deviceProfileId: string;
}): DeviceSnapshotBody {
  return {
    id: device.id,
    name: device.name,
    serialNumber: device.serialNumber,
    deviceProfileId: device.deviceProfileId,
  };
}
