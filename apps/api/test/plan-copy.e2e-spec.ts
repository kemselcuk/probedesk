import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from '../src/auth/auth.constants.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PlanRevisionState, Role } from '../src/prisma/generated/client.js';
import { createOpenApiDocument } from '../src/common/openapi/openapi.js';
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
} from './support/plan-helpers.js';
import {
  deletePlanCopyTestData,
  installPlanCopyFailureTrigger,
  removePlanCopyFailureTrigger,
} from './support/plan-copy-helpers.js';

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

interface PlanBody {
  id: string;
  name: string;
  profile: {
    id: string;
    code: string;
    name: string;
    description: string | null;
  };
  latestPublishedVersion: { id: string; versionNumber: number } | null;
  draft?: DraftBody | null;
  published: PublishedBody | null;
}

interface CopyResponseBody {
  planId: string;
  draftRevisionId: string;
  sourceVersionId: string;
  replayed: boolean;
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

const sourceSteps: DraftStepRequest[] = [
  step({
    name: 'Output voltage',
    unit: 'V',
    minimum: '4.750000',
    maximum: '5.250000',
    sampleCount: 100,
    intervalMs: 250,
  }),
  step({
    name: 'Output current',
    unit: 'A',
    minimum: '-0.500000',
    maximum: '0.125000',
    sampleCount: 37,
    intervalMs: 1000,
  }),
  step({
    name: 'Leakage resistance',
    unit: 'MOhm',
    minimum: '0.000001',
    maximum: '999.999999',
    sampleCount: 999,
    intervalMs: 500,
  }),
];

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

function stepContent(entry: StepBody): Omit<StepBody, 'logicalStepId'> {
  return {
    position: entry.position,
    name: entry.name,
    unit: entry.unit,
    minimum: entry.minimum,
    maximum: entry.maximum,
    sampleCount: entry.sampleCount,
    intervalMs: entry.intervalMs,
  };
}

function storedStepContent(entry: {
  position: number;
  name: string;
  unit: string;
  minimum: { toFixed(digits: number): string };
  maximum: { toFixed(digits: number): string };
  sampleCount: number;
  intervalMs: number;
}): Omit<StepBody, 'logicalStepId'> {
  return {
    position: entry.position,
    name: entry.name,
    unit: entry.unit,
    minimum: entry.minimum.toFixed(6),
    maximum: entry.maximum.toFixed(6),
    sampleCount: entry.sampleCount,
    intervalMs: entry.intervalMs,
  };
}

describe('plan copy API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let plannerUser: TestUser;
  let otherPlannerUser: TestUser;
  let operatorUser: TestUser;
  let viewerUser: TestUser;
  let profileId: string;
  let planner: ClientSession;
  let otherPlanner: ClientSession;
  let operator: ClientSession;
  let viewer: ClientSession;

  const server = () => app.getHttpServer();

  beforeAll(async () => {
    app = await createTestApplication();
    prisma = app.get(PrismaService);

    await deletePlanCopyTestData(prisma);

    plannerUser = await createPlanTestUser(prisma, Role.PLANNER);
    otherPlannerUser = await createPlanTestUser(prisma, Role.PLANNER);
    operatorUser = await createPlanTestUser(prisma, Role.OPERATOR);
    viewerUser = await createPlanTestUser(prisma, Role.VIEWER);
    profileId = (await createPlanTestProfile(prisma)).id;

    planner = await login(plannerUser);
    otherPlanner = await login(otherPlannerUser);
    operator = await login(operatorUser);
    viewer = await login(viewerUser);
  });

  afterAll(async () => {
    if (prisma) {
      await removePlanCopyFailureTrigger(prisma).catch(() => undefined);
      await deletePlanCopyTestData(prisma);
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

  function putAs(session: ClientSession, path: string): request.Test {
    return request(server())
      .put(path)
      .set('Cookie', session.cookie)
      .set('X-XSRF-TOKEN', session.csrfToken);
  }

  function copyAs(
    session: ClientSession,
    sourceVersionId: string,
    idempotencyKey?: string | null,
  ): request.Test {
    let call = postAs(session, `/api/plan-versions/${sourceVersionId}/copy`);

    if (idempotencyKey !== null && idempotencyKey !== undefined) {
      call = call.set('Idempotency-Key', idempotencyKey);
    }

    return call;
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
  ): Promise<DraftBody> {
    const response = await putAs(planner, `/api/plans/${planId}/draft`)
      .send(body)
      .expect(200);
    return response.body as DraftBody;
  }

  async function createPublishedSource(
    name: string,
    steps: DraftStepRequest[] = sourceSteps,
  ): Promise<{ plan: PlanBody; draft: DraftBody; published: PublishedBody }> {
    const plan = await createPlan(name);
    const draft = await saveDraft(plan.id, {
      name,
      expectedRevision: 1,
      steps,
    });
    const response = await postAs(
      planner,
      `/api/plans/${plan.id}/draft/publish`,
    )
      .send({ expectedRevision: draft.editRevision })
      .expect(201);

    return { plan, draft, published: response.body as PublishedBody };
  }

  async function copyRequestCount(
    requestedById: string,
    idempotencyKey: string,
  ): Promise<number> {
    return prisma.planCopyRequest.count({
      where: { requestedById, idempotencyKey },
    });
  }

  it('copies a published version into an independent draft with exact values and fresh identities', async () => {
    const source = await createPublishedSource(`Copy source ${randomUUID()}`);
    const sourceBefore = (
      await getAs(planner, `/api/plan-versions/${source.published.id}`).expect(
        200,
      )
    ).body as PublishedBody;

    const storedSourceBefore = await prisma.planRevision.findUniqueOrThrow({
      where: { id: source.published.id },
      include: { steps: { orderBy: { position: 'asc' } } },
    });
    const sourceStepIds = new Set(
      storedSourceBefore.steps.map((entry) => entry.id),
    );
    const sourceLogicalStepIds = new Set(
      storedSourceBefore.steps.map((entry) => entry.logicalStepId),
    );
    const sourceRunsBefore = await prisma.testRun.count({
      where: { planId: source.plan.id },
    });

    const key = `copy-${randomUUID()}`;
    const response = await copyAs(planner, source.published.id, key)
      .send({ name: '  Copied power rail  ' })
      .expect(201);
    const copied = response.body as CopyResponseBody;

    expect(Object.keys(response.body).sort()).toEqual([
      'draftRevisionId',
      'planId',
      'replayed',
      'sourceVersionId',
    ]);
    expect(copied).toMatchObject({
      sourceVersionId: source.published.id,
      replayed: false,
    });
    expect(copied.planId).not.toBe(source.plan.id);
    expect(copied.draftRevisionId).not.toBe(source.published.id);

    const targetPlan = await prisma.testPlan.findUniqueOrThrow({
      where: { id: copied.planId },
    });
    expect(targetPlan).toMatchObject({
      createdById: plannerUser.id,
      deviceProfileId: profileId,
    });

    const targetRevision = await prisma.planRevision.findUniqueOrThrow({
      where: { id: copied.draftRevisionId },
      include: { steps: { orderBy: { position: 'asc' } } },
    });
    expect(targetRevision).toMatchObject({
      planId: copied.planId,
      state: PlanRevisionState.DRAFT,
      name: 'Copied power rail',
      editRevision: 1,
      versionNumber: null,
      baseVersionId: null,
      publishedAt: null,
      publishedById: null,
    });
    expect(targetRevision.steps.map(storedStepContent)).toEqual(
      source.published.steps.map(stepContent),
    );

    const copiedLogicalStepIds = targetRevision.steps.map(
      (entry) => entry.logicalStepId,
    );
    expect(new Set(copiedLogicalStepIds).size).toBe(
      copiedLogicalStepIds.length,
    );
    for (const logicalStepId of copiedLogicalStepIds) {
      expect(sourceLogicalStepIds.has(logicalStepId)).toBe(false);
    }
    for (const entry of targetRevision.steps) {
      expect(sourceStepIds.has(entry.id)).toBe(false);
    }

    const identities = await prisma.stepIdentity.findMany({
      where: { planId: copied.planId },
      select: { id: true },
    });
    expect(identities.map((entry) => entry.id).sort()).toEqual(
      [...copiedLogicalStepIds].sort(),
    );

    const storedRequest = await prisma.planCopyRequest.findUniqueOrThrow({
      where: {
        requestedById_idempotencyKey: {
          requestedById: plannerUser.id,
          idempotencyKey: key,
        },
      },
    });
    expect(storedRequest).toMatchObject({
      sourceVersionId: source.published.id,
      targetPlanId: copied.planId,
    });
    expect(storedRequest.requestHash).toMatch(/^[0-9a-f]{64}$/);

    const targetDetail = (
      await getAs(planner, `/api/plans/${copied.planId}`).expect(200)
    ).body as PlanBody;
    expect(targetDetail.draft).toMatchObject({
      id: copied.draftRevisionId,
      planId: copied.planId,
      state: 'DRAFT',
      name: 'Copied power rail',
      editRevision: 1,
      versionNumber: null,
      baseVersionId: null,
    });
    expect(targetDetail.draft?.steps.map(stepContent)).toEqual(
      source.published.steps.map(stepContent),
    );

    const sourceAfter = (
      await getAs(planner, `/api/plan-versions/${source.published.id}`).expect(
        200,
      )
    ).body as PublishedBody;
    expect(sourceAfter).toEqual(sourceBefore);

    const storedSourceAfter = await prisma.planRevision.findUniqueOrThrow({
      where: { id: source.published.id },
      include: { steps: { orderBy: { position: 'asc' } } },
    });
    expect(storedSourceAfter.name).toBe(storedSourceBefore.name);
    expect(storedSourceAfter.state).toBe(storedSourceBefore.state);
    expect(storedSourceAfter.versionNumber).toBe(
      storedSourceBefore.versionNumber,
    );
    expect(storedSourceAfter.publishedAt).toEqual(
      storedSourceBefore.publishedAt,
    );
    expect(
      storedSourceAfter.steps.map((entry) => ({
        id: entry.id,
        logicalStepId: entry.logicalStepId,
        ...storedStepContent(entry),
      })),
    ).toEqual(
      storedSourceBefore.steps.map((entry) => ({
        id: entry.id,
        logicalStepId: entry.logicalStepId,
        ...storedStepContent(entry),
      })),
    );
    expect(
      await prisma.testRun.count({ where: { planId: source.plan.id } }),
    ).toBe(sourceRunsBefore);
  });

  it('enforces Planner role, CSRF, request validation and published-only sources', async () => {
    const source = await createPublishedSource(
      `Copy validation source ${randomUUID()}`,
    );
    const key = `copy-validation-${randomUUID()}`;
    const body = { name: 'Validation copy' };

    const forbiddenOperator = await copyAs(operator, source.published.id, key)
      .send(body)
      .expect(403);
    expect(forbiddenOperator.body).toMatchObject({ code: 'FORBIDDEN' });

    const forbiddenViewer = await copyAs(viewer, source.published.id, key)
      .send(body)
      .expect(403);
    expect(forbiddenViewer.body).toMatchObject({ code: 'FORBIDDEN' });

    const unauthenticated = await request(server())
      .post(`/api/plan-versions/${source.published.id}/copy`)
      .set('Idempotency-Key', key)
      .send(body)
      .expect(401);
    expect(unauthenticated.body).toMatchObject({ code: 'UNAUTHENTICATED' });

    const noCsrf = await request(server())
      .post(`/api/plan-versions/${source.published.id}/copy`)
      .set('Cookie', planner.cookie)
      .set('Idempotency-Key', key)
      .send(body)
      .expect(403);
    expect(noCsrf.body).toMatchObject({ code: 'FORBIDDEN' });
    expect(noCsrf.body.message).toMatch(/CSRF/i);

    const missingKey = await copyAs(planner, source.published.id, null)
      .send(body)
      .expect(400);
    expect(readFieldErrors(missingKey.body)).toContainEqual(
      expect.objectContaining({
        path: 'Idempotency-Key',
        code: 'REQUIRED',
      }),
    );

    const blankKey = await copyAs(planner, source.published.id, '   ')
      .send(body)
      .expect(400);
    expect(readFieldErrors(blankKey.body)).toContainEqual(
      expect.objectContaining({ path: 'Idempotency-Key' }),
    );

    const overlongKey = await copyAs(
      planner,
      source.published.id,
      'k'.repeat(201),
    )
      .send(body)
      .expect(400);
    expect(readFieldErrors(overlongKey.body)).toContainEqual(
      expect.objectContaining({
        path: 'Idempotency-Key',
        code: 'INVALID_VALUE',
      }),
    );

    const missingName = await copyAs(planner, source.published.id, key)
      .send({})
      .expect(400);
    expect(readFieldErrors(missingName.body)).toContainEqual(
      expect.objectContaining({ path: 'name' }),
    );

    const blankName = await copyAs(planner, source.published.id, key)
      .send({ name: '   ' })
      .expect(400);
    expect(readFieldErrors(blankName.body)).toContainEqual(
      expect.objectContaining({ path: 'name', code: 'INVALID_VALUE' }),
    );

    const longName = await copyAs(planner, source.published.id, key)
      .send({ name: 'n'.repeat(101) })
      .expect(400);
    expect(readFieldErrors(longName.body)).toContainEqual(
      expect.objectContaining({ path: 'name', code: 'INVALID_VALUE' }),
    );

    const wrongTypeName = await copyAs(planner, source.published.id, key)
      .send({ name: 42 })
      .expect(400);
    expect(readFieldErrors(wrongTypeName.body)).toContainEqual(
      expect.objectContaining({ path: 'name', code: 'INVALID_TYPE' }),
    );

    const unknownField = await copyAs(planner, source.published.id, key)
      .send({
        name: 'Unknown field copy',
        sourceVersionId: source.published.id,
      })
      .expect(400);
    expect(readFieldErrors(unknownField.body)).toContainEqual(
      expect.objectContaining({
        path: 'sourceVersionId',
        code: 'UNKNOWN_FIELD',
      }),
    );

    const unknownSource = await copyAs(planner, randomUUID(), key)
      .send(body)
      .expect(404);
    expect(unknownSource.body).toMatchObject({ code: 'NOT_FOUND' });

    const malformedSource = await copyAs(planner, 'not-a-uuid', key)
      .send(body)
      .expect(400);
    expect(malformedSource.body).toMatchObject({ code: 'VALIDATION_ERROR' });

    const draftOnlyPlan = await createPlan(`Draft only ${randomUUID()}`);
    const draftOnly = await saveDraft(draftOnlyPlan.id, {
      name: 'Draft only source',
      expectedRevision: 1,
      steps: [step()],
    });
    const unpublished = await copyAs(planner, draftOnly.id, key)
      .send(body)
      .expect(404);
    expect(unpublished.body).toMatchObject({ code: 'NOT_FOUND' });

    const maxKey = 'k'.repeat(200);
    const accepted = await copyAs(planner, source.published.id, maxKey)
      .send({ name: 'Maximum key copy' })
      .expect(201);
    expect((accepted.body as CopyResponseBody).replayed).toBe(false);

    const replayed = await copyAs(planner, source.published.id, maxKey)
      .send({ name: 'Maximum key copy' })
      .expect(200);
    expect((replayed.body as CopyResponseBody).replayed).toBe(true);
  });

  it('replays the original target and rejects a key reused with a different request', async () => {
    const sourceA = await createPublishedSource(
      `Replay source A ${randomUUID()}`,
    );
    const sourceB = await createPublishedSource(
      `Replay source B ${randomUUID()}`,
    );
    const key = `copy-replay-${randomUUID()}`;
    const name = `Replay target ${randomUUID()}`;
    const uppercaseSourceId = sourceA.published.id.toUpperCase();

    const created = await copyAs(planner, uppercaseSourceId, key)
      .send({ name })
      .expect(201);
    const first = created.body as CopyResponseBody;
    expect(first.sourceVersionId).toBe(sourceA.published.id);

    const repeated = await copyAs(planner, sourceA.published.id, key)
      .send({ name })
      .expect(200);
    expect(repeated.body).toEqual({ ...first, replayed: true });

    const canonicalRepeat = await copyAs(planner, sourceA.published.id, key)
      .send({ name: `  ${name}  ` })
      .expect(200);
    expect(canonicalRepeat.body).toEqual({ ...first, replayed: true });

    const differentName = `Different target ${randomUUID()}`;
    const conflictName = await copyAs(planner, sourceA.published.id, key)
      .send({ name: differentName })
      .expect(409);
    expect(conflictName.body).toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
      details: { reason: 'REQUEST_MISMATCH' },
    });
    expect(
      await prisma.planRevision.count({ where: { name: differentName } }),
    ).toBe(0);

    const caseName = name.toUpperCase();
    expect(caseName).not.toBe(name);
    const conflictCase = await copyAs(planner, sourceA.published.id, key)
      .send({ name: caseName })
      .expect(409);
    expect(conflictCase.body).toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
      details: { reason: 'REQUEST_MISMATCH' },
    });

    const conflictSource = await copyAs(planner, sourceB.published.id, key)
      .send({ name })
      .expect(409);
    expect(conflictSource.body).toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
      details: { reason: 'REQUEST_MISMATCH' },
    });

