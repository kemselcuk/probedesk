import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from '../src/auth/auth.constants.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { Role } from '../src/prisma/generated/client.js';
import { createTestApplication } from './support/create-test-application.js';
import {
  cookieHeader,
  getCookie,
  readSetCookies,
  type TestUser,
} from './support/auth-helpers.js';
import {
  createDeviceTestProfile,
  createDeviceTestUser,
  deleteDeviceTestData,
} from './support/device-helpers.js';

interface DeviceBody {
  id: string;
  deviceProfileId: string;
  name: string;
  serialNumber: string;
  description: string | null;
  archivedAt: string | null;
  editRevision: number;
  createdAt: string;
  updatedAt: string;
}

interface DeviceListBody {
  items: DeviceBody[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface ClientSession {
  cookie: string;
  csrfToken: string;
}

interface CreateDeviceRequest {
  deviceProfileId?: string;
  name: string;
  serialNumber: string;
  description?: string | null;
}

function createPayload(
  overrides: Partial<CreateDeviceRequest> = {},
): CreateDeviceRequest {
  return {
    deviceProfileId: '',
    name: 'Bench Power Module',
    serialNumber: `SN-${randomUUID()}`,
    description: 'Fixture device',
    ...overrides,
  };
}

function readFieldErrors(body: Record<string, unknown>): Array<{
  path: string;
  code: string;
  message: string;
}> {
  return body.fieldErrors as Array<{
    path: string;
    code: string;
    message: string;
  }>;
}

describe('devices API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let plannerUser: TestUser;
  let operatorUser: TestUser;
  let viewerUser: TestUser;
  let profile: {
    id: string;
    code: string;
    name: string;
    description: string | null;
  };
  let planner: ClientSession;
  let operator: ClientSession;
  let viewer: ClientSession;

  const server = () => app.getHttpServer();

  beforeAll(async () => {
    app = await createTestApplication();
    prisma = app.get(PrismaService);

    await deleteDeviceTestData(prisma);

    plannerUser = await createDeviceTestUser(prisma, Role.PLANNER);
    operatorUser = await createDeviceTestUser(prisma, Role.OPERATOR);
    viewerUser = await createDeviceTestUser(prisma, Role.VIEWER);
    profile = await createDeviceTestProfile(prisma);

    planner = await login(plannerUser);
    operator = await login(operatorUser);
    viewer = await login(viewerUser);
  });

  beforeEach(async () => {
    await prisma.device.deleteMany({
      where: { createdById: plannerUser.id },
    });
  });

  afterAll(async () => {
    if (prisma) {
      await deleteDeviceTestData(prisma);
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

  function getAs(session: ClientSession, path: string): request.Test {
    return request(server()).get(path).set('Cookie', session.cookie);
  }

  function postAs(session: ClientSession, path: string): request.Test {
    return request(server())
      .post(path)
      .set('Cookie', session.cookie)
      .set('X-XSRF-TOKEN', session.csrfToken);
  }

  function patchAs(session: ClientSession, path: string): request.Test {
    return request(server())
      .patch(path)
      .set('Cookie', session.cookie)
      .set('X-XSRF-TOKEN', session.csrfToken);
  }

  async function createDevice(
    overrides: Partial<CreateDeviceRequest> = {},
  ): Promise<DeviceBody> {
    const response = await postAs(planner, '/api/devices')
      .send(createPayload({ deviceProfileId: profile.id, ...overrides }))
      .expect(201);

    return response.body as DeviceBody;
  }

  /**
   * The dedicated test database may also contain the additive demo seed.
   * Scoping list assertions to this suite's profile keeps them independent of
   * that intentionally shared fixture.
   */
  function deviceListPath(
    params: Record<string, string | number> = {},
  ): string {
    const search = new URLSearchParams({
      deviceProfileId: profile.id,
      ...Object.fromEntries(
        Object.entries(params).map(([key, value]) => [key, String(value)]),
      ),
    });
    return `/api/devices?${search.toString()}`;
  }

  async function getDevice(id: string): Promise<DeviceBody> {
    const response = await getAs(planner, `/api/devices/${id}`).expect(200);
    return response.body as DeviceBody;
  }

  async function createDeviceDirect(options: {
    id?: string;
    name?: string;
    serialNumber?: string;
    description?: string | null;
    archivedAt?: Date | null;
  }): Promise<{ id: string; name: string; serialNumber: string }> {
    const serialNumber = options.serialNumber ?? `SN-${randomUUID()}`;
    return prisma.device.create({
      data: {
        ...(options.id === undefined ? {} : { id: options.id }),
        deviceProfileId: profile.id,
        createdById: plannerUser.id,
        name: options.name ?? 'Direct fixture device',
        serialNumber,
        serialNumberKey: serialNumber.toUpperCase(),
        description: options.description ?? null,
        archivedAt: options.archivedAt ?? null,
      },
      select: { id: true, name: true, serialNumber: true },
    });
  }

  describe('authentication, roles and CSRF', () => {
    it('rejects unauthenticated reads and mutations', async () => {
      const list = await request(server()).get('/api/devices').expect(401);
      expect(list.body).toMatchObject({ code: 'UNAUTHENTICATED' });

      const detail = await request(server())
        .get(`/api/devices/${randomUUID()}`)
        .expect(401);
      expect(detail.body).toMatchObject({ code: 'UNAUTHENTICATED' });

      const create = await request(server())
        .post('/api/devices')
        .send(createPayload({ deviceProfileId: profile.id }))
        .expect(401);
      expect(create.body).toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('allows every role to read and only a Planner to mutate', async () => {
      const device = await createDevice();

      for (const session of [planner, operator, viewer]) {
        const list = await getAs(session, deviceListPath()).expect(200);
        expect((list.body as DeviceListBody).items).toContainEqual(
          expect.objectContaining({ id: device.id }),
        );

        const detail = await getAs(session, `/api/devices/${device.id}`).expect(
          200,
        );
        expect(detail.body).toMatchObject({ id: device.id });
      }

      for (const session of [operator, viewer]) {
        const create = await postAs(session, '/api/devices')
          .send(createPayload({ deviceProfileId: profile.id }))
          .expect(403);
        expect(create.body).toMatchObject({ code: 'FORBIDDEN' });

        const update = await patchAs(session, `/api/devices/${device.id}`)
          .send({ expectedRevision: 1, name: 'Forbidden rename' })
          .expect(403);
        expect(update.body).toMatchObject({ code: 'FORBIDDEN' });

        const archive = await postAs(
          session,
          `/api/devices/${device.id}/archive`,
        )
          .send({ expectedRevision: 1 })
          .expect(403);
        expect(archive.body).toMatchObject({ code: 'FORBIDDEN' });

        const restore = await postAs(
          session,
          `/api/devices/${device.id}/restore`,
        )
          .send({ expectedRevision: 1 })
          .expect(403);
        expect(restore.body).toMatchObject({ code: 'FORBIDDEN' });
      }

      expect(await getDevice(device.id)).toMatchObject({
        name: device.name,
        editRevision: 1,
        archivedAt: null,
      });
    });

    it('rejects a Planner mutation without the CSRF header', async () => {
      const response = await request(server())
        .post('/api/devices')
        .set('Cookie', planner.cookie)
        .send(createPayload({ deviceProfileId: profile.id }))
        .expect(403);

      expect(response.body).toMatchObject({ code: 'FORBIDDEN' });
      expect(response.body.message).toMatch(/CSRF/i);
      expect(
        await prisma.device.count({ where: { createdById: plannerUser.id } }),
      ).toBe(0);
    });
  });

  describe('POST /devices', () => {
    it('creates a trimmed device with a canonical unique key and no secret fields', async () => {
      const response = await postAs(planner, '/api/devices')
        .send({
          deviceProfileId: profile.id,
          name: '  Bench Power Module  ',
          serialNumber: '  PSU-AbC/01  ',
          description: '  Primary unit  ',
        })
        .expect(201);

      const body = response.body as DeviceBody;
      expect(body).toMatchObject({
        deviceProfileId: profile.id,
        name: 'Bench Power Module',
        serialNumber: 'PSU-AbC/01',
        description: 'Primary unit',
        archivedAt: null,
        editRevision: 1,
      });
      expect(body.id).toEqual(expect.any(String));
      expect(body.createdAt).toEqual(expect.any(String));
      expect(body.updatedAt).toEqual(expect.any(String));
      expect(Object.keys(body).sort()).toEqual([
        'archivedAt',
        'createdAt',
        'description',
        'deviceProfileId',
        'editRevision',
        'id',
        'name',
        'serialNumber',
        'updatedAt',
      ]);
      expect(JSON.stringify(body)).not.toContain('serialNumberKey');
      expect(JSON.stringify(body)).not.toContain('createdBy');

      const stored = await prisma.device.findUniqueOrThrow({
        where: { id: body.id },
      });
      expect(stored).toMatchObject({
        createdById: plannerUser.id,
        deviceProfileId: profile.id,
        serialNumber: 'PSU-AbC/01',
        serialNumberKey: 'PSU-ABC/01',
        description: 'Primary unit',
        editRevision: 1,
      });
    });

    it('stores an empty description as null', async () => {
      const body = await createDevice({ description: '   ' });
      expect(body.description).toBeNull();

      const stored = await prisma.device.findUniqueOrThrow({
        where: { id: body.id },
      });
      expect(stored.description).toBeNull();
    });

    it('rejects invalid fields and unknown profile ids without writing', async () => {
      const invalidPayloads: Array<{
        payload: Record<string, unknown>;
        path: string;
      }> = [
        {
          payload: {
            deviceProfileId: profile.id,
            name: '   ',
            serialNumber: 'SN-1',
          },
          path: 'name',
        },
        {
          payload: {
            deviceProfileId: profile.id,
            name: 'x'.repeat(101),
            serialNumber: 'SN-1',
          },
          path: 'name',
        },
        {
          payload: {
            deviceProfileId: profile.id,
            name: 'Valid',
            serialNumber: 'SN WITH SPACE',
          },
          path: 'serialNumber',
        },
        {
          payload: {
            deviceProfileId: profile.id,
            name: 'Valid',
            serialNumber: 'x'.repeat(101),
          },
          path: 'serialNumber',
        },
        {
          payload: {
            deviceProfileId: profile.id,
            name: 'Valid',
            serialNumber: 'SN-1',
            description: 'x'.repeat(501),
          },
          path: 'description',
        },
        {
          payload: {
            deviceProfileId: randomUUID(),
            name: 'Valid',
            serialNumber: 'SN-1',
          },
          path: 'deviceProfileId',
        },
        {
          payload: {
            deviceProfileId: profile.id,
            name: 'Valid',
            serialNumber: 'SN-1',
            createdById: randomUUID(),
          },
          path: 'createdById',
        },
      ];

      for (const { payload, path } of invalidPayloads) {
        const response = await postAs(planner, '/api/devices')
          .send(payload)
          .expect(400);

        expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
        expect(readFieldErrors(response.body)).toContainEqual(
          expect.objectContaining({ path }),
        );
      }

      expect(
        await prisma.device.count({ where: { createdById: plannerUser.id } }),
      ).toBe(0);
    });

    it('returns DEVICE_SERIAL_CONFLICT for a canonical duplicate', async () => {
      const device = await createDevice({ serialNumber: 'PSU-AbC-001' });

      const response = await postAs(planner, '/api/devices')
        .send({
          deviceProfileId: profile.id,
          name: 'Duplicate serial',
          serialNumber: 'psu-abc-001',
        })
        .expect(409);

      expect(response.body).toMatchObject({ code: 'DEVICE_SERIAL_CONFLICT' });
      expect(
        await prisma.device.count({ where: { createdById: plannerUser.id } }),
      ).toBe(1);
      expect((await getDevice(device.id)).serialNumber).toBe('PSU-AbC-001');
    });

    it('serialises two concurrent creates with the same canonical serial', async () => {
      const payload = {
        deviceProfileId: profile.id,
        name: 'Race device',
        serialNumber: 'RACE-SERIAL-01',
      };

      const responses = await Promise.all([
        postAs(planner, '/api/devices').send(payload),
        postAs(planner, '/api/devices').send({
          ...payload,
          serialNumber: 'race-serial-01',
        }),
      ]);

      const statuses = responses
        .map((response) => response.status)
        .sort((left, right) => left - right);
      expect(statuses).toEqual([201, 409]);
      const conflict = responses.find((response) => response.status === 409);
      expect(conflict?.body).toMatchObject({
        code: 'DEVICE_SERIAL_CONFLICT',
      });

      const stored = await prisma.device.findMany({
        where: {
          createdById: plannerUser.id,
          serialNumberKey: 'RACE-SERIAL-01',
        },
      });
      expect(stored).toHaveLength(1);
    });
  });

  describe('GET /devices', () => {
    it('paginates with a stable name ASC, id ASC order', async () => {
      await prisma.device.createMany({
        data: Array.from({ length: 25 }, (_, index) => ({
          deviceProfileId: profile.id,
          createdById: plannerUser.id,
          name: `Device ${String(index + 1).padStart(2, '0')}`,
          serialNumber: `PAGE-${String(index + 1).padStart(2, '0')}`,
          serialNumberKey: `PAGE-${String(index + 1).padStart(2, '0')}`,
        })),
      });

      const first = await getAs(planner, deviceListPath()).expect(200);
      const firstBody = first.body as DeviceListBody;
      expect(firstBody).toMatchObject({
        page: 1,
        limit: 20,
        total: 25,
        totalPages: 2,
      });
      expect(firstBody.items).toHaveLength(20);
      expect(firstBody.items.map((item) => item.name)).toEqual(
        Array.from(
          { length: 20 },
          (_, index) => `Device ${String(index + 1).padStart(2, '0')}`,
        ),
      );

      const second = await getAs(
        planner,
        deviceListPath({ page: 2, limit: 20 }),
      ).expect(200);
      const secondBody = second.body as DeviceListBody;
      expect(secondBody.items).toHaveLength(5);
      expect(secondBody).toMatchObject({
        page: 2,
        limit: 20,
        total: 25,
        totalPages: 2,
      });

      const beyond = await getAs(
        planner,
        deviceListPath({ page: 3, limit: 20 }),
      ).expect(200);
      expect(beyond.body).toMatchObject({
        items: [],
        page: 3,
        limit: 20,
        total: 25,
        totalPages: 2,
      });

      const invalidQueries: Array<Record<string, string | number>> = [
        { page: 0 },
        { limit: 0 },
        { limit: 101 },
        { page: 1.5 },
        { unknown: 'value' },
      ];
      for (const params of invalidQueries) {
        const response = await getAs(planner, deviceListPath(params)).expect(
          400,
        );
        expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
      }
    });

    it('breaks equal names by id ascending', async () => {
      const lowerId = '00000000-0000-4000-8000-000000000001';
      const higherId = '00000000-0000-4000-8000-000000000002';
      await createDeviceDirect({
        id: higherId,
        name: 'Same name',
        serialNumber: 'SORT-2',
      });
      await createDeviceDirect({
        id: lowerId,
        name: 'Same name',
        serialNumber: 'SORT-1',
      });

      const response = await getAs(
        planner,
        deviceListPath({ q: 'Same' }),
      ).expect(200);
      expect(
        (response.body as DeviceListBody).items.map((item) => item.id),
      ).toEqual([lowerId, higherId]);
    });

    it('filters active, archived and all devices', async () => {
      const active = await createDeviceDirect({ name: 'Active device' });
      const archived = await createDeviceDirect({
        name: 'Archived device',
        archivedAt: new Date('2026-11-06T10:00:00.000Z'),
      });

      const activeList = await getAs(planner, deviceListPath()).expect(200);
      expect(
        (activeList.body as DeviceListBody).items.map((item) => item.id),
      ).toEqual([active.id]);

      const archivedList = await getAs(
        planner,
        deviceListPath({ state: 'archived' }),
      ).expect(200);
      expect(
        (archivedList.body as DeviceListBody).items.map((item) => item.id),
      ).toEqual([archived.id]);

      const all = await getAs(planner, deviceListPath({ state: 'all' })).expect(
        200,
      );
      expect(
        (all.body as DeviceListBody).items.map((item) => item.id).sort(),
      ).toEqual([active.id, archived.id].sort());

      const invalid = await getAs(
        planner,
        deviceListPath({ state: 'deleted' }),
      ).expect(400);
      expect(invalid.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('searches name and serial prefixes case-insensitively with literal wildcards', async () => {
      await createDeviceDirect({
        name: 'Alpha One',
        serialNumber: 'SN-ALPHA-1',
      });
      await createDeviceDirect({
        name: 'alpha Two',
        serialNumber: 'SN-ALPHA-2',
      });
      await createDeviceDirect({
        name: 'Beta Rig',
        serialNumber: 'SN-BETA-1',
      });
      await createDeviceDirect({
        name: '100% Rig',
        serialNumber: 'SN-PERCENT-1',
      });
      await createDeviceDirect({
        name: '100X Rig',
        serialNumber: 'SN-PERCENT-2',
      });
      await createDeviceDirect({
        name: 'under_score',
        serialNumber: 'SN-UNDER-1',
      });
      await createDeviceDirect({
        name: 'underXscore',
        serialNumber: 'SN-UNDER-2',
      });

      const byName = await getAs(
        planner,
        deviceListPath({ q: 'ALPHA' }),
      ).expect(200);
      expect(
        (byName.body as DeviceListBody).items.map((item) => item.name),
      ).toEqual(['Alpha One', 'alpha Two']);

      const bySerial = await getAs(
        planner,
        deviceListPath({ q: 'sn-alpha' }),
      ).expect(200);
      expect(
        (bySerial.body as DeviceListBody).items.map((item) => item.name),
      ).toEqual(['Alpha One', 'alpha Two']);

      const percent = await getAs(
        planner,
        deviceListPath({ q: '100%' }),
      ).expect(200);
      expect(
        (percent.body as DeviceListBody).items.map((item) => item.name),
      ).toEqual(['100% Rig']);

      const underscore = await getAs(
        planner,
        deviceListPath({ q: 'under_' }),
      ).expect(200);
      expect(
        (underscore.body as DeviceListBody).items.map((item) => item.name),
      ).toEqual(['under_score']);

      const trimmed = await getAs(
        planner,
        deviceListPath({ q: '  alpha  ' }),
      ).expect(200);
      expect((trimmed.body as DeviceListBody).items).toHaveLength(2);

      const tooLong = await getAs(
        planner,
        deviceListPath({ q: 'a'.repeat(101) }),
      ).expect(400);
      expect(tooLong.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('returns an empty page for an unknown profile filter', async () => {
      await createDeviceDirect({ name: 'Profile device' });

      const response = await getAs(
        planner,
        `/api/devices?deviceProfileId=${randomUUID()}`,
      ).expect(200);

      expect(response.body).toEqual({
        items: [],
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      });
    });
  });

  describe('PATCH /devices/:id', () => {
    it('updates mutable fields, preserves the profile and increments the revision', async () => {
      const device = await createDevice({
        name: 'Old name',
        serialNumber: 'OLD-SERIAL',
        description: 'Old description',
      });

      const response = await patchAs(planner, `/api/devices/${device.id}`)
        .send({
          expectedRevision: 1,
          name: '  New name  ',
          serialNumber: '  New-Serial  ',
          description: '  New description  ',
        })
        .expect(200);

      expect(response.body).toMatchObject({
        id: device.id,
        deviceProfileId: profile.id,
        name: 'New name',
        serialNumber: 'New-Serial',
        description: 'New description',
        archivedAt: null,
        editRevision: 2,
      });

      const stored = await prisma.device.findUniqueOrThrow({
        where: { id: device.id },
      });
      expect(stored.serialNumberKey).toBe('NEW-SERIAL');
      expect(stored.deviceProfileId).toBe(profile.id);
    });

    it('clears a description with null or an empty string', async () => {
      const device = await createDevice({ description: 'Remove me' });

      const cleared = await patchAs(planner, `/api/devices/${device.id}`)
        .send({ expectedRevision: 1, description: '   ' })
        .expect(200);
      expect(cleared.body).toMatchObject({
        description: null,
        editRevision: 2,
      });

      const nullAgain = await patchAs(planner, `/api/devices/${device.id}`)
        .send({ expectedRevision: 2, description: null })
        .expect(200);
      expect(nullAgain.body).toMatchObject({
        description: null,
        editRevision: 2,
      });
    });

    it('returns DEVICE_CONFLICT for a stale revision and changes nothing', async () => {
      const device = await createDevice({ name: 'Current name' });

      const response = await patchAs(planner, `/api/devices/${device.id}`)
        .send({ expectedRevision: 0, name: 'Stale name' })
        .expect(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });

      const stale = await patchAs(planner, `/api/devices/${device.id}`)
        .send({ expectedRevision: 7, name: 'Stale name' })
        .expect(409);
      expect(stale.body).toMatchObject({
        code: 'DEVICE_CONFLICT',
        details: { currentRevision: 1 },
      });

      const unchanged = await getDevice(device.id);
      expect(unchanged).toMatchObject({
        name: 'Current name',
        editRevision: 1,
      });
    });

    it('serialises concurrent updates on the revision lock', async () => {
      const device = await createDevice({ name: 'Race target' });

      const responses = await Promise.all([
        patchAs(planner, `/api/devices/${device.id}`).send({
          expectedRevision: 1,
          name: 'Race winner A',
        }),
        patchAs(planner, `/api/devices/${device.id}`).send({
          expectedRevision: 1,
          name: 'Race winner B',
        }),
      ]);

      const statuses = responses
        .map((response) => response.status)
        .sort((left, right) => left - right);
      expect(statuses).toEqual([200, 409]);

      const conflict = responses.find((response) => response.status === 409);
      expect(conflict?.body).toMatchObject({
        code: 'DEVICE_CONFLICT',
        details: { currentRevision: 2 },
      });

      const stored = await getDevice(device.id);
      expect(stored.editRevision).toBe(2);
      expect(['Race winner A', 'Race winner B']).toContain(stored.name);
    });

    it('returns DEVICE_SERIAL_CONFLICT when another device owns the serial', async () => {
      await createDevice({ serialNumber: 'OWNED-SERIAL' });
      const device = await createDevice({ serialNumber: 'FREE-SERIAL' });

      const response = await patchAs(planner, `/api/devices/${device.id}`)
        .send({ expectedRevision: 1, serialNumber: 'owned-serial' })
        .expect(409);
      expect(response.body).toMatchObject({ code: 'DEVICE_SERIAL_CONFLICT' });

      expect(await getDevice(device.id)).toMatchObject({
        serialNumber: 'FREE-SERIAL',
        editRevision: 1,
      });
    });

    it('rejects a profile change and unknown device ids', async () => {
      const device = await createDevice();

      for (const body of [
        { expectedRevision: 1, name: null },
        { expectedRevision: 1, serialNumber: null },
        { expectedRevision: 1, name: 'x'.repeat(101) },
        { expectedRevision: 1, serialNumber: 'SN WITH SPACE' },
        { expectedRevision: 1, description: 'x'.repeat(501) },
      ]) {
        const invalid = await patchAs(planner, `/api/devices/${device.id}`)
          .send(body)
          .expect(400);
        expect(invalid.body).toMatchObject({ code: 'VALIDATION_ERROR' });
      }

      const profileChange = await patchAs(planner, `/api/devices/${device.id}`)
        .send({
          expectedRevision: 1,
          deviceProfileId: randomUUID(),
          name: 'Profile change',
        })
        .expect(400);
      expect(profileChange.body).toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      expect(readFieldErrors(profileChange.body)).toContainEqual(
        expect.objectContaining({
          path: 'deviceProfileId',
          code: 'UNKNOWN_FIELD',
        }),
      );

      const unknown = randomUUID();
      const patch = await patchAs(planner, `/api/devices/${unknown}`)
        .send({ expectedRevision: 1, name: 'Missing' })
        .expect(404);
      expect(patch.body).toMatchObject({ code: 'NOT_FOUND' });

      const get = await getAs(planner, `/api/devices/${unknown}`).expect(404);
      expect(get.body).toMatchObject({ code: 'NOT_FOUND' });
    });

    it('does not increment the revision for an unchanged payload', async () => {
      const device = await createDevice({
        name: 'Same name',
        serialNumber: 'SAME-SERIAL',
      });

      const response = await patchAs(planner, `/api/devices/${device.id}`)
        .send({
          expectedRevision: 1,
          name: 'Same name',
          serialNumber: 'SAME-SERIAL',
        })
        .expect(200);

      expect(response.body).toMatchObject({
        name: 'Same name',
        serialNumber: 'SAME-SERIAL',
        editRevision: 1,
      });
    });
  });

  describe('archive and restore', () => {
    it('archives and restores with the expected revision and preserves history', async () => {
      const device = await createDevice({ name: 'Lifecycle device' });

      const archived = await postAs(
        planner,
        `/api/devices/${device.id}/archive`,
      )
        .send({ expectedRevision: 1 })
        .expect(200);
      const archivedBody = archived.body as DeviceBody;
      expect(archivedBody.archivedAt).toEqual(expect.any(String));
      expect(archivedBody.editRevision).toBe(2);

      const archivedList = await getAs(
        planner,
        deviceListPath({ state: 'archived' }),
      ).expect(200);
      expect(
        (archivedList.body as DeviceListBody).items.map((item) => item.id),
      ).toContain(device.id);

      const activeList = await getAs(planner, deviceListPath()).expect(200);
      expect(
        (activeList.body as DeviceListBody).items.map((item) => item.id),
      ).not.toContain(device.id);

      const archivedAgain = await postAs(
        planner,
        `/api/devices/${device.id}/archive`,
      )
        .send({ expectedRevision: 2 })
        .expect(200);
      expect(archivedAgain.body).toMatchObject({
        id: device.id,
        archivedAt: archivedBody.archivedAt,
        editRevision: 2,
      });

      const staleArchive = await postAs(
        planner,
        `/api/devices/${device.id}/archive`,
      )
        .send({ expectedRevision: 1 })
        .expect(409);
      expect(staleArchive.body).toMatchObject({ code: 'DEVICE_CONFLICT' });

      const restored = await postAs(
        planner,
        `/api/devices/${device.id}/restore`,
      )
        .send({ expectedRevision: 2 })
        .expect(200);
      expect(restored.body).toMatchObject({
        id: device.id,
        archivedAt: null,
        editRevision: 3,
      });

      const restoredAgain = await postAs(
        planner,
        `/api/devices/${device.id}/restore`,
      )
        .send({ expectedRevision: 3 })
        .expect(200);
      expect(restoredAgain.body).toMatchObject({
        archivedAt: null,
        editRevision: 3,
      });

      const staleRestore = await postAs(
        planner,
        `/api/devices/${device.id}/restore`,
      )
        .send({ expectedRevision: 2 })
        .expect(409);
      expect(staleRestore.body).toMatchObject({ code: 'DEVICE_CONFLICT' });

      const stored = await prisma.device.findUniqueOrThrow({
        where: { id: device.id },
      });
      expect(stored.archivedAt).toBeNull();
      expect(stored.editRevision).toBe(3);
      expect(stored.name).toBe('Lifecycle device');
    });

    it('keeps a canonical serial reserved after archiving', async () => {
      const device = await createDevice({ serialNumber: 'RESERVED-01' });

      await postAs(planner, `/api/devices/${device.id}/archive`)
        .send({ expectedRevision: 1 })
        .expect(200);

      const duplicate = await postAs(planner, '/api/devices')
        .send({
          deviceProfileId: profile.id,
          name: 'Reuse attempt',
          serialNumber: 'reserved-01',
        })
        .expect(409);
      expect(duplicate.body).toMatchObject({
        code: 'DEVICE_SERIAL_CONFLICT',
      });
    });

    it('returns 404 for unknown devices and validates the revision body', async () => {
      const unknown = randomUUID();

      const archive = await postAs(planner, `/api/devices/${unknown}/archive`)
        .send({ expectedRevision: 1 })
        .expect(404);
      expect(archive.body).toMatchObject({ code: 'NOT_FOUND' });

      const restore = await postAs(planner, `/api/devices/${unknown}/restore`)
        .send({ expectedRevision: 1 })
        .expect(404);
      expect(restore.body).toMatchObject({ code: 'NOT_FOUND' });

      const device = await createDevice();
      const invalid = await postAs(planner, `/api/devices/${device.id}/archive`)
        .send({ expectedRevision: 1, unknown: true })
        .expect(400);
      expect(invalid.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('keeps the profile foreign key restrictive', async () => {
      await createDevice();

      await expect(
        prisma.deviceProfile.delete({ where: { id: profile.id } }),
      ).rejects.toMatchObject({ code: 'P2003' });
    });
  });
});
