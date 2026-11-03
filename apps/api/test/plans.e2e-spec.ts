import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CSRF_COOKIE_NAME, SESSION_COOKIE_NAME } from '../src/auth/auth.constants.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PlanRevisionState, Role } from '../src/prisma/generated/client.js';
import { createTestApplication } from './support/create-test-application.js';
import {
  cookieHeader,
  getCookie,
  readSetCookies,
  type TestUser,
} from './support/auth-helpers.js';
import {
  createPlanTestProfile,
  createPlanTestUser,
  deletePlanTestData,
} from './support/plan-helpers.js';

interface StepBody {
  logicalStepId: string;
  position: number;
  name: string;
  unit: string;
  minimum: string;
  maximum: string;
  sampleCount: number;
  intervalMs: number;
}

interface DraftBody {
  id: string;
  planId: string;
  state: 'DRAFT';
  name: string;
  editRevision: number;
  versionNumber: null;
  baseVersionId: string | null;
  steps: StepBody[];
}

interface PublishedBody {
  id: string;
  planId: string;
  state: 'PUBLISHED';
  name: string;
  versionNumber: number;
  baseVersionId: string | null;
  publishedAt: string;
  steps: StepBody[];
}

interface PublishedVersionSummaryBody {
  id: string;
  versionNumber: number;
  publishedAt: string;
}

interface PlanBody {
  id: string;
  name: string;
  profile: { id: string; code: string; name: string; description: string | null };
  createdAt: string;
  latestPublishedVersion: PublishedVersionSummaryBody | null;
  draft?: DraftBody | null;
  published: PublishedBody | null;
}

interface PlanListItemBody {
  id: string;
  name: string;
  profile: { id: string; code: string; name: string; description: string | null };
  latestPublishedVersion: PublishedVersionSummaryBody | null;
  draft?: { id: string; editRevision: number } | null;
}

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

interface SaveDraftRequest {
  name: string;
  expectedRevision: number;
  steps: DraftStepRequest[];
}

