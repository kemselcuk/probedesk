import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MalformedApiResponseError } from '../../core/http/malformed-api-response.error';
import { PlansApi } from './plans-api';
import type { SaveDraftRequest } from './plans-api.types';

const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const VERSION_ID = '22222222-2222-4222-8222-222222222222';
const PROFILE_ID = '33333333-3333-4333-8333-333333333333';
const STEP_ID = '44444444-4444-4444-8444-444444444444';
const PUBLISHER_ID = '55555555-5555-4555-8555-555555555555';
const CREATED_AT = '2026-11-03T09:00:00.000Z';

const PROFILE = {
  id: PROFILE_ID,
  code: 'DC-POWER',
  name: 'DC Power Module',
  description: 'Simulated single-channel supply',
};

const STEP = {
  logicalStepId: STEP_ID,
  position: 1,
  name: 'Voltage',
  unit: 'V',
  minimum: '4.750000',
  maximum: '5.250000',
  sampleCount: 10,
  intervalMs: 1000,
};

const DRAFT = {
  id: '66666666-6666-4666-8666-666666666666',
  editRevision: 4,
  planId: PLAN_ID,
  state: 'DRAFT' as const,
  name: 'Bench plan',
  versionNumber: null,
  baseVersionId: null,
  steps: [STEP],
};

const PUBLISHED = {
  id: VERSION_ID,
  planId: PLAN_ID,
  state: 'PUBLISHED' as const,
  name: 'Bench plan',
  versionNumber: 2,
  baseVersionId: null,
  publishedAt: '2026-11-03T11:00:00.000Z',
  steps: [STEP],
};

const PLAN_DETAIL = {
  id: PLAN_ID,
  name: 'Bench plan',
  profile: PROFILE,
  createdAt: CREATED_AT,
  latestPublishedVersion: {
    id: VERSION_ID,
    versionNumber: 2,
    publishedAt: '2026-11-03T11:00:00.000Z',
  },
  draft: DRAFT,
  published: PUBLISHED,
};