    expect(await copyRequestCount(plannerUser.id, key)).toBe(1);
    const targetPlans = await prisma.testPlan.findMany({
      where: {
        createdById: plannerUser.id,
        copyRequests: { some: { idempotencyKey: key } },
      },
      select: { id: true },
    });
    expect(targetPlans).toEqual([{ id: first.planId }]);

    const otherCreated = await copyAs(otherPlanner, sourceA.published.id, key)
      .send({ name })
      .expect(201);
    const other = otherCreated.body as CopyResponseBody;
    expect(other.replayed).toBe(false);
    expect(other.planId).not.toBe(first.planId);
    expect(
      await prisma.planCopyRequest.count({
        where: {
          requestedById: otherPlannerUser.id,
          idempotencyKey: key,
        },
      }),
    ).toBe(1);

    const publishedTarget = await postAs(
      planner,
      `/api/plans/${first.planId}/draft/publish`,
    )
      .send({ expectedRevision: 1 })
      .expect(201);
    expect((publishedTarget.body as PublishedBody).id).toBe(
      first.draftRevisionId,
    );

    const nextDraft = await postAs(
      planner,
      `/api/plans/${first.planId}/drafts`,
    ).expect(201);
    expect((nextDraft.body as DraftBody).baseVersionId).toBe(
      first.draftRevisionId,
    );
    expect((nextDraft.body as DraftBody).id).not.toBe(first.draftRevisionId);