function step(overrides: Partial<DraftStepRequest> = {}): DraftStepRequest {
  return {
    name: 'Output voltage',
    unit: 'V',
    minimum: '4.750000',
    maximum: '5.250000',
    sampleCount: 100,
    intervalMs: 250,
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

describe('plans API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let plannerUser: TestUser;
  let operatorUser: TestUser;
  let viewerUser: TestUser;
  let profile: { id: string; code: string; name: string; description: string | null };
  let planner: ClientSession;
  let operator: ClientSession;
  let viewer: ClientSession;

  const server = () => app.getHttpServer();

  beforeAll(async () => {
    app = await createTestApplication();
    prisma = app.get(PrismaService);

    await deletePlanTestData(prisma);

    plannerUser = await createPlanTestUser(prisma, Role.PLANNER);
    operatorUser = await createPlanTestUser(prisma, Role.OPERATOR);
    viewerUser = await createPlanTestUser(prisma, Role.VIEWER);
    const createdProfile = await createPlanTestProfile(prisma);
    profile = {
      ...createdProfile,
      name: 'Plan E2E Device',
      description: 'Fixture profile',
    };

    planner = await login(plannerUser);
    operator = await login(operatorUser);
    viewer = await login(viewerUser);
  });

  afterAll(async () => {
    if (prisma) {
      await deletePlanTestData(prisma);
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
      cookie: cookieHeader(
        getCookie(cookies, SESSION_COOKIE_NAME),
        csrfCookie,
      ),
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

  function putAs(session: ClientSession, path: string): request.Test {
    return request(server())
      .put(path)
      .set('Cookie', session.cookie)
      .set('X-XSRF-TOKEN', session.csrfToken);
  }

  async function createPlan(name = 'Power rail verification'): Promise<PlanBody> {
    const response = await postAs(planner, '/api/plans')
      .send({ name, profileId: profile.id })
      .expect(201);

    return response.body as PlanBody;
  }

  async function saveDraft(
    planId: string,
    body: SaveDraftRequest,
    session: ClientSession = planner,
  ): Promise<DraftBody> {
    const response = await putAs(session, `/api/plans/${planId}/draft`)
      .send(body)
      .expect(200);

    return response.body as DraftBody;
  }

  async function getPlan(planId: string): Promise<PlanBody> {
    const response = await getAs(planner, `/api/plans/${planId}`).expect(200);
    return response.body as PlanBody;
  }

  async function createPublishedPlan(options: {
    draftName: string;
    publishedName: string;
    versionNumber?: number;
    stepCount?: number;
  }): Promise<{ plan: PlanBody; published: PublishedBody }> {
    const plan = await createPlan(options.draftName);
    const versionNumber = options.versionNumber ?? 1;
    const revision = await prisma.planRevision.create({
      data: {
        planId: plan.id,
        state: PlanRevisionState.PUBLISHED,
        name: options.publishedName,
        versionNumber,
        publishedById: plannerUser.id,
        publishedAt: new Date('2026-11-03T12:00:00.000Z'),
      },
    });

    for (let index = 0; index < (options.stepCount ?? 2); index += 1) {
      const identity = await prisma.stepIdentity.create({
        data: { planId: plan.id },
      });
      await prisma.planStep.create({
        data: {
          planId: plan.id,
          revisionId: revision.id,
          logicalStepId: identity.id,
          position: index + 1,
          name: `Published step ${index + 1}`,
          unit: 'V',
          minimum: '4.75',
          maximum: '5.25',
          sampleCount: 100,
          intervalMs: 250,
        },
      });
    }

    const planWithPublished = await getPlan(plan.id);
    return { plan, published: planWithPublished.published! };
  }

  describe('authentication, roles and CSRF', () => {
    it('rejects unauthenticated reads and writes with UNAUTHENTICATED', async () => {
      const create = await request(server())
        .post('/api/plans')
        .send({ name: 'Unauthenticated', profileId: profile.id })
        .expect(401);
      expect(create.body).toMatchObject({ code: 'UNAUTHENTICATED' });

      const list = await request(server()).get('/api/plans').expect(401);
      expect(list.body).toMatchObject({ code: 'UNAUTHENTICATED' });

      const profiles = await request(server())
        .get('/api/device-profiles')
        .expect(401);
      expect(profiles.body).toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('allows only a Planner to create and save plans', async () => {
      for (const session of [operator, viewer]) {
        const response = await postAs(session, '/api/plans')
          .send({ name: 'Forbidden plan', profileId: profile.id })
          .expect(403);
        expect(response.body).toMatchObject({ code: 'FORBIDDEN' });
      }

      const plan = await createPlan('Role matrix plan');

      for (const session of [operator, viewer]) {
        const response = await putAs(
          session,
          `/api/plans/${plan.id}/draft`,
        )
          .send({
            name: 'Forbidden draft',
            expectedRevision: 1,
            steps: [],
          })
          .expect(403);
        expect(response.body).toMatchObject({ code: 'FORBIDDEN' });
      }

      const unchanged = await getPlan(plan.id);
      expect(unchanged.draft?.editRevision).toBe(1);
      expect(unchanged.name).toBe('Role matrix plan');
    });

    it('rejects a Planner mutation without the CSRF header', async () => {
      const response = await request(server())
        .post('/api/plans')
        .set('Cookie', planner.cookie)
        .send({ name: 'No CSRF', profileId: profile.id })
        .expect(403);

      expect(response.body).toMatchObject({ code: 'FORBIDDEN' });
      expect(response.body.message).toMatch(/CSRF/i);
    });

    it('returns the device profile list to every authenticated role', async () => {
      for (const session of [planner, operator, viewer]) {
        const response = await getAs(
          session,
          '/api/device-profiles',
        ).expect(200);

        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body).toContainEqual({
          id: profile.id,
          code: profile.code,
          name: profile.name,
          description: profile.description,
        });
      }
    });
  });

  describe('POST /plans', () => {
    it('creates the plan and its empty first draft atomically', async () => {
      const response = await postAs(planner, '/api/plans')
        .send({
          name: '  Power rail verification  ',
          profileId: profile.id,
        })
        .expect(201);

      const body = response.body as PlanBody;
      expect(body).toMatchObject({
        name: 'Power rail verification',
        profile: {
          id: profile.id,
          code: profile.code,
          name: profile.name,
          description: profile.description,
        },
        latestPublishedVersion: null,
        published: null,
      });
      expect(body.id).toEqual(expect.any(String));
      expect(body.createdAt).toEqual(expect.any(String));
      expect(body.draft).toMatchObject({
        planId: body.id,
        state: 'DRAFT',
        name: 'Power rail verification',
        editRevision: 1,
        versionNumber: null,
        baseVersionId: null,
        steps: [],
      });
      expect(body.draft?.id).toEqual(expect.any(String));

      const stored = await prisma.testPlan.findUniqueOrThrow({
        where: { id: body.id },
        include: { revisions: true },
      });
      expect(stored.createdById).toBe(plannerUser.id);
      expect(stored.deviceProfileId).toBe(profile.id);
      expect(stored.revisions).toHaveLength(1);
      expect(stored.revisions[0]).toMatchObject({
        state: PlanRevisionState.DRAFT,
        name: 'Power rail verification',
        editRevision: 1,
        versionNumber: null,
      });
    });

    it('rejects an unknown profile without creating a plan', async () => {
      const before = await prisma.testPlan.count({
        where: { createdById: plannerUser.id },
      });

      const response = await postAs(planner, '/api/plans')
        .send({ name: 'Missing profile', profileId: randomUUID() })
        .expect(400);

      expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(readFieldErrors(response.body)).toContainEqual(
        expect.objectContaining({
          path: 'profileId',
          code: 'INVALID_VALUE',
        }),
      );
      expect(
        await prisma.testPlan.count({ where: { createdById: plannerUser.id } }),
      ).toBe(before);
    });

    it('rejects invalid names and unknown fields without creating a plan', async () => {
      const before = await prisma.testPlan.count({
        where: { createdById: plannerUser.id },
      });

      const empty = await postAs(planner, '/api/plans')
        .send({ name: '   ', profileId: profile.id })
        .expect(400);
      expect(readFieldErrors(empty.body)).toContainEqual(
        expect.objectContaining({ path: 'name', code: 'INVALID_VALUE' }),
      );

      const tooLong = await postAs(planner, '/api/plans')
        .send({ name: 'a'.repeat(101), profileId: profile.id })
        .expect(400);
      expect(readFieldErrors(tooLong.body)).toContainEqual(
        expect.objectContaining({ path: 'name', code: 'INVALID_VALUE' }),
      );

      const malformed = await postAs(planner, '/api/plans')
        .send({ name: 'Bad profile id', profileId: 'not-a-uuid' })
        .expect(400);
      expect(readFieldErrors(malformed.body)).toContainEqual(
        expect.objectContaining({
          path: 'profileId',
          code: 'INVALID_TYPE',
        }),
      );

      const unknown = await postAs(planner, '/api/plans')
        .send({
          name: 'Unknown field',
          profileId: profile.id,
          status: 'PUBLISHED',
        })
        .expect(400);
      expect(readFieldErrors(unknown.body)).toContainEqual(
        expect.objectContaining({
          path: 'status',
          code: 'UNKNOWN_FIELD',
        }),
      );

      expect(
        await prisma.testPlan.count({ where: { createdById: plannerUser.id } }),
      ).toBe(before);
    });
  });

  describe('role-aware reads', () => {
    it('lists draft-only plans and draft names only for a Planner', async () => {
      const draftOnly = await createPlan('Draft-only secret plan');
      const { plan: publishedPlan, published: publishedVersion } =
        await createPublishedPlan({
          draftName: 'Draft secret name',
          publishedName: 'Published plan name',
        });

      const plannerList = await getAs(planner, '/api/plans').expect(200);
      const plannerItems = plannerList.body as PlanListItemBody[];
      const plannerDraftOnly = plannerItems.find(
        (item) => item.id === draftOnly.id,
      );
      expect(plannerDraftOnly).toMatchObject({
        name: 'Draft-only secret plan',
        profile: { id: profile.id, name: profile.name },
        latestPublishedVersion: null,
        draft: { editRevision: 1 },
      });

      const plannerPublished = plannerItems.find(
        (item) => item.id === publishedPlan.id,
      );
      expect(plannerPublished).toMatchObject({
        name: 'Draft secret name',
        profile: { id: profile.id },
        latestPublishedVersion: {
          id: publishedVersion.id,
          versionNumber: 1,
          publishedAt: '2026-11-03T12:00:00.000Z',
        },
        draft: { editRevision: 1 },
      });

      for (const session of [operator, viewer]) {
        const response = await getAs(session, '/api/plans').expect(200);
        const items = response.body as PlanListItemBody[];
        const ids = items.map((item) => item.id);

        expect(ids).not.toContain(draftOnly.id);
        const publishedItem = items.find((item) => item.id === publishedPlan.id);
        expect(publishedItem).toMatchObject({
          name: 'Published plan name',
          profile: { id: profile.id },
          latestPublishedVersion: {
            id: publishedVersion.id,
            versionNumber: 1,
          },
        });
        expect(publishedItem).not.toHaveProperty('draft');
        expect(JSON.stringify(response.body)).not.toContain(
          'Draft-only secret plan',
        );
        expect(JSON.stringify(response.body)).not.toContain(
          'Draft secret name',
        );
      }
    });

    it('reports the highest published version in list and detail', async () => {
      const plan = await createPlan('Versioned plan');
      const versions = [];
      for (const versionNumber of [1, 2, 3]) {
        versions.push(
          await prisma.planRevision.create({
            data: {
              planId: plan.id,
              state: PlanRevisionState.PUBLISHED,
              name: `Version ${versionNumber}`,
              versionNumber,
              publishedById: plannerUser.id,
              publishedAt: new Date(
                `2026-11-0${versionNumber}T12:00:00.000Z`,
              ),
            },
          }),
        );
      }

      for (const session of [operator, viewer]) {
        const list = await getAs(session, '/api/plans').expect(200);
        const item = (list.body as PlanListItemBody[]).find(
          (candidate) => candidate.id === plan.id,
        );
        expect(item?.latestPublishedVersion).toMatchObject({
          id: versions[2]!.id,
          versionNumber: 3,
          publishedAt: '2026-11-03T12:00:00.000Z',
        });

        const detail = await getAs(
          session,
          `/api/plans/${plan.id}`,
        ).expect(200);
        expect(detail.body).toMatchObject({
          name: 'Version 3',
          latestPublishedVersion: {
            id: versions[2]!.id,
            versionNumber: 3,
          },
          published: { id: versions[2]!.id, name: 'Version 3' },
        });
      }
    });

    it('does not leak draft names or draft-only plans after a draft rename', async () => {
      const { plan } = await createPublishedPlan({
        draftName: 'Old draft name',
        publishedName: 'Stable published name',
      });
      await saveDraft(plan.id, {
        name: 'Renamed secret draft',
        expectedRevision: 1,
        steps: [],
      });

      for (const session of [operator, viewer]) {
        const list = await getAs(session, '/api/plans').expect(200);
        const item = (list.body as PlanListItemBody[]).find(
          (candidate) => candidate.id === plan.id,
        );
        expect(item?.name).toBe('Stable published name');
        expect(JSON.stringify(list.body)).not.toContain('Renamed secret draft');
      }
    });

    it('returns a Planner draft with steps and published content in detail', async () => {
      const { plan, published } = await createPublishedPlan({
        draftName: 'Draft detail name',
        publishedName: 'Published detail name',
        stepCount: 2,
      });

      const detail = await getPlan(plan.id);
      expect(detail.name).toBe('Draft detail name');
      expect(detail.draft).toMatchObject({
        planId: plan.id,
        state: 'DRAFT',
        name: 'Draft detail name',
        editRevision: 1,
        versionNumber: null,
        steps: [],
      });
      expect(detail.published).toMatchObject({
        id: published.id,
        state: 'PUBLISHED',
        name: 'Published detail name',
        versionNumber: 1,
        publishedAt: '2026-11-03T12:00:00.000Z',
      });
      expect(detail.published?.steps).toHaveLength(2);
      expect(detail.published?.steps[0]).toMatchObject({
        position: 1,
        name: 'Published step 1',
        minimum: '4.750000',
        maximum: '5.250000',
      });
    });

    it('hides a draft-only plan from Operator and Viewer with 404', async () => {
      const plan = await createPlan('Hidden draft-only name');

      const plannerDetail = await getAs(
        planner,
        `/api/plans/${plan.id}`,
      ).expect(200);
      expect(plannerDetail.body).toMatchObject({
        name: 'Hidden draft-only name',
        published: null,
      });
      expect((plannerDetail.body as PlanBody).draft?.steps).toEqual([]);

      for (const session of [operator, viewer]) {
        const response = await getAs(
          session,
          `/api/plans/${plan.id}`,
        ).expect(404);

        expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
        expect(JSON.stringify(response.body)).not.toContain(
          'Hidden draft-only name',
        );
      }
    });

    it('serves only published content to Operator and Viewer', async () => {
      const { plan, published } = await createPublishedPlan({
        draftName: 'Secret draft content',
        publishedName: 'Visible published content',
        stepCount: 2,
      });

      for (const session of [operator, viewer]) {
        const response = await getAs(
          session,
          `/api/plans/${plan.id}`,
        ).expect(200);
        const body = response.body as PlanBody;

        expect(body.name).toBe('Visible published content');
        expect(body).not.toHaveProperty('draft');
        expect(body.latestPublishedVersion).toMatchObject({
          id: published.id,
          versionNumber: 1,
          publishedAt: '2026-11-03T12:00:00.000Z',
        });
        expect(body.published).toMatchObject({
          id: published.id,
          name: 'Visible published content',
          versionNumber: 1,
        });
        expect(body.published?.steps).toHaveLength(2);
        expect(body.published?.steps[0]?.minimum).toBe('4.750000');
        expect(typeof body.published?.steps[0]?.minimum).toBe('string');
        expect(JSON.stringify(response.body)).not.toContain(
          'Secret draft content',
        );
      }
    });

    it('returns 404 for a missing plan and 400 for a malformed id', async () => {
      for (const session of [planner, operator, viewer]) {
        const missing = await getAs(
          session,
          `/api/plans/${randomUUID()}`,
        ).expect(404);
        expect(missing.body).toMatchObject({ code: 'NOT_FOUND' });
      }

      const malformed = await getAs(planner, '/api/plans/not-a-uuid').expect(
        400,
      );
      expect(malformed.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    });
  });

  describe('PUT /plans/:id/draft', () => {
    it('saves array order, assigns positions and returns new logical identities', async () => {
      const plan = await createPlan('Draft to save');

      const draft = await saveDraft(plan.id, {
        name: '  Saved draft name  ',
        expectedRevision: 1,
        steps: [
          step({ logicalStepId: '', name: '  Output voltage  ', unit: ' V ' }),
          step({
            name: 'Output current',
            unit: 'A',
            minimum: '-0.5',
            maximum: '0.5',
            sampleCount: 50,
            intervalMs: 500,
          }),
        ],
      });

      expect(draft).toMatchObject({
        planId: plan.id,
        state: 'DRAFT',
        name: 'Saved draft name',
        editRevision: 2,
        versionNumber: null,
      });
      expect(draft.steps).toHaveLength(2);
      expect(draft.steps.map((entry) => entry.position)).toEqual([1, 2]);
      expect(draft.steps[0]).toMatchObject({
        name: 'Output voltage',
        unit: 'V',
        minimum: '4.750000',
        maximum: '5.250000',
        sampleCount: 100,
        intervalMs: 250,
      });
      expect(draft.steps[1]).toMatchObject({
        name: 'Output current',
        unit: 'A',
        minimum: '-0.500000',
        maximum: '0.500000',
        sampleCount: 50,
        intervalMs: 500,
      });
      expect(draft.steps[0]?.logicalStepId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(draft.steps[0]?.logicalStepId).not.toBe(
        draft.steps[1]?.logicalStepId,
      );
      expect(
        await prisma.stepIdentity.count({ where: { planId: plan.id } }),
      ).toBe(2);
      expect(
        await prisma.planStep.count({
          where: { revisionId: draft.id },
        }),
      ).toBe(2);

      const reloaded = await getPlan(plan.id);
      expect(reloaded.name).toBe('Saved draft name');
      expect(reloaded.draft?.steps).toEqual(draft.steps);
    });

    it('preserves existing identities, creates only new ones and honours reordering', async () => {
      const plan = await createPlan('Identity plan');
      const first = await saveDraft(plan.id, {
        name: 'Identity draft',
        expectedRevision: 1,
        steps: [step({ name: 'First' }), step({ name: 'Second' })],
      });
      const firstIdentity = first.steps[0]!.logicalStepId;
      const secondIdentity = first.steps[1]!.logicalStepId;

      const second = await saveDraft(plan.id, {
        name: 'Reordered draft',
        expectedRevision: 2,
        steps: [
          step({ logicalStepId: secondIdentity, name: 'Second moved' }),
          step({ logicalStepId: firstIdentity, name: 'First moved' }),
          step({ name: 'Third new' }),
        ],
      });

      expect(second.editRevision).toBe(3);
      expect(second.steps.map((entry) => entry.position)).toEqual([1, 2, 3]);
      expect(second.steps[0]?.logicalStepId).toBe(secondIdentity);
      expect(second.steps[1]?.logicalStepId).toBe(firstIdentity);
      expect(second.steps[2]?.logicalStepId).not.toBe(firstIdentity);
      expect(second.steps[2]?.logicalStepId).not.toBe(secondIdentity);
      expect(second.steps.map((entry) => entry.name)).toEqual([
        'Second moved',
        'First moved',
        'Third new',
      ]);

      expect(
        await prisma.stepIdentity.count({ where: { planId: plan.id } }),
      ).toBe(3);
      expect(
        await prisma.stepIdentity.findUnique({
          where: { id: secondIdentity },
        }),
      ).not.toBeNull();
    });

    it('allows saving an empty draft', async () => {
      const plan = await createPlan('Empty draft plan');
      await saveDraft(plan.id, {
        name: 'Has steps',
        expectedRevision: 1,
        steps: [step()],
      });

      const empty = await saveDraft(plan.id, {
        name: 'Now empty',
        expectedRevision: 2,
        steps: [],
      });

      expect(empty).toMatchObject({
        name: 'Now empty',
        editRevision: 3,
        steps: [],
      });
      expect(
        await prisma.planStep.count({ where: { revisionId: empty.id } }),
      ).toBe(0);
      expect(
        await prisma.stepIdentity.count({ where: { planId: plan.id } }),
      ).toBe(1);
    });

    it('accepts boundary values for names, decimals, samples and duration', async () => {
      const plan = await createPlan('Boundary plan');
      const draft = await saveDraft(plan.id, {
        name: 'b'.repeat(100),
        expectedRevision: 1,
        steps: [
          step({
            name: 'n'.repeat(100),
            unit: 'u'.repeat(16),
            minimum: '-1000000000.000000',
            maximum: '1000000000.000000',
            sampleCount: 1000,
            intervalMs: 100,
          }),
          step({
            name: 'Equal bounds',
            minimum: '0.000001',
            maximum: '0.000001',
            sampleCount: 1000,
            intervalMs: 100,
          }),
          ...Array.from({ length: 4 }, (_, index) =>
            step({
              name: `Sustained ${index}`,
              sampleCount: 1000,
              intervalMs: 100,
            }),
          ),
        ],
      });

      expect(draft.name).toHaveLength(100);
      expect(draft.steps[0]).toMatchObject({
        name: 'n'.repeat(100),
        unit: 'u'.repeat(16),
        minimum: '-1000000000.000000',
        maximum: '1000000000.000000',
      });
      expect(draft.steps[1]).toMatchObject({
        minimum: '0.000001',
        maximum: '0.000001',
      });
      // 6 steps x 1000 samples x 100 ms = exactly 600,000 ms.
      expect(
        draft.steps.reduce(
          (total, entry) => total + entry.sampleCount * entry.intervalMs,
          0,
        ),
      ).toBe(600_000);

      const thirty = await createPlan('Thirty step plan');
      const thirtyDraft = await saveDraft(thirty.id, {
        name: 'Thirty steps',
        expectedRevision: 1,
        steps: Array.from({ length: 30 }, (_, index) =>
          step({ name: `Step ${index + 1}`, sampleCount: 1, intervalMs: 100 }),
        ),
      });
      expect(thirtyDraft.steps).toHaveLength(30);
      expect(thirtyDraft.steps[29]?.position).toBe(30);
    });

    it('rejects a stale expectedRevision with 409 and keeps the stored draft', async () => {
      const plan = await createPlan('Conflict plan');
      const saved = await saveDraft(plan.id, {
        name: 'Saved once',
        expectedRevision: 1,
        steps: [step({ name: 'Saved step' })],
      });

      const conflict = await putAs(planner, `/api/plans/${plan.id}/draft`)
        .send({
          name: 'Stale overwrite',
          expectedRevision: 1,
          steps: [],
        })
        .expect(409);

      expect(conflict.body).toMatchObject({
        code: 'DRAFT_CONFLICT',
        details: { currentRevision: 2 },
      });

      const current = await getPlan(plan.id);
      expect(current.name).toBe('Saved once');
      expect(current.draft?.id).toBe(saved.id);
      expect(current.draft?.editRevision).toBe(2);
      expect(current.draft?.steps.map((entry) => entry.name)).toEqual([
        'Saved step',
      ]);
    });

    it('returns 409 when the plan has no open draft', async () => {
      const plan = await prisma.testPlan.create({
        data: {
          createdById: plannerUser.id,
          deviceProfileId: profile.id,
        },
      });

      const response = await putAs(planner, `/api/plans/${plan.id}/draft`)
        .send({
          name: 'No draft',
          expectedRevision: 1,
          steps: [],
        })
        .expect(409);

      expect(response.body).toMatchObject({
        code: 'DRAFT_CONFLICT',
        details: { reason: 'NO_OPEN_DRAFT' },
      });
    });

    it('returns 404 for an unknown plan', async () => {
      const response = await putAs(
        planner,
        `/api/plans/${randomUUID()}/draft`,
      )
        .send({ name: 'Missing', expectedRevision: 1, steps: [] })
        .expect(404);

      expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
    });

    it('lets exactly one of two concurrent saves with the same revision win', async () => {
      const plan = await createPlan('Concurrent plan');
      const firstBody = {
        name: 'Concurrent A',
        expectedRevision: 1,
        steps: [step({ name: 'A step' })],
      };
      const secondBody = {
        name: 'Concurrent B',
        expectedRevision: 1,
        steps: [step({ name: 'B step' }), step({ name: 'B second' })],
      };

      const firstRequest = putAs(planner, `/api/plans/${plan.id}/draft`).send(
        firstBody,
      );
      const secondRequest = putAs(planner, `/api/plans/${plan.id}/draft`).send(
        secondBody,
      );

      const [firstResponse, secondResponse] = await Promise.all([
        firstRequest,
        secondRequest,
      ]);
      const statuses = [firstResponse.status, secondResponse.status].sort(
        (left, right) => left - right,
      );
      expect(statuses).toEqual([200, 409]);

      const conflict =
        firstResponse.status === 409 ? firstResponse : secondResponse;
      expect(conflict.body).toMatchObject({ code: 'DRAFT_CONFLICT' });

      const stored = await getPlan(plan.id);
      expect(stored.draft?.editRevision).toBe(2);
      const winner = firstResponse.status === 200 ? firstBody : secondBody;
      expect(stored.name).toBe(winner.name);
      expect(stored.draft?.steps.map((entry) => entry.name)).toEqual(
        winner.steps.map((entry) => entry.name),
      );

      const stepRows = await prisma.planStep.findMany({
        where: { revisionId: stored.draft!.id },
        orderBy: { position: 'asc' },
      });
      expect(stepRows).toHaveLength(winner.steps.length);
      expect(stepRows.map((row) => row.position)).toEqual(
        winner.steps.map((_, index) => index + 1),
      );
    });

    it('rejects invalid fields and limits with steps.N paths and no writes', async () => {
      const plan = await createPlan('Validation plan');

      const base = {
        name: 'Valid name',
        expectedRevision: 1,
      };
      const cases: Array<{
        label: string;
        body: Record<string, unknown>;
        path: string;
        code?: string;
      }> = [
        {
          label: 'too many steps',
          body: {
            ...base,
            steps: Array.from({ length: 31 }, () => step()),
          },
          path: 'steps',
          code: 'INVALID_VALUE',
        },
        {
          label: 'empty name',
          body: { ...base, name: '   ', steps: [] },
          path: 'name',
          code: 'INVALID_VALUE',
        },
        {
          label: 'long name',
          body: { ...base, name: 'a'.repeat(101), steps: [] },
          path: 'name',
          code: 'INVALID_VALUE',
        },
        {
          label: 'empty unit',
          body: { ...base, steps: [step({ unit: '  ' })] },
          path: 'steps.0.unit',
          code: 'INVALID_VALUE',
        },
        {
          label: 'long unit',
          body: { ...base, steps: [step({ unit: 'V'.repeat(17) })] },
          path: 'steps.0.unit',
          code: 'INVALID_VALUE',
        },
        {
          label: 'sample count zero',
          body: { ...base, steps: [step({ sampleCount: 0 })] },
          path: 'steps.0.sampleCount',
          code: 'INVALID_VALUE',
        },
        {
          label: 'sample count high',
          body: { ...base, steps: [step({ sampleCount: 1001 })] },
          path: 'steps.0.sampleCount',
          code: 'INVALID_VALUE',
        },
        {
          label: 'sample count fraction',
          body: { ...base, steps: [step({ sampleCount: 1.5 })] },
          path: 'steps.0.sampleCount',
          code: 'INVALID_TYPE',
        },
        {
          label: 'interval low',
          body: { ...base, steps: [step({ intervalMs: 99 })] },
          path: 'steps.0.intervalMs',
          code: 'INVALID_VALUE',
        },
        {
          label: 'interval high',
          body: { ...base, steps: [step({ intervalMs: 5001 })] },
          path: 'steps.0.intervalMs',
          code: 'INVALID_VALUE',
        },
        {
          label: 'steps not an array',
          body: { ...base, steps: 'not-an-array' },
          path: 'steps',
          code: 'INVALID_TYPE',
        },
        {
          label: 'missing expected revision',
          body: { name: 'Valid name', steps: [] },
          path: 'expectedRevision',
        },
        {
          label: 'expected revision zero',
          body: { ...base, expectedRevision: 0, steps: [] },
          path: 'expectedRevision',
          code: 'INVALID_VALUE',
        },
        {
          label: 'expected revision string',
          body: { ...base, expectedRevision: '1', steps: [] },
          path: 'expectedRevision',
          code: 'INVALID_TYPE',
        },
        {
          label: 'scientific decimal',
          body: { ...base, steps: [step({ minimum: '5e2' })] },
          path: 'steps.0.minimum',
          code: 'INVALID_VALUE',
        },
        {
          label: 'comma decimal',
          body: { ...base, steps: [step({ minimum: '1,5' })] },
          path: 'steps.0.minimum',
          code: 'INVALID_VALUE',
        },
        {
          label: 'too many decimal digits',
          body: { ...base, steps: [step({ minimum: '1.1234567' })] },
          path: 'steps.0.minimum',
          code: 'INVALID_VALUE',
        },
        {
          label: 'NaN decimal',
          body: { ...base, steps: [step({ minimum: 'NaN' })] },
          path: 'steps.0.minimum',
          code: 'INVALID_VALUE',
        },
        {
          label: 'Infinity decimal',
          body: { ...base, steps: [step({ maximum: 'Infinity' })] },
          path: 'steps.0.maximum',
          code: 'INVALID_VALUE',
        },
        {
          label: 'decimal out of range',
          body: { ...base, steps: [step({ minimum: '1000000001' })] },
          path: 'steps.0.minimum',
          code: 'INVALID_VALUE',
        },
        {
          label: 'minimum greater than maximum',
          body: {
            ...base,
            steps: [step({ minimum: '6.0', maximum: '5.0' })],
          },
          path: 'steps.0.maximum',
          code: 'INVALID_VALUE',
        },
        {
          label: 'total samples above limit',
          body: {
            ...base,
            steps: Array.from({ length: 11 }, () =>
              step({ sampleCount: 1000, intervalMs: 100 }),
            ),
          },
          path: 'steps',
          code: 'INVALID_VALUE',
        },
        {
          label: 'total duration above limit',
          body: {
            ...base,
            steps: [step({ sampleCount: 1000, intervalMs: 601 })],
          },
          path: 'steps',
          code: 'INVALID_VALUE',
        },
        {
          label: 'unknown top-level field',
          body: { ...base, status: 'PUBLISHED', steps: [] },
          path: 'status',
          code: 'UNKNOWN_FIELD',
        },
        {
          label: 'unknown step field',
          body: {
            ...base,
            steps: [{ ...step(), position: 9 }],
          },
          path: 'steps.0.position',
          code: 'UNKNOWN_FIELD',
        },
      ];

      for (const testCase of cases) {
        const response = await putAs(planner, `/api/plans/${plan.id}/draft`)
          .send(testCase.body)
          .expect(400);

        expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
        expect(
          readFieldErrors(response.body),
          `case: ${testCase.label}`,
        ).toContainEqual(
          expect.objectContaining({
            path: testCase.path,
            ...(testCase.code ? { code: testCase.code } : {}),
          }),
        );
      }

      const unchanged = await getPlan(plan.id);
      expect(unchanged.name).toBe('Validation plan');
      expect(unchanged.draft?.editRevision).toBe(1);
      expect(unchanged.draft?.steps).toEqual([]);
      expect(
        await prisma.stepIdentity.count({ where: { planId: plan.id } }),
      ).toBe(0);
    });

    it('rejects cross-plan, duplicate and unknown logical step ids without writes', async () => {
      const planA = await createPlan('Identity owner');
      const savedA = await saveDraft(planA.id, {
        name: 'Owner draft',
        expectedRevision: 1,
        steps: [step({ name: 'Owned step' })],
      });
      const identityA = savedA.steps[0]!.logicalStepId;

      const planB = await createPlan('Other plan');
      const crossPlan = await putAs(
        planner,
        `/api/plans/${planB.id}/draft`,
      )
        .send({
          name: 'Cross plan',
          expectedRevision: 1,
          steps: [step({ logicalStepId: identityA })],
        })
        .expect(400);
      expect(
        readFieldErrors(crossPlan.body),
      ).toContainEqual(
        expect.objectContaining({
          path: 'steps.0.logicalStepId',
          code: 'INVALID_VALUE',
        }),
      );
      expect((await getPlan(planB.id)).draft?.steps).toEqual([]);

      const savedB = await saveDraft(planB.id, {
        name: 'Other draft',
        expectedRevision: 1,
        steps: [step({ name: 'Other step' })],
      });
      const identityB = savedB.steps[0]!.logicalStepId;

      const duplicate = await putAs(planner, `/api/plans/${planB.id}/draft`)
        .send({
          name: 'Duplicate',
          expectedRevision: 2,
          steps: [
            step({ logicalStepId: identityB }),
            step({ logicalStepId: identityB }),
          ],
        })
        .expect(400);
      expect(readFieldErrors(duplicate.body)).toContainEqual(
        expect.objectContaining({
          path: 'steps.1.logicalStepId',
          code: 'INVALID_VALUE',
        }),
      );

      const identitiesBefore = await prisma.stepIdentity.count({
        where: { planId: planB.id },
      });
      const mixed = await putAs(planner, `/api/plans/${planB.id}/draft`)
        .send({
          name: 'Mixed invalid',
          expectedRevision: 2,
          steps: [
            step({ logicalStepId: identityB }),
            step({ name: 'Should not be created' }),
            step({ logicalStepId: randomUUID() }),
          ],
        })
        .expect(400);
      expect(readFieldErrors(mixed.body)).toContainEqual(
        expect.objectContaining({
          path: 'steps.2.logicalStepId',
          code: 'INVALID_VALUE',
        }),
      );
      expect(
        await prisma.stepIdentity.count({ where: { planId: planB.id } }),
      ).toBe(identitiesBefore);

      const unchanged = await getPlan(planB.id);
      expect(unchanged.draft?.editRevision).toBe(2);
      expect(unchanged.draft?.steps.map((entry) => entry.name)).toEqual([
        'Other step',
      ]);

      expect(
        await prisma.stepIdentity.count({ where: { planId: planA.id } }),
      ).toBe(1);
    });
  });
});