describe('PlansApi', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('returns the generated plan list shape, including the Planner draft summary', async () => {
    const api = TestBed.inject(PlansApi);
    const http = TestBed.inject(HttpTestingController);

    const promise = firstValueFrom(api.listPlans());
    http.expectOne('/api/plans').flush([
      {
        id: PLAN_ID,
        name: 'Bench plan',
        profile: PROFILE,
        latestPublishedVersion: {
          id: VERSION_ID,
          versionNumber: 2,
          publishedAt: '2026-11-03T10:00:00.000Z',
        },
        draft: { id: DRAFT.id, editRevision: 4 },
      },
      {
        id: VERSION_ID,
        name: 'Published only',
        profile: PROFILE,
        latestPublishedVersion: null,
        draft: null,
      },
    ]);

    const plans = await promise;
    expect(plans).toHaveLength(2);
    expect(plans[0]?.draft?.editRevision).toBe(4);
    expect(plans[1]?.draft).toBeNull();
    expect(plans[1]?.latestPublishedVersion).toBeNull();
  });

  it('keeps an omitted draft key omitted for Operator and Viewer responses', async () => {
    const api = TestBed.inject(PlansApi);
    const http = TestBed.inject(HttpTestingController);

    const promise = firstValueFrom(api.listPlans());
    http.expectOne('/api/plans').flush([
      {
        id: PLAN_ID,
        name: 'Viewer plan',
        profile: PROFILE,
        latestPublishedVersion: null,
      },
    ]);

    const plans = await promise;
    expect(Object.hasOwn(plans[0] ?? {}, 'draft')).toBe(false);
  });

  it('rejects a list entry with a missing required field', async () => {
    const api = TestBed.inject(PlansApi);
    const http = TestBed.inject(HttpTestingController);

    const promise = firstValueFrom(api.listPlans());
    http.expectOne('/api/plans').flush([
      { id: PLAN_ID, profile: PROFILE, latestPublishedVersion: null },
    ]);

    await expect(promise).rejects.toBeInstanceOf(MalformedApiResponseError);
    await expect(promise).rejects.toThrow('GET /api/plans');
  });

  it('rejects an invented list envelope instead of guessing where the rows are', async () => {
    const api = TestBed.inject(PlansApi);
    const http = TestBed.inject(HttpTestingController);

    const promise = firstValueFrom(api.listPlans());
    http.expectOne('/api/plans').flush({ items: [] });

    await expect(promise).rejects.toBeInstanceOf(MalformedApiResponseError);
  });

  it('loads the device profile array from the generated response', async () => {
    const api = TestBed.inject(PlansApi);
    const http = TestBed.inject(HttpTestingController);

    const promise = firstValueFrom(api.listDeviceProfiles());
    http.expectOne('/api/device-profiles').flush([PROFILE]);

    await expect(promise).resolves.toEqual([PROFILE]);
  });

  it('rejects a single-object device profile response', async () => {
    const api = TestBed.inject(PlansApi);
    const http = TestBed.inject(HttpTestingController);

    const promise = firstValueFrom(api.listDeviceProfiles());
    http.expectOne('/api/device-profiles').flush(PROFILE);

    await expect(promise).rejects.toBeInstanceOf(MalformedApiResponseError);
  });

  it('returns the generated plan detail with its open draft and ordered steps', async () => {
    const api = TestBed.inject(PlansApi);
    const http = TestBed.inject(HttpTestingController);

    const promise = firstValueFrom(api.getPlan(PLAN_ID));
    const request = http.expectOne(`/api/plans/${PLAN_ID}`);
    expect(request.request.method).toBe('GET');
    request.flush(PLAN_DETAIL);

    const plan = await promise;
    expect(plan.draft?.editRevision).toBe(4);
    expect(plan.draft?.steps).toEqual([STEP]);
    expect(plan.published?.state).toBe('PUBLISHED');
    expect(plan.profile).toEqual(PROFILE);
  });

  it('fails a malformed draft instead of dropping steps or inventing a step id', async () => {
    const api = TestBed.inject(PlansApi);
    const http = TestBed.inject(HttpTestingController);

    const promise = firstValueFrom(api.getPlan(PLAN_ID));
    http.expectOne(`/api/plans/${PLAN_ID}`).flush({
      ...PLAN_DETAIL,
      draft: {
        ...DRAFT,
        steps: [{ ...STEP, logicalStepId: undefined }],
      },
    });

    await expect(promise).rejects.toBeInstanceOf(MalformedApiResponseError);
    await expect(promise).rejects.toThrow('logicalStepId');
  });

  it('fails a malformed plan instead of substituting decimal defaults', async () => {
    const api = TestBed.inject(PlansApi);
    const http = TestBed.inject(HttpTestingController);

    const promise = firstValueFrom(api.getPlan(PLAN_ID));
    http.expectOne(`/api/plans/${PLAN_ID}`).flush({
      ...PLAN_DETAIL,
      draft: {
        ...DRAFT,
        steps: [{ ...STEP, minimum: undefined }],
      },
    });

    await expect(promise).rejects.toBeInstanceOf(MalformedApiResponseError);
    await expect(promise).rejects.toThrow('minimum');
  });

  it('sends the full draft payload and returns the generated draft revision', async () => {
    const api = TestBed.inject(PlansApi);
    const http = TestBed.inject(HttpTestingController);
    const payload: SaveDraftRequest = {
      name: 'Bench plan',
      expectedRevision: 7,
      steps: [
        {
          logicalStepId: STEP_ID,
          name: 'Current',
          unit: 'A',
          minimum: '0.1',
          maximum: '2',
          sampleCount: 10,
          intervalMs: 1000,
        },
      ],
    };

    const promise = firstValueFrom(api.saveDraft(PLAN_ID, payload));
    const request = http.expectOne(`/api/plans/${PLAN_ID}/draft`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual(payload);
    request.flush({ ...DRAFT, editRevision: 8 });

    const result = await promise;
    expect(result.editRevision).toBe(8);
    expect(result.steps[0]?.logicalStepId).toBe(STEP_ID);
  });

  it('fails a save response that omits steps instead of returning an empty list', async () => {
    const api = TestBed.inject(PlansApi);
    const http = TestBed.inject(HttpTestingController);

    const promise = firstValueFrom(
      api.saveDraft(PLAN_ID, { name: 'Bench plan', expectedRevision: 7, steps: [] }),
    );
    const withoutSteps: Record<string, unknown> = { ...DRAFT };
    delete withoutSteps['steps'];
    http
      .expectOne(`/api/plans/${PLAN_ID}/draft`)
      .flush({ ...withoutSteps, editRevision: 8 });

    await expect(promise).rejects.toBeInstanceOf(MalformedApiResponseError);
    await expect(promise).rejects.toThrow('expected an array');
  });

  it('publishes only the expected revision and returns the generated revision', async () => {
    const api = TestBed.inject(PlansApi);
    const http = TestBed.inject(HttpTestingController);

    const promise = firstValueFrom(api.publishDraft(PLAN_ID, { expectedRevision: 7 }));
    const request = http.expectOne(`/api/plans/${PLAN_ID}/draft/publish`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ expectedRevision: 7 });
    request.flush(PUBLISHED, { status: 201, statusText: 'Created' });

    const published = await promise;
    expect(published.id).toBe(VERSION_ID);
    expect(published.versionNumber).toBe(2);
    expect(published.steps[0]?.minimum).toBe('4.750000');
  });

  it('creates a draft without a request body and returns the copied steps', async () => {
    const api = TestBed.inject(PlansApi);
    const http = TestBed.inject(HttpTestingController);

    const promise = firstValueFrom(api.createDraft(PLAN_ID));
    const request = http.expectOne(`/api/plans/${PLAN_ID}/drafts`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toBeNull();
    request.flush({ ...DRAFT, editRevision: 1 }, { status: 201, statusText: 'Created' });

    const draft = await promise;
    expect(draft.editRevision).toBe(1);
    expect(draft.steps[0]?.logicalStepId).toBe(STEP_ID);
  });

  it('lists published versions with the generated publisher summary', async () => {
    const api = TestBed.inject(PlansApi);
    const http = TestBed.inject(HttpTestingController);

    const promise = firstValueFrom(api.listVersions(PLAN_ID));
    const request = http.expectOne(`/api/plans/${PLAN_ID}/versions`);
    expect(request.request.method).toBe('GET');
    request.flush([
      {
        id: VERSION_ID,
        versionNumber: 2,
        name: 'Bench plan v2',
        publishedAt: '2026-11-03T11:00:00.000Z',
        publishedBy: {
          id: PUBLISHER_ID,
          email: 'planner@probedesk.local',
          role: 'PLANNER',
        },
      },
    ]);

    const versions = await promise;
    expect(versions[0]?.publishedBy.email).toBe('planner@probedesk.local');
    expect(versions[0]?.versionNumber).toBe(2);
  });

  it('reads one published version with ordered steps', async () => {
    const api = TestBed.inject(PlansApi);
    const http = TestBed.inject(HttpTestingController);

    const promise = firstValueFrom(api.getVersion(VERSION_ID));
    const request = http.expectOne(`/api/plan-versions/${VERSION_ID}`);
    expect(request.request.method).toBe('GET');
    request.flush(PUBLISHED);

    const version = await promise;
    expect(version.planId).toBe(PLAN_ID);
    expect(version.steps[0]?.name).toBe('Voltage');
  });

  it('rejects a published version whose state is not PUBLISHED', async () => {
    const api = TestBed.inject(PlansApi);
    const http = TestBed.inject(HttpTestingController);

    const promise = firstValueFrom(api.getVersion(VERSION_ID));
    http.expectOne(`/api/plan-versions/${VERSION_ID}`).flush({
      ...PUBLISHED,
      state: 'DRAFT',
    });

    await expect(promise).rejects.toBeInstanceOf(MalformedApiResponseError);
  });

  it('creates a plan and returns the generated plan detail used for navigation', async () => {
    const api = TestBed.inject(PlansApi);
    const http = TestBed.inject(HttpTestingController);

    const promise = firstValueFrom(
      api.createPlan({ name: 'New bench plan', profileId: PROFILE_ID }),
    );
    const request = http.expectOne('/api/plans');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      name: 'New bench plan',
      profileId: PROFILE_ID,
    });
    request.flush(
      {
        ...PLAN_DETAIL,
        draft: { ...DRAFT, editRevision: 1, steps: [] },
        latestPublishedVersion: null,
        published: null,
      },
      { status: 201, statusText: 'Created' },
    );

    const plan = await promise;
    expect(plan.id).toBe(PLAN_ID);
    expect(plan.draft?.editRevision).toBe(1);
  });
});
