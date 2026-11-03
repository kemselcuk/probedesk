import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PlansApi } from './plans-api';
import type { SaveDraftRequest } from './plans-api.types';

const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const VERSION_ID = '22222222-2222-4222-8222-222222222222';
const PROFILE_ID = '33333333-3333-4333-8333-333333333333';
const STEP_ID = '44444444-4444-4444-8444-444444444444';

const PROFILE = {
  id: PROFILE_ID,
  code: 'DC-POWER',
  name: 'DC Power Module',
  description: 'Simulated single-channel supply',
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

  it('normalizes a role-aware list and its envelope', async () => {
    const api = TestBed.inject(PlansApi);
    const http = TestBed.inject(HttpTestingController);

    const arrayPromise = firstValueFrom(api.listPlans());
    http.expectOne('/api/plans').flush([
      {
        id: PLAN_ID,
        name: 'Bench plan',
        deviceProfile: PROFILE,
        hasDraft: true,
        draftRevision: 4,
        latestPublishedVersion: {
          id: VERSION_ID,
          versionNumber: 2,
          publishedAt: '2026-11-03T10:00:00.000Z',
        },
      },
    ]);

    const arrayResult = await arrayPromise;
    expect(arrayResult).toEqual([
      {
        id: PLAN_ID,
        name: 'Bench plan',
        profile: PROFILE,
        latestPublishedVersion: {
          id: VERSION_ID,
          versionNumber: 2,
          publishedAt: '2026-11-03T10:00:00.000Z',
        },
        versionsKnown: true,
        hasDraft: true,
        draftKnown: true,
        draftRevision: 4,
      },
    ]);

    const wrapperPromise = firstValueFrom(api.listPlans());
    http.expectOne('/api/plans').flush({
      items: [{ id: PLAN_ID, name: 'Wrapped plan', hasDraft: false }],
    });
    const wrapperResult = await wrapperPromise;

    expect(wrapperResult[0]?.name).toBe('Wrapped plan');
    expect(wrapperResult[0]?.hasDraft).toBe(false);
    expect(wrapperResult[0]?.draftKnown).toBe(true);
    expect(wrapperResult[0]?.versionsKnown).toBe(false);
  });

  it('reads the API draft summary object and distinguishes null from absent', async () => {
    const api = TestBed.inject(PlansApi);
    const http = TestBed.inject(HttpTestingController);

    const openPromise = firstValueFrom(api.listPlans());
    http.expectOne('/api/plans').flush([
      {
        id: PLAN_ID,
        name: 'Planner plan',
        profile: PROFILE,
        latestPublishedVersion: null,
        draft: { id: 'draft-1', editRevision: 6 },
      },
    ]);
    const open = await openPromise;
    expect(open[0]?.hasDraft).toBe(true);
    expect(open[0]?.draftKnown).toBe(true);
    expect(open[0]?.draftRevision).toBe(6);

    const closedPromise = firstValueFrom(api.listPlans());
    http.expectOne('/api/plans').flush([
      {
        id: PLAN_ID,
        name: 'Planner plan',
        profile: PROFILE,
        latestPublishedVersion: null,
        draft: null,
      },
    ]);
    const closed = await closedPromise;
    expect(closed[0]?.hasDraft).toBe(false);
    expect(closed[0]?.draftKnown).toBe(true);

    const viewerPromise = firstValueFrom(api.listPlans());
    http.expectOne('/api/plans').flush([
      {
        id: PLAN_ID,
        name: 'Viewer plan',
        profile: PROFILE,
        latestPublishedVersion: null,
      },
    ]);
    const viewer = await viewerPromise;
    expect(viewer[0]?.hasDraft).toBe(false);
    expect(viewer[0]?.draftKnown).toBe(false);
  });

  it('loads the single device profile from either a list or an envelope', async () => {
    const api = TestBed.inject(PlansApi);
    const http = TestBed.inject(HttpTestingController);

    const profilePromise = firstValueFrom(api.listDeviceProfiles());
    http.expectOne('/api/device-profiles').flush([PROFILE]);
    await expect(profilePromise).resolves.toEqual([PROFILE]);

    const singlePromise = firstValueFrom(api.listDeviceProfiles());
    http.expectOne('/api/device-profiles').flush(PROFILE);
    await expect(singlePromise).resolves.toEqual([PROFILE]);
  });

  it('loads a plan with its open draft and ordered steps', async () => {
    const api = TestBed.inject(PlansApi);
    const http = TestBed.inject(HttpTestingController);

    const promise = firstValueFrom(api.getPlan(PLAN_ID));
    const request = http.expectOne(`/api/plans/${PLAN_ID}`);
    expect(request.request.method).toBe('GET');
    request.flush({
      id: PLAN_ID,
      name: 'Bench plan',
      profile: PROFILE,
      latestPublishedVersion: { id: VERSION_ID, versionNumber: 1 },
      openDraft: {
        id: 'draft-1',
        editRevision: 7,
        name: 'Bench plan draft',
        steps: [
          {
            logicalStepId: STEP_ID,
            name: 'Voltage',
            unit: 'V',
            minimum: '4.75',
            maximum: '5.25',
            sampleCount: 10,
            intervalMs: 1000,
          },
        ],
      },
    });

    const plan = await promise;
    expect(plan.draft?.editRevision).toBe(7);
    expect(plan.draft?.name).toBe('Bench plan draft');
    expect(plan.draft?.steps).toEqual([
      {
        logicalStepId: STEP_ID,
        name: 'Voltage',
        unit: 'V',
        minimum: '4.75',
        maximum: '5.25',
        sampleCount: 10,
        intervalMs: 1000,
      },
    ]);
    expect(plan.profile).toEqual(PROFILE);
  });

  it('accepts a plan envelope with a top-level draft', async () => {
    const api = TestBed.inject(PlansApi);
    const http = TestBed.inject(HttpTestingController);

    const promise = firstValueFrom(api.getPlan(PLAN_ID));
    http.expectOne(`/api/plans/${PLAN_ID}`).flush({
      plan: { id: PLAN_ID, name: 'Wrapped detail', profile: PROFILE },
      draft: { editRevision: 2, name: 'Wrapped draft', steps: [] },
    });

    const plan = await promise;
    expect(plan.id).toBe(PLAN_ID);
    expect(plan.name).toBe('Wrapped detail');
    expect(plan.draft).toEqual({
      id: '',
      editRevision: 2,
      name: 'Wrapped draft',
      steps: [],
    });
  });

  it('sends the full draft payload and returns revision plus step ids', async () => {
    const api = TestBed.inject(PlansApi);
    const http = TestBed.inject(HttpTestingController);
    const payload: SaveDraftRequest = {
      name: 'Bench plan',
      expectedRevision: 7,
      steps: [
        {
          logicalStepId: '',
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
    request.flush({
      editRevision: 8,
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
    });

    const result = await promise;
    expect(result.editRevision).toBe(8);
    expect(result.logicalStepIds).toEqual([STEP_ID]);
    expect(result.steps?.[0]?.logicalStepId).toBe(STEP_ID);
  });

  it('publishes only the expected revision and normalizes the published steps', async () => {
    const api = TestBed.inject(PlansApi);
    const http = TestBed.inject(HttpTestingController);

    const promise = firstValueFrom(api.publishDraft(PLAN_ID, { expectedRevision: 7 }));
    const request = http.expectOne(`/api/plans/${PLAN_ID}/draft/publish`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ expectedRevision: 7 });
    request.flush(
      {
        id: VERSION_ID,
        planId: PLAN_ID,
        state: 'PUBLISHED',
        name: 'Bench plan v2',
        versionNumber: 2,
        publishedAt: '2026-11-03T11:00:00.000Z',
        steps: [
          {
            logicalStepId: STEP_ID,
            position: 1,
            name: 'Voltage',
            unit: 'V',
            minimum: '4.75',
            maximum: '5.25',
            sampleCount: 10,
            intervalMs: 1000,
          },
        ],
      },
      { status: 201, statusText: 'Created' },
    );

    const published = await promise;
    expect(published.id).toBe(VERSION_ID);
    expect(published.versionNumber).toBe(2);
    expect(published.name).toBe('Bench plan v2');
    expect(published.steps[0]?.logicalStepId).toBe(STEP_ID);
    expect(published.steps[0]?.minimum).toBe('4.75');
  });

  it('creates a draft without a request body and returns the copied steps', async () => {
    const api = TestBed.inject(PlansApi);
    const http = TestBed.inject(HttpTestingController);

    const promise = firstValueFrom(api.createDraft(PLAN_ID));
    const request = http.expectOne(`/api/plans/${PLAN_ID}/drafts`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toBeNull();
    request.flush(
      {
        id: 'draft-2',
        planId: PLAN_ID,
        state: 'DRAFT',
        name: 'Copy of bench plan',
        editRevision: 1,
        versionNumber: null,
        baseVersionId: VERSION_ID,
        steps: [
          {
            logicalStepId: STEP_ID,
            position: 1,
            name: 'Voltage',
            unit: 'V',
            minimum: '4.75',
            maximum: '5.25',
            sampleCount: 10,
            intervalMs: 1000,
          },
        ],
      },
      { status: 201, statusText: 'Created' },
    );

    const draft = await promise;
    expect(draft.editRevision).toBe(1);
    expect(draft.name).toBe('Copy of bench plan');
    expect(draft.steps[0]?.logicalStepId).toBe(STEP_ID);
  });

  it('lists published versions newest first with the publisher', async () => {
    const api = TestBed.inject(PlansApi);
    const http = TestBed.inject(HttpTestingController);
    const publisher = {
      id: '44444444-4444-4444-8444-444444444444',
      email: 'planner@probedesk.local',
      role: 'PLANNER',
    };

    const promise = firstValueFrom(api.listVersions(PLAN_ID));
    const request = http.expectOne(`/api/plans/${PLAN_ID}/versions`);
    expect(request.request.method).toBe('GET');
    request.flush([
      {
        id: VERSION_ID,
        versionNumber: 2,
        name: 'Bench plan v2',
        publishedAt: '2026-11-03T11:00:00.000Z',
        publishedBy: publisher,
      },
      {
        id: STEP_ID,
        versionNumber: 1,
        name: 'Bench plan v1',
        publishedAt: '2026-11-03T10:00:00.000Z',
        publishedBy: publisher,
      },
    ]);

    const versions = await promise;
    expect(versions.map((version) => version.versionNumber)).toEqual([2, 1]);
    expect(versions[0]?.publishedBy.email).toBe('planner@probedesk.local');
    expect(versions[0]?.name).toBe('Bench plan v2');
  });

  it('reads one published version with ordered steps', async () => {
    const api = TestBed.inject(PlansApi);
    const http = TestBed.inject(HttpTestingController);

    const promise = firstValueFrom(api.getVersion(VERSION_ID));
    const request = http.expectOne(`/api/plan-versions/${VERSION_ID}`);
    expect(request.request.method).toBe('GET');
    request.flush({
      id: VERSION_ID,
      planId: PLAN_ID,
      state: 'PUBLISHED',
      name: 'Bench plan v1',
      versionNumber: 1,
      publishedAt: '2026-11-03T10:00:00.000Z',
      steps: [
        {
          logicalStepId: STEP_ID,
          position: 1,
          name: 'Voltage',
          unit: 'V',
          minimum: '4.75',
          maximum: '5.25',
          sampleCount: 10,
          intervalMs: 1000,
        },
      ],
    });

    const version = await promise;
    expect(version.planId).toBe(PLAN_ID);
    expect(version.versionNumber).toBe(1);
    expect(version.steps).toHaveLength(1);
    expect(version.steps[0]?.name).toBe('Voltage');
  });

  it('creates a plan and extracts the id from a wrapped response', async () => {
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
    request.flush({ plan: { id: PLAN_ID } }, { status: 201, statusText: 'Created' });

    await expect(promise).resolves.toBe(PLAN_ID);
  });
});
