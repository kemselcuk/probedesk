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
});
