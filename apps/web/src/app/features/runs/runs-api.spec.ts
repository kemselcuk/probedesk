import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MalformedApiResponseError } from '../../core/http/malformed-api-response.error';
import { RunsApi } from './runs-api';
import type { StartRunRequest } from './runs-api.types';

const RUN_ID = '44444444-4444-4444-8444-444444444444';
const VERSION_ID = '22222222-2222-4222-8222-222222222222';
const IDEMPOTENCY_KEY = '55555555-5555-4555-8555-555555555555';
const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const STEP_ID = '33333333-3333-4333-8333-333333333333';
const RUN_STEP_ID = '66666666-6666-4666-8666-666666666666';
const PROFILE_ID = '77777777-7777-4777-8777-777777777777';
const USER_ID = '88888888-8888-4888-8888-888888888888';

const SNAPSHOT = {
  id: RUN_ID,
  planId: PLAN_ID,
  planVersionId: VERSION_ID,
  planName: 'Power rail verification',
  deviceId: null,
  deviceSnapshot: null,
  batchNumber: null,
  versionNumber: 3,
  profile: {
    id: PROFILE_ID,
    code: 'DC_POWER_MODULE',
    name: 'DC Power Module',
    description: null,
  },
  scenario: 'FORCED_FAILURE',
  seed: 42,
  errorProbability: null,
  failureStepId: STEP_ID,
  simulatorVersion: 'mulberry32-v1',
  evaluationVersion: 'decimal-v1',
  status: 'COMPLETED',
  outcome: 'FAILED',
  startedAt: '2026-11-03T10:00:00.000Z',
  finishedAt: '2026-11-03T10:00:06.000Z',
  requestedBy: {
    id: USER_ID,
    email: 'operator@probedesk.local',
    role: 'OPERATOR',
  },
  reasonCode: null,
  expectedSampleCount: 2,
  recordedSampleCount: 2,
  lastEventSequence: 9,
  steps: [
    {
      runStepId: RUN_STEP_ID,
      logicalStepId: STEP_ID,
      position: 1,
      name: 'Output voltage',
      unit: 'V',
      minimum: '4.750000',
      maximum: '5.250000',
      sampleCount: 2,
      intervalMs: 500,
      status: 'COMPLETED',
      outcome: 'FAILED',
      recordedCount: 2,
      outOfToleranceCount: 1,
      firstFailureSampleIndex: 1,
      hasOutOfTolerance: true,
      statistics: {
        minimum: '4.980000',
        maximum: '5.310000',
        average: '5.145000',
        sampleCount: 2,
      },
      measurements: [
        {
          sampleIndex: 0,
          value: '4.980000',
          isWithinTolerance: true,
          recordedAt: '2026-11-03T10:00:00.500Z',
          elapsedMs: 500,
        },
        {
          sampleIndex: 1,
          value: '5.310000',
          isWithinTolerance: false,
          recordedAt: '2026-11-03T10:00:01.000Z',
          elapsedMs: 1000,
        },
      ],
    },
  ],
};

const REQUEST: StartRunRequest = {
  planVersionId: VERSION_ID,
  scenario: 'RANDOM',
  seed: 4294967295,
  errorProbability: '0.050000',
};