    const replayAfterPublish = await copyAs(planner, sourceA.published.id, key)
      .send({ name })
      .expect(200);
    expect(replayAfterPublish.body).toEqual({ ...first, replayed: true });
  });

  it('lets exactly one of two concurrent identical copies create the target', async () => {
    const concurrencyUser = await createPlanTestUser(prisma, Role.PLANNER);
    const concurrencySession = await login(concurrencyUser);
    const source = await createPublishedSource(
      `Concurrent copy source ${randomUUID()}`,
    );
    const key = `copy-concurrent-${randomUUID()}`;
    const name = `Concurrent target ${randomUUID()}`;
    const body = { name };

    const [first, second] = await Promise.all([
      copyAs(concurrencySession, source.published.id, key).send(body),
      copyAs(concurrencySession, source.published.id, key).send(body),
    ]);
    const statuses = [first.status, second.status].sort(
      (left, right) => left - right,
    );
    expect(statuses).toEqual([200, 201]);

    const created = (first.status === 201 ? first : second)
      .body as CopyResponseBody;
    const replayed = (first.status === 200 ? first : second)
      .body as CopyResponseBody;
    expect(created.replayed).toBe(false);
    expect(replayed.replayed).toBe(true);
    expect(replayed).toEqual({ ...created, replayed: true });

    const plans = await prisma.testPlan.findMany({
      where: { createdById: concurrencyUser.id },
      select: { id: true },
    });
    expect(plans.map((plan) => plan.id)).toEqual([created.planId]);

    const revisions = await prisma.planRevision.findMany({
      where: { planId: created.planId },
      select: { id: true, state: true, name: true, editRevision: true },
    });
    expect(revisions).toEqual([
      {
        id: created.draftRevisionId,
        state: PlanRevisionState.DRAFT,
        name,
        editRevision: 1,
      },
    ]);
    expect(
      await prisma.stepIdentity.count({ where: { planId: created.planId } }),
    ).toBe(source.published.steps.length);
    expect(
      await prisma.planStep.count({ where: { planId: created.planId } }),
    ).toBe(source.published.steps.length);
    expect(await copyRequestCount(concurrencyUser.id, key)).toBe(1);
  });

  it('rolls back every orphan row when a non-idempotency failure aborts the copy', async () => {
    const rollbackUser = await createPlanTestUser(prisma, Role.PLANNER);
    const rollbackSession = await login(rollbackUser);
    const source = await createPublishedSource(
      `Rollback copy source ${randomUUID()}`,
    );
    const key = `copy-rollback-${randomUUID()}`;
    const name = `Rollback target ${randomUUID()}`;

    await installPlanCopyFailureTrigger(prisma);

    try {
      const response = await copyAs(rollbackSession, source.published.id, key)
        .send({ name })
        .expect(500);
      expect(response.body).toMatchObject({ code: 'INTERNAL_ERROR' });

      const plans = await prisma.testPlan.findMany({
        where: { createdById: rollbackUser.id },
        select: { id: true },
      });
      expect(plans).toEqual([]);
      expect(await prisma.planRevision.count({ where: { name } })).toBe(0);
      expect(await copyRequestCount(rollbackUser.id, key)).toBe(0);
      expect(
        await prisma.stepIdentity.count({
          where: { planId: { in: plans.map((plan) => plan.id) } },
        }),
      ).toBe(0);
    } finally {
      await removePlanCopyFailureTrigger(prisma);
    }

    const retried = await copyAs(rollbackSession, source.published.id, key)
      .send({ name })
      .expect(201);
    expect((retried.body as CopyResponseBody).replayed).toBe(false);
    expect(
      await prisma.testPlan.count({ where: { createdById: rollbackUser.id } }),
    ).toBe(1);
    expect(await copyRequestCount(rollbackUser.id, key)).toBe(1);
  });

  it('documents the copy route with the fixed DTO names and idempotency header', async () => {
    const openapiApp = await createTestApplication(
      {
        databaseUrl:
          'postgresql://probedesk:probedesk@127.0.0.1:59999/probedesk_test?schema=public',
      },
      { swagger: true },
    );

    try {
      const document = createOpenApiDocument(openapiApp);
      const operation = document.paths['/api/plan-versions/{id}/copy']?.post;

      expect(operation).toBeDefined();
      expect(operation?.security).toEqual([{ session: [], csrfToken: [] }]);
      expect(operation?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'Idempotency-Key',
            in: 'header',
            required: true,
          }),
        ]),
      );
      expect(Object.keys(operation?.responses ?? {})).toEqual(
        expect.arrayContaining([
          '200',
          '201',
          '400',
          '401',
          '403',
          '404',
          '409',
        ]),
      );
      expect(operation?.responses['201']).toMatchObject({
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CopyPlanResponseDto' },
          },
        },
      });

      const schemas = document.components?.schemas;
      expect(schemas).toMatchObject({
        CopyPlanDto: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
          },
        },
        CopyPlanResponseDto: {
          type: 'object',
          required: [
            'planId',
            'draftRevisionId',
            'sourceVersionId',
            'replayed',
          ],
          properties: {
            planId: { type: 'string', format: 'uuid' },
            draftRevisionId: { type: 'string', format: 'uuid' },
            sourceVersionId: { type: 'string', format: 'uuid' },
            replayed: { type: 'boolean' },
          },
        },
      });
    } finally {
      await openapiApp.close();
    }
  });
});
