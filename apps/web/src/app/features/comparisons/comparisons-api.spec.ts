import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MalformedApiResponseError } from '../../core/http/malformed-api-response.error';
import { ComparisonsApi } from './comparisons-api';
import {
  ADDED_STEP_ID,
  LEFT_RUN_ID,
  RIGHT_RUN_ID,
  comparisonResult,
} from './testing/comparison-fixtures';

describe('ComparisonsApi', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('requests both run ids and parses the stored comparison', async () => {
    const api = TestBed.inject(ComparisonsApi);
    const http = TestBed.inject(HttpTestingController);
    const result = comparisonResult();
    const responsePromise = firstValueFrom(api.getComparison(LEFT_RUN_ID, RIGHT_RUN_ID));

    const request = http.expectOne((candidate) => candidate.url === '/api/comparisons');
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('leftRunId')).toBe(LEFT_RUN_ID);
    expect(request.request.params.get('rightRunId')).toBe(RIGHT_RUN_ID);

    request.flush(result);

    await expect(responsePromise).resolves.toEqual(result);
  });

  it('rejects a response that repeats a logicalStepId across matched and one-sided steps', async () => {
    const api = TestBed.inject(ComparisonsApi);
    const http = TestBed.inject(HttpTestingController);
    const result = comparisonResult();
    const duplicate = {
      ...result,
      addedSteps: [
        {
          ...result.addedSteps[0],
          logicalStepId: ADDED_STEP_ID,
        },
        {
          ...result.addedSteps[0],
          logicalStepId: ADDED_STEP_ID,
        },
      ],
    };
    const responsePromise = firstValueFrom(api.getComparison(LEFT_RUN_ID, RIGHT_RUN_ID));

    http.expectOne((candidate) => candidate.url === '/api/comparisons').flush(duplicate);

    await expect(responsePromise).rejects.toBeInstanceOf(MalformedApiResponseError);
  });

  it('rejects a comparison that compares one run with itself', async () => {
    const api = TestBed.inject(ComparisonsApi);
    const http = TestBed.inject(HttpTestingController);
    const result = comparisonResult();
    const responsePromise = firstValueFrom(api.getComparison(LEFT_RUN_ID, RIGHT_RUN_ID));

    http.expectOne((candidate) => candidate.url === '/api/comparisons').flush({
      ...result,
      rightRun: result.leftRun,
    });

    await expect(responsePromise).rejects.toBeInstanceOf(MalformedApiResponseError);
  });

  it('rejects a comparison whose run summaries belong to different plans', async () => {
    const api = TestBed.inject(ComparisonsApi);
    const http = TestBed.inject(HttpTestingController);
    const result = comparisonResult();
    const responsePromise = firstValueFrom(api.getComparison(LEFT_RUN_ID, RIGHT_RUN_ID));

    http.expectOne((candidate) => candidate.url === '/api/comparisons').flush({
      ...result,
      rightRun: {
        ...result.rightRun,
        planId: '99999999-9999-4999-8999-999999999999',
      },
    });

    await expect(responsePromise).rejects.toBeInstanceOf(MalformedApiResponseError);
  });

  it('rejects a missing sample value instead of substituting a zero', async () => {
    const api = TestBed.inject(ComparisonsApi);
    const http = TestBed.inject(HttpTestingController);
    const result = comparisonResult();
    const broken = {
      ...result,
      matchedSteps: [
        {
          ...result.matchedSteps[0],
          left: {
            ...result.matchedSteps[0]?.left,
            measurements: [
              {
                sampleIndex: 0,
                isWithinTolerance: true,
                recordedAt: '2026-11-03T10:00:00.000Z',
                elapsedMs: 0,
              },
            ],
          },
        },
      ],
    };
    const responsePromise = firstValueFrom(api.getComparison(LEFT_RUN_ID, RIGHT_RUN_ID));

    http.expectOne((candidate) => candidate.url === '/api/comparisons').flush(broken);

    await expect(responsePromise).rejects.toBeInstanceOf(MalformedApiResponseError);
  });
});