describe('RunsApi', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('posts the exact body and idempotency header and parses a created run', async () => {
    const api = TestBed.inject(RunsApi);
    const http = TestBed.inject(HttpTestingController);
    const responsePromise = firstValueFrom(api.startRun(REQUEST, IDEMPOTENCY_KEY));

    const request = http.expectOne('/api/runs');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(REQUEST);
    expect(request.request.headers.get('Idempotency-Key')).toBe(IDEMPOTENCY_KEY);

    request.flush(
      {
        runId: RUN_ID,
        status: 'RUNNING',
        outcome: null,
        snapshotUrl: `/api/runs/${RUN_ID}`,
        eventsUrl: `/api/runs/${RUN_ID}/events`,
      },
      { status: 202, statusText: 'Accepted' },
    );

    await expect(responsePromise).resolves.toEqual({
      runId: RUN_ID,
      status: 'RUNNING',
      outcome: null,
      snapshotUrl: `/api/runs/${RUN_ID}`,
      eventsUrl: `/api/runs/${RUN_ID}/events`,
    });
  });

  it('parses a 200 replay whose run is already terminal', async () => {
    const api = TestBed.inject(RunsApi);
    const http = TestBed.inject(HttpTestingController);
    const responsePromise = firstValueFrom(api.startRun(REQUEST, IDEMPOTENCY_KEY));

    http.expectOne('/api/runs').flush(
      {
        runId: RUN_ID,
        status: 'COMPLETED',
        outcome: 'PASSED',
        snapshotUrl: `/api/runs/${RUN_ID}`,
        eventsUrl: `/api/runs/${RUN_ID}/events`,
      },
      { status: 200, statusText: 'OK' },
    );

    await expect(responsePromise).resolves.toMatchObject({
      runId: RUN_ID,
      status: 'COMPLETED',
      outcome: 'PASSED',
    });
  });

  it('rejects a success response without a usable run id', async () => {
    const api = TestBed.inject(RunsApi);
    const http = TestBed.inject(HttpTestingController);
    const responsePromise = firstValueFrom(api.startRun(REQUEST, IDEMPOTENCY_KEY));

    http.expectOne('/api/runs').flush(
      {
        runId: 'not-a-uuid',
        status: 'RUNNING',
        outcome: null,
        snapshotUrl: '/api/runs/guess',
        eventsUrl: '/api/runs/guess/events',
      },
      { status: 202, statusText: 'Accepted' },
    );

    await expect(responsePromise).rejects.toBeInstanceOf(MalformedApiResponseError);
  });

  it('rejects an unknown run status instead of navigating', async () => {
    const api = TestBed.inject(RunsApi);
    const http = TestBed.inject(HttpTestingController);
    const responsePromise = firstValueFrom(api.startRun(REQUEST, IDEMPOTENCY_KEY));

    http.expectOne('/api/runs').flush(
      {
        runId: RUN_ID,
        status: 'QUEUED',
        outcome: null,
        snapshotUrl: `/api/runs/${RUN_ID}`,
        eventsUrl: `/api/runs/${RUN_ID}/events`,
      },
      { status: 202, statusText: 'Accepted' },
    );

    await expect(responsePromise).rejects.toThrow(/did not match the API contract/);
  });

  it('loads a full snapshot with copied rules, statistics, and measurements', async () => {
    const api = TestBed.inject(RunsApi);
    const http = TestBed.inject(HttpTestingController);
    const responsePromise = firstValueFrom(api.getRun(RUN_ID));

    const request = http.expectOne(`/api/runs/${RUN_ID}`);
    expect(request.request.method).toBe('GET');
    request.flush(SNAPSHOT);

    const snapshot = await responsePromise;
    expect(snapshot.planName).toBe('Power rail verification');
    expect(snapshot.status).toBe('COMPLETED');
    expect(snapshot.outcome).toBe('FAILED');
    expect(snapshot.steps[0]?.statistics.average).toBe('5.145000');
    expect(snapshot.steps[0]?.measurements[1]?.isWithinTolerance).toBe(false);
    expect(snapshot.steps[0]?.firstFailureSampleIndex).toBe(1);
  });

  it('keeps null statistics and a null overall outcome as null', async () => {
    const api = TestBed.inject(RunsApi);
    const http = TestBed.inject(HttpTestingController);
    const responsePromise = firstValueFrom(api.getRun(RUN_ID));

    http.expectOne(`/api/runs/${RUN_ID}`).flush({
      ...SNAPSHOT,
      status: 'CANCELLED',
      outcome: null,
      recordedSampleCount: 1,
      reasonCode: 'RUN_CANCELLED',
      steps: [
        {
          ...SNAPSHOT.steps[0],
          status: 'CANCELLED',
          outcome: null,
          recordedCount: 1,
          statistics: {
            minimum: null,
            maximum: null,
            average: null,
            sampleCount: null,
          },
          measurements: [SNAPSHOT.steps[0]?.measurements[0]],
        },
      ],
    });

    const snapshot = await responsePromise;
    expect(snapshot.outcome).toBeNull();
    expect(snapshot.reasonCode).toBe('RUN_CANCELLED');
    expect(snapshot.steps[0]?.statistics.minimum).toBeNull();
    expect(snapshot.steps[0]?.statistics.sampleCount).toBeNull();
  });

  it('cancels through POST and parses the returned terminal snapshot', async () => {
    const api = TestBed.inject(RunsApi);
    const http = TestBed.inject(HttpTestingController);
    const responsePromise = firstValueFrom(api.cancelRun(RUN_ID));

    const request = http.expectOne(`/api/runs/${RUN_ID}/cancel`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toBeNull();
    request.flush({
      ...SNAPSHOT,
      status: 'CANCELLED',
      outcome: null,
      finishedAt: '2026-11-03T10:00:03.000Z',
      reasonCode: 'RUN_CANCELLED',
    });

    await expect(responsePromise).resolves.toMatchObject({
      id: RUN_ID,
      status: 'CANCELLED',
      outcome: null,
      reasonCode: 'RUN_CANCELLED',
    });
  });

  it('rejects a malformed snapshot instead of defaulting a statistic', async () => {
    const api = TestBed.inject(RunsApi);
    const http = TestBed.inject(HttpTestingController);
    const responsePromise = firstValueFrom(api.getRun(RUN_ID));

    http.expectOne(`/api/runs/${RUN_ID}`).flush({
      ...SNAPSHOT,
      steps: [
        {
          ...SNAPSHOT.steps[0],
          statistics: { minimum: '4.980000', maximum: null, average: null },
        },
      ],
    });

    await expect(responsePromise).rejects.toBeInstanceOf(MalformedApiResponseError);
  });

  it('rejects a snapshot whose measurement flag is not a boolean', async () => {
    const api = TestBed.inject(RunsApi);
    const http = TestBed.inject(HttpTestingController);
    const responsePromise = firstValueFrom(api.getRun(RUN_ID));

    http.expectOne(`/api/runs/${RUN_ID}`).flush({
      ...SNAPSHOT,
      steps: [
        {
          ...SNAPSHOT.steps[0],
          measurements: [
            {
              ...SNAPSHOT.steps[0]?.measurements[0],
              isWithinTolerance: 'yes',
            },
          ],
        },
      ],
    });

    await expect(responsePromise).rejects.toThrow(/isWithinTolerance/);
  });

  it('builds the history query and parses summary rows without measurements', async () => {
    const api = TestBed.inject(RunsApi);
    const http = TestBed.inject(HttpTestingController);
    const historyItem = {
      id: RUN_ID,
      planId: PLAN_ID,
      planVersionId: VERSION_ID,
      planName: 'Power rail verification',
      deviceId: null,
      deviceSnapshot: null,
      batchNumber: null,
      versionNumber: 3,
      status: 'COMPLETED',
      outcome: 'FAILED',
      scenario: 'FORCED_FAILURE',
      seed: 42,
      startedAt: '2026-11-03T10:00:00.000Z',
      finishedAt: '2026-11-03T10:00:06.000Z',
      expectedSampleCount: 2,
      recordedSampleCount: 2,
      outOfToleranceCount: 1,
      firstFailure: {
        stepPosition: 1,
        stepName: 'Output voltage',
        logicalStepId: STEP_ID,
        sampleIndex: 1,
      },
      partial: false,
      requestedBy: {
        id: USER_ID,
        email: 'operator@probedesk.local',
        role: 'OPERATOR',
      },
    };

    const responsePromise = firstValueFrom(
      api.listRuns({
        planId: PLAN_ID,
        planVersionId: VERSION_ID,
        deviceId: USER_ID,
        batchNumber: 'Lot-1',
        scenario: 'FORCED_FAILURE',
        status: 'COMPLETED',
        outcome: 'FAILED',
        from: '2026-11-01T00:00:00.000Z',
        to: '2026-11-04T00:00:00.000Z',
        page: 2,
        limit: 20,
      }),
    );

    const request = http.expectOne((candidate) => candidate.url === '/api/runs');
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('planId')).toBe(PLAN_ID);
    expect(request.request.params.get('planVersionId')).toBe(VERSION_ID);
    expect(request.request.params.get('deviceId')).toBe(USER_ID);
    expect(request.request.params.get('batchNumber')).toBe('Lot-1');
    expect(request.request.params.get('scenario')).toBe('FORCED_FAILURE');
    expect(request.request.params.get('status')).toBe('COMPLETED');
    expect(request.request.params.get('outcome')).toBe('FAILED');
    expect(request.request.params.get('from')).toBe('2026-11-01T00:00:00.000Z');
    expect(request.request.params.get('to')).toBe('2026-11-04T00:00:00.000Z');
    expect(request.request.params.get('page')).toBe('2');
    expect(request.request.params.get('limit')).toBe('20');

    request.flush({
      items: [historyItem],
      page: 2,
      limit: 20,
      total: 21,
      totalPages: 2,
    });

    const page = await responsePromise;
    expect(page).toMatchObject({ page: 2, limit: 20, total: 21, totalPages: 2 });
    expect(page.items[0]).toMatchObject({
      id: RUN_ID,
      planName: 'Power rail verification',
      versionNumber: 3,
      status: 'COMPLETED',
      outcome: 'FAILED',
      seed: 42,
      outOfToleranceCount: 1,
      partial: false,
      firstFailure: {
        stepPosition: 1,
        stepName: 'Output voltage',
        logicalStepId: STEP_ID,
        sampleIndex: 1,
      },
    });
    expect(page.items[0]).not.toHaveProperty('steps');
    expect(page.items[0]).not.toHaveProperty('measurements');
  });

  it('omits unset history filters from the request', async () => {
    const api = TestBed.inject(RunsApi);
    const http = TestBed.inject(HttpTestingController);
    const responsePromise = firstValueFrom(api.listRuns({ page: 1, limit: 20 }));

    const request = http.expectOne((candidate) => candidate.url === '/api/runs');
    expect(request.request.params.keys()).toEqual(['page', 'limit']);
    expect(request.request.params.get('page')).toBe('1');
    expect(request.request.params.get('limit')).toBe('20');
    request.flush({ items: [], page: 1, limit: 20, total: 0, totalPages: 0 });

    await expect(responsePromise).resolves.toEqual({
      items: [],
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });
  });

  it('rejects a malformed history row instead of inventing summary values', async () => {
    const api = TestBed.inject(RunsApi);
    const http = TestBed.inject(HttpTestingController);
    const responsePromise = firstValueFrom(api.listRuns({ page: 1, limit: 20 }));

    http.expectOne((candidate) => candidate.url === '/api/runs').flush({
      items: [{ id: RUN_ID }],
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });

    await expect(responsePromise).rejects.toBeInstanceOf(MalformedApiResponseError);
  });
});
