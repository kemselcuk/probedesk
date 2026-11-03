import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from '../src/auth/auth.constants.js';
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

interface VersionListItemBody {
  id: string;
  versionNumber: number;
  name: string;
  publishedAt: string;
  publishedBy: { id: string; email: string; role: string };
}

interface PlanBody {
  id: string;
  name: string;
  latestPublishedVersion: {
    id: string;
    versionNumber: number;
    publishedAt: string;
  } | null;
  draft?: DraftBody | null;
  published: PublishedBody | null;
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

describe('plan publish API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let plannerUser: TestUser;
  let operatorUser: TestUser;
  let viewerUser: TestUser;
  let profileId: string;
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
    profileId = (await createPlanTestProfile(prisma)).id;

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

  async function createPlan(name: string): Promise<PlanBody> {
    const response = await postAs(planner, '/api/plans')
      .send({ name, profileId })
      .expect(201);
    return response.body as PlanBody;
  }

  async function saveDraft(
    planId: string,
    body: {
      name: string;
      expectedRevision: number;
      steps: DraftStepRequest[];
    },
    session: ClientSession = planner,
  ): Promise<DraftBody> {
    const response = await putAs(session, `/api/plans/${planId}/draft`)
      .send(body)
      .expect(200);
    return response.body as DraftBody;
  }

  function publish(
    planId: string,
    expectedRevision: number,
    session: ClientSession = planner,
  ): request.Test {
    return postAs(session, `/api/plans/${planId}/draft/publish`).send({
      expectedRevision,
    });
  }

  async function expectPublished(
    planId: string,
    expectedRevision: number,
  ): Promise<PublishedBody> {
    const response = await publish(planId, expectedRevision).expect(201);
    return response.body as PublishedBody;
  }

  it('publishes the open draft atomically with version 1 and publisher metadata', async () => {
    const plan = await createPlan('Publish success plan');
    const draft = await saveDraft(plan.id, {
      name: 'Published name',
      expectedRevision: 1,
      steps: [
        step({ name: 'Output voltage' }),
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

    const response = await publish(plan.id, draft.editRevision).expect(201);
    const published = response.body as PublishedBody;

    expect(published).toMatchObject({
      planId: plan.id,
      state: 'PUBLISHED',
      name: 'Published name',
      versionNumber: 1,
      baseVersionId: null,
      steps: draft.steps,
    });
    expect(published.id).toBe(draft.id);
    expect(Date.parse(published.publishedAt)).not.toBeNaN();

    const stored = await prisma.planRevision.findUniqueOrThrow({
      where: { id: published.id },
      include: { steps: { orderBy: { position: 'asc' } } },
    });
    expect(stored).toMatchObject({
      planId: plan.id,
      state: PlanRevisionState.PUBLISHED,
      versionNumber: 1,
      publishedById: plannerUser.id,
      editRevision: draft.editRevision,
    });
    expect(stored.publishedAt?.toISOString()).toBe(published.publishedAt);
    expect(
      stored.steps.map((entry) => ({
        logicalStepId: entry.logicalStepId,
        position: entry.position,
      })),
    ).toEqual(
      draft.steps.map((entry) => ({
        logicalStepId: entry.logicalStepId,
        position: entry.position,
      })),
    );

    const reloaded = await getAs(planner, `/api/plans/${plan.id}`).expect(200);
    const detail = reloaded.body as PlanBody;
    expect(detail.draft).toBeUndefined();
    expect(detail.latestPublishedVersion).toMatchObject({
      id: published.id,
      versionNumber: 1,
    });
    expect(detail.published).toMatchObject({
      id: published.id,
      versionNumber: 1,
      name: 'Published name',
    });

    const again = await publish(plan.id, draft.editRevision).expect(409);
    expect(again.body).toMatchObject({
      code: 'DRAFT_CONFLICT',
      details: { reason: 'NO_OPEN_DRAFT' },
    });
  });

  it('rejects missing, stale and invalid publish requests without publishing', async () => {
    const emptyPlan = await createPlan('Empty publish plan');
    const empty = await publish(emptyPlan.id, 1).expect(400);
    expect(empty.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(readFieldErrors(empty.body)).toContainEqual(
      expect.objectContaining({ path: 'steps', code: 'INVALID_VALUE' }),
    );

    const missing = await postAs(
      planner,
      `/api/plans/${emptyPlan.id}/draft/publish`,
    )
      .send({})
      .expect(400);
    expect(readFieldErrors(missing.body)).toContainEqual(
      expect.objectContaining({ path: 'expectedRevision' }),
    );

    const zero = await publish(emptyPlan.id, 0).expect(400);
    expect(readFieldErrors(zero.body)).toContainEqual(
      expect.objectContaining({
        path: 'expectedRevision',
        code: 'INVALID_VALUE',
      }),
    );

    const stringRevision = await postAs(
      planner,
      `/api/plans/${emptyPlan.id}/draft/publish`,
    )
      .send({ expectedRevision: '1' })
      .expect(400);
    expect(readFieldErrors(stringRevision.body)).toContainEqual(
      expect.objectContaining({
        path: 'expectedRevision',
        code: 'INVALID_TYPE',
      }),
    );

    const stalePlan = await createPlan('Stale publish plan');
    const saved = await saveDraft(stalePlan.id, {
      name: 'Stale draft',
      expectedRevision: 1,
      steps: [step()],
    });
    const stale = await publish(stalePlan.id, saved.editRevision - 1).expect(
      409,
    );
    expect(stale.body).toMatchObject({
      code: 'DRAFT_CONFLICT',
      details: { currentRevision: saved.editRevision },
    });
    expect(
      await prisma.planRevision.count({
        where: { planId: stalePlan.id, state: PlanRevisionState.PUBLISHED },
      }),
    ).toBe(0);

    const unknown = await publish(randomUUID(), 1).expect(404);
    expect(unknown.body).toMatchObject({ code: 'NOT_FOUND' });

    const malformed = await postAs(
      planner,
      '/api/plans/not-a-uuid/draft/publish',
    )
      .send({ expectedRevision: 1 })
      .expect(400);
    expect(malformed.body).toMatchObject({ code: 'VALIDATION_ERROR' });

    const badPositionPlan = await createPlan('Bad stored position');
    await saveDraft(badPositionPlan.id, {
      name: 'Broken draft',
      expectedRevision: 1,
      steps: [step({ name: 'First' }), step({ name: 'Second' })],
    });
    const brokenDraft = await prisma.planRevision.findFirstOrThrow({
      where: { planId: badPositionPlan.id, state: PlanRevisionState.DRAFT },
      include: { steps: { orderBy: { position: 'asc' } } },
    });
    await prisma.planStep.update({
      where: { id: brokenDraft.steps[0]!.id },
      data: { position: 9 },
    });
    const invalidContent = await publish(
      badPositionPlan.id,
      brokenDraft.editRevision,
    ).expect(400);
    expect(invalidContent.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(readFieldErrors(invalidContent.body)).toContainEqual(
      expect.objectContaining({
        path: 'steps.0.position',
        code: 'INVALID_VALUE',
      }),
    );
    expect(
      await prisma.planRevision.count({
        where: { planId: badPositionPlan.id, state: PlanRevisionState.PUBLISHED },
      }),
    ).toBe(0);
  });

  it('rejects a stored draft with more than 30 steps at publish time', async () => {
    const plan = await createPlan('Too many stored steps');
    const draft = await saveDraft(plan.id, {
      name: 'Thirty steps',
      expectedRevision: 1,
      steps: Array.from({ length: 30 }, (_, index) =>
        step({ name: `Step ${index + 1}`, sampleCount: 1, intervalMs: 100 }),
      ),
    });
    const identity = await prisma.stepIdentity.create({
      data: { planId: plan.id },
    });
    await prisma.planStep.create({
      data: {
        planId: plan.id,
        revisionId: draft.id,
        logicalStepId: identity.id,
        position: 31,
        name: 'Step 31',
        unit: 'V',
        minimum: '4.75',
        maximum: '5.25',
        sampleCount: 1,
        intervalMs: 100,
      },
    });

    const response = await publish(plan.id, draft.editRevision).expect(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(readFieldErrors(response.body)).toContainEqual(
      expect.objectContaining({ path: 'steps', code: 'INVALID_VALUE' }),
    );
    expect(
      await prisma.planRevision.count({
        where: { planId: plan.id, state: PlanRevisionState.PUBLISHED },
      }),
    ).toBe(0);
  });

  it('lets exactly one of two concurrent publishes win and assigns one version', async () => {
    const plan = await createPlan('Concurrent publish plan');
    const draft = await saveDraft(plan.id, {
      name: 'Concurrent publish',
      expectedRevision: 1,
      steps: [step()],
    });

    const [first, second] = await Promise.all([
      publish(plan.id, draft.editRevision),
      publish(plan.id, draft.editRevision),
    ]);
    const statuses = [first.status, second.status].sort(
      (left, right) => left - right,
    );
    expect(statuses).toEqual([201, 409]);

    const conflict = first.status === 409 ? first : second;
    expect(conflict.body).toMatchObject({ code: 'DRAFT_CONFLICT' });

    const published = await prisma.planRevision.findMany({
      where: { planId: plan.id, state: PlanRevisionState.PUBLISHED },
      select: { id: true, versionNumber: true },
    });
    expect(published).toHaveLength(1);
    expect(published[0]?.versionNumber).toBe(1);
    expect(
      await prisma.planRevision.count({
        where: { planId: plan.id, state: PlanRevisionState.DRAFT },
      }),
    ).toBe(0);
  });

  it('clones the latest published version into a new draft without mutating it', async () => {
    const plan = await createPlan('Clone plan');
    const firstDraft = await saveDraft(plan.id, {
      name: 'Version one',
      expectedRevision: 1,
      steps: [
        step({ name: 'Voltage', unit: 'V' }),
        step({
          name: 'Current',
          unit: 'A',
          minimum: '-0.25',
          maximum: '0.25',
          sampleCount: 25,
          intervalMs: 400,
        }),
      ],
    });
    const versionOne = await expectPublished(plan.id, firstDraft.editRevision);

    const cloneResponse = await postAs(
      planner,
      `/api/plans/${plan.id}/drafts`,
    ).expect(201);
    const clone = cloneResponse.body as DraftBody;

    expect(clone).toMatchObject({
      planId: plan.id,
      state: 'DRAFT',
      name: 'Version one',
      editRevision: 1,
      versionNumber: null,
      baseVersionId: versionOne.id,
    });
    expect(clone.id).not.toBe(versionOne.id);
    expect(clone.steps).toEqual(versionOne.steps);

    const secondCreate = await postAs(
      planner,
      `/api/plans/${plan.id}/drafts`,
    ).expect(409);
    expect(secondCreate.body).toMatchObject({
      code: 'DRAFT_CONFLICT',
      details: { reason: 'OPEN_DRAFT_EXISTS', currentRevision: 1 },
    });
    expect(
      await prisma.planRevision.count({
        where: { planId: plan.id, state: PlanRevisionState.DRAFT },
      }),
    ).toBe(1);

    const publishedBefore = await prisma.planRevision.findUniqueOrThrow({
      where: { id: versionOne.id },
      include: { steps: { orderBy: { position: 'asc' } } },
    });
    const publishedStepsBefore = publishedBefore.steps.map((entry) => ({
      logicalStepId: entry.logicalStepId,
      position: entry.position,
      name: entry.name,
      unit: entry.unit,
      minimum: entry.minimum.toFixed(6),
      maximum: entry.maximum.toFixed(6),
      sampleCount: entry.sampleCount,
      intervalMs: entry.intervalMs,
    }));

    const edited = await saveDraft(plan.id, {
      name: 'Version two draft',
      expectedRevision: 1,
      steps: [
        step({ logicalStepId: clone.steps[0]!.logicalStepId, name: 'Voltage v2' }),
        step({
          logicalStepId: clone.steps[1]!.logicalStepId,
          name: 'Current v2',
          unit: 'A',
          minimum: '-0.5',
          maximum: '0.5',
          sampleCount: 30,
          intervalMs: 450,
        }),
      ],
    });
    expect(edited.editRevision).toBe(2);
    expect(edited.steps.map((entry) => entry.logicalStepId)).toEqual(
      clone.steps.map((entry) => entry.logicalStepId),
    );

    const publishedAfter = await prisma.planRevision.findUniqueOrThrow({
      where: { id: versionOne.id },
      include: { steps: { orderBy: { position: 'asc' } } },
    });
    expect(publishedAfter.publishedAt).toEqual(publishedBefore.publishedAt);
    expect(
      publishedAfter.steps.map((entry) => ({
        logicalStepId: entry.logicalStepId,
        position: entry.position,
        name: entry.name,
        unit: entry.unit,
        minimum: entry.minimum.toFixed(6),
        maximum: entry.maximum.toFixed(6),
        sampleCount: entry.sampleCount,
        intervalMs: entry.intervalMs,
      })),
    ).toEqual(publishedStepsBefore);

    const versionTwo = await expectPublished(plan.id, edited.editRevision);
    expect(versionTwo.versionNumber).toBe(2);
    expect(versionTwo.baseVersionId).toBe(versionOne.id);
    expect(versionTwo.steps.map((entry) => entry.name)).toEqual([
      'Voltage v2',
      'Current v2',
    ]);

    const versions = await getAs(
      planner,
      `/api/plans/${plan.id}/versions`,
    ).expect(200);
    const list = versions.body as VersionListItemBody[];
    expect(list.map((entry) => entry.versionNumber)).toEqual([2, 1]);
    expect(list.map((entry) => entry.name)).toEqual([
      'Version two draft',
      'Version one',
    ]);

    const thirdDraft = await postAs(
      planner,
      `/api/plans/${plan.id}/drafts`,
    ).expect(201);
    expect((thirdDraft.body as DraftBody).baseVersionId).toBe(versionTwo.id);
    expect((thirdDraft.body as DraftBody).steps).toEqual(versionTwo.steps);

    const missingPublished = await prisma.testPlan.create({
      data: {
        createdById: plannerUser.id,
        deviceProfileId: profileId,
      },
    });
    const noVersion = await postAs(
      planner,
      `/api/plans/${missingPublished.id}/drafts`,
    ).expect(409);
    expect(noVersion.body).toMatchObject({
      code: 'DRAFT_CONFLICT',
      details: { reason: 'NO_PUBLISHED_VERSION' },
    });
  });

  it('protects role access, draft ids and publisher summaries on version reads', async () => {
    const plan = await createPlan('Version access plan');
    const draft = await saveDraft(plan.id, {
      name: 'Version access',
      expectedRevision: 1,
      steps: [step()],
    });
    const published = await expectPublished(plan.id, draft.editRevision);
    const openDraftResponse = await postAs(
      planner,
      `/api/plans/${plan.id}/drafts`,
    ).expect(201);
    const openDraft = openDraftResponse.body as DraftBody;

    for (const session of [planner, operator, viewer]) {
      const listResponse = await getAs(
        session,
        `/api/plans/${plan.id}/versions`,
      ).expect(200);
      const list = listResponse.body as VersionListItemBody[];
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        id: published.id,
        versionNumber: 1,
        name: 'Version access',
        publishedAt: published.publishedAt,
        publishedBy: {
          id: plannerUser.id,
          email: plannerUser.email,
          role: 'PLANNER',
        },
      });
      expect(JSON.stringify(listResponse.body)).not.toContain('passwordHash');

      const detailResponse = await getAs(
        session,
        `/api/plan-versions/${published.id}`,
      ).expect(200);
      const detail = detailResponse.body as PublishedBody;
      expect(detail).toMatchObject({
        id: published.id,
        planId: plan.id,
        state: 'PUBLISHED',
        versionNumber: 1,
        steps: published.steps,
      });

      const draftAsVersion = await getAs(
        session,
        `/api/plan-versions/${openDraft.id}`,
      ).expect(404);
      expect(draftAsVersion.body).toMatchObject({ code: 'NOT_FOUND' });
    }

    const draftOnly = await createPlan('Draft-only versions plan');
    const plannerVersions = await getAs(
      planner,
      `/api/plans/${draftOnly.id}/versions`,
    ).expect(200);
    expect(plannerVersions.body).toEqual([]);

    for (const session of [operator, viewer]) {
      const hidden = await getAs(
        session,
        `/api/plans/${draftOnly.id}/versions`,
      ).expect(404);
      expect(hidden.body).toMatchObject({ code: 'NOT_FOUND' });
      expect(JSON.stringify(hidden.body)).not.toContain(
        'Draft-only versions plan',
      );
    }

    const unknown = await getAs(
      planner,
      `/api/plan-versions/${randomUUID()}`,
    ).expect(404);
    expect(unknown.body).toMatchObject({ code: 'NOT_FOUND' });

    const malformed = await getAs(
      planner,
      '/api/plan-versions/not-a-uuid',
    ).expect(400);
    expect(malformed.body).toMatchObject({ code: 'VALIDATION_ERROR' });

    const forbiddenPublish = await publish(
      plan.id,
      1,
      operator,
    ).expect(403);
    expect(forbiddenPublish.body).toMatchObject({ code: 'FORBIDDEN' });

    const forbiddenDraft = await postAs(
      viewer,
      `/api/plans/${plan.id}/drafts`,
    ).expect(403);
    expect(forbiddenDraft.body).toMatchObject({ code: 'FORBIDDEN' });

    const noCsrf = await request(server())
      .post(`/api/plans/${plan.id}/drafts`)
      .set('Cookie', planner.cookie)
      .expect(403);
    expect(noCsrf.body).toMatchObject({ code: 'FORBIDDEN' });
    expect(noCsrf.body.message).toMatch(/CSRF/i);
  });

  it('rejects direct SQL updates, deletes and step inserts on published content', async () => {
    const plan = await createPlan('Direct SQL plan');
    const draft = await saveDraft(plan.id, {
      name: 'Immutable version',
      expectedRevision: 1,
      steps: [step({ name: 'Immutable step' })],
    });
    const published = await expectPublished(plan.id, draft.editRevision);
    const stepId = published.steps[0]!.logicalStepId;
    const storedStep = await prisma.planStep.findFirstOrThrow({
      where: { revisionId: published.id, logicalStepId: stepId },
    });

    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "plan_revisions" SET "name" = 'Changed' WHERE "id" = '${published.id}'`,
      ),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRawUnsafe(
        `DELETE FROM "plan_revisions" WHERE "id" = '${published.id}'`,
      ),
    ).rejects.toThrow();

    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "plan_steps" SET "name" = 'Changed' WHERE "id" = '${storedStep.id}'`,
      ),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRawUnsafe(
        `DELETE FROM "plan_steps" WHERE "id" = '${storedStep.id}'`,
      ),
    ).rejects.toThrow();

    const extraIdentity = await prisma.stepIdentity.create({
      data: { planId: plan.id },
    });
    await expect(
      prisma.$executeRaw`
        INSERT INTO "plan_steps" (
          "revisionId", "planId", "logicalStepId", "position", "name", "unit",
          "minimum", "maximum", "sampleCount", "intervalMs"
        ) VALUES (
          ${published.id}::uuid, ${plan.id}::uuid, ${extraIdentity.id}::uuid,
          2, 'Late step', 'V', ${'4.75'}::numeric, ${'5.25'}::numeric, 100, 250
        )
      `,
    ).rejects.toThrow();

    const revisionAfter = await prisma.planRevision.findUniqueOrThrow({
      where: { id: published.id },
      include: { steps: { orderBy: { position: 'asc' } } },
    });
    expect(revisionAfter.name).toBe('Immutable version');
    expect(revisionAfter.steps).toHaveLength(1);
    expect(revisionAfter.steps[0]?.name).toBe('Immutable step');
    expect(
      await prisma.planRevision.count({
        where: { planId: plan.id, state: PlanRevisionState.PUBLISHED },
      }),
    ).toBe(1);
  });

  it('serializes publish against a concurrent save with the same expectedRevision', async () => {
    const plan = await createPlan('Publish save race plan');
    const draft = await saveDraft(plan.id, {
      name: 'Race base',
      expectedRevision: 1,
      steps: [step({ name: 'Race step' })],
    });

    const saveBody = {
      name: 'Race saved',
      expectedRevision: draft.editRevision,
      steps: [step({ logicalStepId: draft.steps[0]!.logicalStepId, name: 'Saved step' })],
    };

    const [publishResponse, saveResponse] = await Promise.all([
      publish(plan.id, draft.editRevision),
      putAs(planner, `/api/plans/${plan.id}/draft`).send(saveBody),
    ]);

    const statuses = [publishResponse.status, saveResponse.status].sort(
      (left, right) => left - right,
    );
    expect(statuses).toEqual([201, 409]);

    if (publishResponse.status === 201) {
      expect(saveResponse.status).toBe(409);
      const published = publishResponse.body as PublishedBody;
      expect(published.name).toBe('Race base');
      expect(published.steps[0]?.name).toBe('Race step');
      expect(
        await prisma.planRevision.count({
          where: { planId: plan.id, state: PlanRevisionState.DRAFT },
        }),
      ).toBe(0);
    } else {
      expect(saveResponse.status).toBe(200);
      const saved = saveResponse.body as DraftBody;
      expect(saved.editRevision).toBe(2);
      expect(saved.steps[0]?.name).toBe('Saved step');
      expect(
        await prisma.planRevision.count({
          where: { planId: plan.id, state: PlanRevisionState.PUBLISHED },
        }),
      ).toBe(0);
      expect(
        await prisma.planRevision.count({
          where: { planId: plan.id, state: PlanRevisionState.DRAFT },
        }),
      ).toBe(1);
    }
  });

  it('aborts a publish whose locked row changed while waiting for a direct step insert', async () => {
    const plan = await createPlan('Direct insert race plan');
    const draft = await saveDraft(plan.id, {
      name: 'Race draft',
      expectedRevision: 1,
      steps: [step({ name: 'Original step' })],
    });
    const extraIdentity = await prisma.stepIdentity.create({
      data: { planId: plan.id },
    });

    let releaseInsert!: () => void;
    const holdInsert = new Promise<void>((resolve) => {
      releaseInsert = resolve;
    });
    let signalInserted!: () => void;
    const insertExecuted = new Promise<void>((resolve) => {
      signalInserted = resolve;
    });

    const insertTransaction = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO "plan_steps" (
          "revisionId", "planId", "logicalStepId", "position", "name", "unit",
          "minimum", "maximum", "sampleCount", "intervalMs"
        ) VALUES (
          ${draft.id}::uuid, ${plan.id}::uuid, ${extraIdentity.id}::uuid,
          2, 'Raced step', 'V', ${'4.75'}::numeric, ${'5.25'}::numeric, 100, 250
        )
      `;
      signalInserted();
      await holdInsert;
    });

    try {
      await insertExecuted;

      const publishPromise = publish(plan.id, draft.editRevision).then(
        (response) => response,
      );
      await waitForPlanRevisionUpdateLock();

      releaseInsert();
      await insertTransaction;

      const response = await publishPromise;
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        code: 'DRAFT_CONFLICT',
        details: { reason: 'DRAFT_CHANGED' },
      });

      const storedDraft = await prisma.planRevision.findFirstOrThrow({
        where: { planId: plan.id, state: PlanRevisionState.DRAFT },
        include: { steps: { orderBy: { position: 'asc' } } },
      });
      expect(storedDraft.steps.map((entry) => entry.name)).toEqual([
        'Original step',
        'Raced step',
      ]);
      expect(
        await prisma.planRevision.count({
          where: { planId: plan.id, state: PlanRevisionState.PUBLISHED },
        }),
      ).toBe(0);
    } finally {
      releaseInsert();
      await insertTransaction.catch(() => undefined);
    }
  });

  async function waitForPlanRevisionUpdateLock(): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const rows = await prisma.$queryRaw<Array<{ count: number }>>`
        SELECT count(*)::int AS "count"
        FROM "pg_stat_activity"
        WHERE "application_name" = 'probedesk-api'
          AND "wait_event_type" = 'Lock'
          AND "state" = 'active'
      `;

      if ((rows[0]?.count ?? 0) > 0) {
        return;
      }

      await delay(20);
    }

    throw new Error('The publish transaction did not wait for the step insert.');
  }
});
