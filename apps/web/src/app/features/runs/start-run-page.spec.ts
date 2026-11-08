import { selectValue, materialSelect } from '../../../testing/material-select';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  Router,
  TitleStrategy,
  provideRouter,
  withDisabledInitialNavigation,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { routes } from '../../app.routes';
import { AuthSessionStore } from '../../core/auth/auth-session.store';
import type { Role } from '../../core/auth/auth.types';
import { AppTitleStrategy } from '../../core/title/app-title.strategy';
import { MAX_SEED } from './run-start-form';

const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const VERSION_ID = '22222222-2222-4222-8222-222222222222';
const STEP_1 = '33333333-3333-4333-8333-333333333333';
const STEP_2 = '44444444-4444-4444-8444-444444444444';
const CREATED_RUN_ID = '55555555-5555-4555-8555-555555555555';
const ACTIVE_RUN_ID = '66666666-6666-4666-8666-666666666666';
const USER_ID = '77777777-7777-4777-8777-777777777777';

const VERSION_DETAIL = {
  id: VERSION_ID,
  planId: PLAN_ID,
  state: 'PUBLISHED',
  name: 'Power rail verification',
  versionNumber: 3,
  publishedAt: '2026-11-03T11:00:00.000Z',
  steps: [
    {
      logicalStepId: STEP_1,
      position: 1,
      name: 'Temperature',
      unit: '°C',
      minimum: '20.000000',
      maximum: '30.000000',
      sampleCount: 3,
      intervalMs: 1000,
    },
    {
      logicalStepId: STEP_2,
      position: 2,
      name: 'Output voltage',
      unit: 'V',
      minimum: '4.750000',
      maximum: '5.250000',
      sampleCount: 2,
      intervalMs: 500,
    },
  ],
};

const CREATED_RUN_RESPONSE = {
  runId: CREATED_RUN_ID,
  status: 'RUNNING',
  outcome: null,
  snapshotUrl: `/api/runs/${CREATED_RUN_ID}`,
  eventsUrl: `/api/runs/${CREATED_RUN_ID}/events`,
};

describe('StartRunPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter(routes, withDisabledInitialNavigation()),
        { provide: TitleStrategy, useClass: AppTitleStrategy },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  function actAs(role: Role): void {
    TestBed.inject(AuthSessionStore).authenticate({
      id: USER_ID,
      email: `${role.toLowerCase()}@probedesk.local`,
      role,
    });
  }

  async function open(
    role: Role,
    versionId: string | null = VERSION_ID,
  ): Promise<RouterTestingHarness> {
    actAs(role);
    const url =
      versionId === null ? '/runs/new' : `/runs/new?versionId=${encodeURIComponent(versionId)}`;
    const harness = await RouterTestingHarness.create(url);
    harness.detectChanges();
    if (versionId !== null)
      TestBed.inject(HttpTestingController)
        .expectOne('/api/plans')
        .flush([
          {
            id: PLAN_ID,
            name: 'Power rail verification',
            profile: {
              id: USER_ID,
              code: 'DC_POWER_MODULE',
              name: 'DC Power Module',
              description: null,
            },
            draft: null,
            latestPublishedVersion: {
              id: VERSION_ID,
              versionNumber: 3,
              publishedAt: '2026-11-03T10:00:00.000Z',
            },
          },
        ]);
    return harness;
  }

  async function openWithVersion(
    role: Role = 'OPERATOR',
    version: object = VERSION_DETAIL,
  ): Promise<RouterTestingHarness> {
    const harness = await open(role);
    TestBed.inject(HttpTestingController)
      .expectOne(`/api/plan-versions/${VERSION_ID}`)
      .flush(version);
    await harness.fixture.whenStable();
    harness.detectChanges();
    return harness;
  }

  function rootOf(harness: RouterTestingHarness): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  function typeInto(root: HTMLElement, selector: string, value: string, blur = false): void {
    const input = root.querySelector<HTMLInputElement>(selector);
    if (input === null) {
      throw new Error(`Input not found: ${selector}`);
    }

    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if (blur) {
      input.dispatchEvent(new Event('blur', { bubbles: true }));
    }
  }

  function submit(root: HTMLElement): void {
    const form = root.querySelector('form');
    if (form === null) {
      throw new Error('Start run form not found');
    }

    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }

  function idempotencyKey(request: {
    request: { headers: { get(name: string): string | null } };
  }): string {
    const key = request.request.headers.get('Idempotency-Key');
    if (key === null) {
      throw new Error('Idempotency-Key header is missing');
    }

    return key;
  }

  /**
   * A successful start navigates to the real live or details route, so the
   * screen immediately issues GET /api/runs/:id. Answering it proves the
   * navigation and leaves no request open for the next test.
   */
  async function flushRunNavigation(harness: RouterTestingHarness, runId: string): Promise<void> {
    const request = TestBed.inject(HttpTestingController).expectOne(`/api/runs/${runId}`);
    expect(request.request.method).toBe('GET');
    request.flush(
      {
        code: 'NOT_FOUND',
        message: 'The run was not found.',
        requestId: 'req-start-details-404',
      },
      { status: 404, statusText: 'Not Found' },
    );
    await harness.fixture.whenStable();
    harness.detectChanges();
  }

  it('loads the published version and renders ordered steps and nominal totals', async () => {
    const harness = await open('OPERATOR');
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    expect(root.textContent).toContain('Loading published version…');

    http.expectOne(`/api/plan-versions/${VERSION_ID}`).flush(VERSION_DETAIL);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Start Run');
    expect(root.querySelector('#selected-version-heading')?.textContent?.trim()).toBe(
      'Power rail verification',
    );
    expect(root.querySelector('.version-badge')?.textContent).toContain('Version 3');
    expect(root.textContent).toContain(VERSION_ID);

    const rows = root.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('Temperature');
    expect(rows[0]?.textContent).toContain('°C');
    expect(rows[0]?.textContent).toContain('20.000000');
    expect(rows[0]?.textContent).toContain('30.000000');
    expect(rows[0]?.textContent).toContain('3');
    expect(rows[0]?.textContent).toContain('1,000');
    expect(rows[1]?.textContent).toContain('Output voltage');
    expect(rows[1]?.textContent).toContain('4.750000');
    expect(rows[1]?.textContent).toContain('5.250000');

    expect(root.querySelector('.totals')?.textContent).toContain('5');
    expect(root.querySelector('.totals')?.textContent).toContain('4.0 s');
  });

  it('starts with a selected device and trimmed display batch', async () => {
    const harness = await openWithVersion();
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);
    const deviceId = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'.toLowerCase();
    const device = {
      id: deviceId,
      deviceProfileId: USER_ID,
      name: 'Bench',
      serialNumber: 'PSU-1',
      description: null,
      archivedAt: null,
      editRevision: 1,
      createdAt: '2026-11-07T10:00:00.000Z',
      updatedAt: '2026-11-07T10:00:00.000Z',
    };
    materialSelect(root, 'app-device-picker mat-select').open();
    await harness.fixture.whenStable();
    http
      .expectOne((request) => request.url === '/api/devices')
      .flush({ items: [device], page: 1, limit: 20, total: 1, totalPages: 1 });
    harness.detectChanges();
    selectValue(root, 'app-device-picker mat-select', deviceId);
    harness.detectChanges();
    http.expectOne(`/api/devices/${deviceId}`).flush(device);
    await harness.fixture.whenStable();
    harness.detectChanges();
    typeInto(root, '#start-run-seed', '42');
    expect(root.querySelector('app-page-header a')?.getAttribute('href')).toContain(
      'deviceId=' + deviceId,
    );
    typeInto(root, '#start-run-batch', ' Lot-1 ');
    harness.detectChanges();
    submit(root);
    harness.detectChanges();
    const request = http.expectOne('/api/runs');
    expect(request.request.body).toEqual({
      planVersionId: VERSION_ID,
      scenario: 'NORMAL',
      seed: 42,
      deviceId,
      batchNumber: 'Lot-1',
    });
    request.flush(
      { code: 'RUN_ALREADY_ACTIVE', message: 'Busy.', requestId: 'req-busy' },
      { status: 409, statusText: 'Conflict' },
    );
  });

  it('shows the server batch field error without losing its entered value', async () => {
    const harness = await openWithVersion();
    const root = rootOf(harness);
    typeInto(root, '#start-run-seed', '42');
    typeInto(root, '#start-run-batch', 'Lot-1');
    harness.detectChanges();
    submit(root);
    harness.detectChanges();
    TestBed.inject(HttpTestingController)
      .expectOne('/api/runs')
      .flush(
        {
          code: 'VALIDATION_ERROR',
          message: 'Check the fields.',
          requestId: 'req-batch',
          fieldErrors: [
            { path: 'batchNumber', code: 'INVALID_VALUE', message: 'Review this batch number.' },
          ],
        },
        { status: 400, statusText: 'Bad Request' },
      );
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(root.textContent).toContain('Review this batch number.');
    expect(root.querySelector<HTMLInputElement>('#start-run-batch')?.value).toBe('Lot-1');
  });

  it('sends only NORMAL fields and navigates with the created runId', async () => {
    const harness = await openWithVersion();
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);

    typeInto(root, '#start-run-seed', '42');
    harness.detectChanges();

    submit(root);
    harness.detectChanges();

    const request = http.expectOne('/api/runs');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      planVersionId: VERSION_ID,
      scenario: 'NORMAL',
      seed: 42,
    });
    expect(idempotencyKey(request)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    const submitButton = root.querySelector<HTMLButtonElement>('#start-run-submit');
    expect(submitButton?.textContent).toContain('Starting run…');
    expect(submitButton?.disabled).toBe(true);

    request.flush(CREATED_RUN_RESPONSE, { status: 202, statusText: 'Accepted' });
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(router.url).toBe(`/runs/${CREATED_RUN_ID}/live`);
    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Live Run');
    await flushRunNavigation(harness, CREATED_RUN_ID);
  });

  it('navigates with the replayed runId on a 200 response', async () => {
    const harness = await openWithVersion();
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);

    typeInto(root, '#start-run-seed', '99');
    submit(root);
    harness.detectChanges();

    http.expectOne('/api/runs').flush(
      {
        ...CREATED_RUN_RESPONSE,
        status: 'COMPLETED',
        outcome: 'PASSED',
      },
      { status: 200, statusText: 'OK' },
    );
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(router.url).toBe(`/runs/${CREATED_RUN_ID}`);
    await flushRunNavigation(harness, CREATED_RUN_ID);
  });

  it('switches scenario fields and sends the selected force-failure step only', async () => {
    const harness = await openWithVersion();
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    typeInto(root, '#start-run-seed', '7');
    selectValue(root, '#start-run-scenario', 'FORCED_FAILURE');
    harness.detectChanges();

    expect(root.querySelector('#start-run-failure-step')).not.toBeNull();
    expect(root.querySelector('#start-run-error-probability')).toBeNull();

    selectValue(root, '#start-run-failure-step', STEP_2);
    harness.detectChanges();

    selectValue(root, '#start-run-scenario', 'RANDOM');
    harness.detectChanges();

    typeInto(root, '#start-run-error-probability', '0.25');
    harness.detectChanges();

    selectValue(root, '#start-run-scenario', 'FORCED_FAILURE');
    harness.detectChanges();

    const failureSelect = materialSelect(root, '#start-run-failure-step');
    expect(failureSelect?.value).toBe('');
    expect(root.querySelector('#start-run-error-probability')).toBeNull();

    selectValue(root, '#start-run-failure-step', STEP_1);
    harness.detectChanges();

    submit(root);
    harness.detectChanges();

    const request = http.expectOne('/api/runs');
    expect(request.request.body).toEqual({
      planVersionId: VERSION_ID,
      scenario: 'FORCED_FAILURE',
      seed: 7,
      failureStepId: STEP_1,
    });
    expect(request.request.body).not.toHaveProperty('errorProbability');

    request.flush(CREATED_RUN_RESPONSE, { status: 202, statusText: 'Accepted' });
    await harness.fixture.whenStable();
    await flushRunNavigation(harness, CREATED_RUN_ID);
  });

  it('sends the RANDOM probability as decimal text', async () => {
    const harness = await openWithVersion();
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    typeInto(root, '#start-run-seed', '4294967295');
    selectValue(root, '#start-run-scenario', 'RANDOM');
    harness.detectChanges();

    typeInto(root, '#start-run-error-probability', '0.050000');
    harness.detectChanges();

    submit(root);
    harness.detectChanges();

    const request = http.expectOne('/api/runs');
    expect(request.request.body).toEqual({
      planVersionId: VERSION_ID,
      scenario: 'RANDOM',
      seed: 4294967295,
      errorProbability: '0.050000',
    });
    expect(request.request.body).not.toHaveProperty('failureStepId');

    request.flush(CREATED_RUN_RESPONSE, { status: 202, statusText: 'Accepted' });
    await harness.fixture.whenStable();
    await flushRunNavigation(harness, CREATED_RUN_ID);
  });

  it('validates the uint32 seed and the 0..1 probability before submitting', async () => {
    const harness = await openWithVersion();
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    expect(
      root.querySelector('#start-run-seed')?.getAttribute('aria-describedby')?.split(/\s+/),
    ).toEqual(['start-run-seed-hint']);

    typeInto(root, '#start-run-seed', String(MAX_SEED + 1), true);
    harness.detectChanges();

    expect(root.textContent).toContain('Enter a whole number from 0 to 4,294,967,295.');
    const seedDescribedBy =
      root.querySelector('#start-run-seed')?.getAttribute('aria-describedby')?.split(/\s+/) ?? [];
    expect(seedDescribedBy).toEqual(['start-run-seed-error']);
    expect(root.querySelector<HTMLButtonElement>('#start-run-submit')?.disabled).toBe(true);

    typeInto(root, '#start-run-seed', '42');
    selectValue(root, '#start-run-scenario', 'RANDOM');
    harness.detectChanges();

    expect(
      root
        .querySelector('#start-run-error-probability')
        ?.getAttribute('aria-describedby')
        ?.split(/\s+/),
    ).toEqual(['start-run-error-probability-hint']);

    typeInto(root, '#start-run-error-probability', '1.000001', true);
    harness.detectChanges();

    expect(root.textContent).toContain(
      'Enter a decimal from 0 to 1 with at most 6 decimal places.',
    );
    const probabilityDescribedBy =
      root
        .querySelector('#start-run-error-probability')
        ?.getAttribute('aria-describedby')
        ?.split(/\s+/) ?? [];
    expect(probabilityDescribedBy).toEqual(['start-run-error-probability-error']);
    expect(root.querySelector<HTMLButtonElement>('#start-run-submit')?.disabled).toBe(true);
    expect(http.match('/api/runs')).toHaveLength(0);

    typeInto(root, '#start-run-error-probability', '1');
    harness.detectChanges();

    expect(root.querySelector<HTMLButtonElement>('#start-run-submit')?.disabled).toBe(false);
  });

  it('generates a valid uint32 seed without submitting', async () => {
    const harness = await openWithVersion();
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    root.querySelector<HTMLButtonElement>('#start-run-generate-seed')?.click();
    harness.detectChanges();

    const seed = root.querySelector<HTMLInputElement>('#start-run-seed')?.value ?? '';
    expect(seed).toMatch(/^\d+$/);
    expect(Number(seed)).toBeGreaterThanOrEqual(0);
    expect(Number(seed)).toBeLessThanOrEqual(MAX_SEED);
    expect(root.querySelector<HTMLButtonElement>('#start-run-submit')?.disabled).toBe(false);
    expect(http.match('/api/runs')).toHaveLength(0);
  });

  it('submits once, reuses the key on the same retry, and changes it for a new attempt', async () => {
    const harness = await openWithVersion();
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    typeInto(root, '#start-run-seed', '10');
    harness.detectChanges();

    submit(root);
    submit(root);
    harness.detectChanges();

    const requests = http.match('/api/runs');
    expect(requests).toHaveLength(1);
    const first = requests[0];
    if (first === undefined) {
      throw new Error('Start request not found');
    }
    const firstKey = idempotencyKey(first);

    first.flush(null, { status: 0, statusText: 'Network error' });
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.textContent).toContain('The server could not be reached');
    expect(root.querySelector<HTMLButtonElement>('#start-run-submit')?.disabled).toBe(false);

    submit(root);
    harness.detectChanges();

    const retry = http.expectOne('/api/runs');
    expect(idempotencyKey(retry)).toBe(firstKey);
    retry.flush(null, { status: 0, statusText: 'Network error' });
    await harness.fixture.whenStable();
    harness.detectChanges();

    typeInto(root, '#start-run-seed', '11');
    harness.detectChanges();

    submit(root);
    harness.detectChanges();

    const changed = http.expectOne('/api/runs');
    expect(idempotencyKey(changed)).not.toBe(firstKey);
    changed.flush(CREATED_RUN_RESPONSE, { status: 202, statusText: 'Accepted' });
    await harness.fixture.whenStable();
    await flushRunNavigation(harness, CREATED_RUN_ID);
  });

  it('links to the active run on 409 RUN_ALREADY_ACTIVE', async () => {
    const harness = await openWithVersion();
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    typeInto(root, '#start-run-seed', '1');
    submit(root);
    harness.detectChanges();

    http.expectOne('/api/runs').flush(
      {
        code: 'RUN_ALREADY_ACTIVE',
        message: 'Another run is already active.',
        requestId: 'req-active-1',
        details: { activeRunId: ACTIVE_RUN_ID },
      },
      { status: 409, statusText: 'Conflict' },
    );
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.textContent).toContain('Another run is already active');
    expect(root.textContent).toContain('Your settings are still here.');
    expect(root.textContent).toContain('req-active-1');
    const link = root.querySelector<HTMLAnchorElement>(`a[href="/runs/${ACTIVE_RUN_ID}"]`);
    expect(link?.textContent).toContain('Open active run');
    expect(TestBed.inject(Router).url).toContain('/runs/new');
  });

  it('explains an idempotency conflict without inventing a success', async () => {
    const harness = await openWithVersion();
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    typeInto(root, '#start-run-seed', '2');
    submit(root);
    harness.detectChanges();

    http.expectOne('/api/runs').flush(
      {
        code: 'IDEMPOTENCY_CONFLICT',
        message: 'The Idempotency-Key was already used with a different request.',
        requestId: 'req-key-1',
      },
      { status: 409, statusText: 'Conflict' },
    );
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.textContent).toContain('This start attempt was already used');
    expect(root.textContent).toContain('Change the scenario or settings to start a new attempt');
    expect(root.querySelector(`a[href="/runs/${ACTIVE_RUN_ID}"]`)).toBeNull();
    expect(TestBed.inject(Router).url).toContain('/runs/new');
  });

  it('binds 400 fieldErrors to the form and keeps the entered values', async () => {
    const harness = await openWithVersion();
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    typeInto(root, '#start-run-seed', '4');
    submit(root);
    harness.detectChanges();

    http.expectOne('/api/runs').flush(
      {
        code: 'VALIDATION_ERROR',
        message: 'Check the highlighted fields.',
        requestId: 'req-validation-1',
        fieldErrors: [
          {
            path: 'seed',
            code: 'SEED_REJECTED',
            message: 'This seed is not accepted for the selected plan.',
          },
          {
            path: 'planVersionId',
            code: 'VERSION_REJECTED',
            message: 'The plan version is no longer published.',
          },
        ],
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.querySelector<HTMLInputElement>('#start-run-seed')?.value).toBe('4');
    expect(root.textContent).toContain('This seed is not accepted for the selected plan.');
    expect(root.textContent).toContain('Check the highlighted fields.');
    expect(root.textContent).toContain('req-validation-1');
    expect(root.querySelector<HTMLButtonElement>('#start-run-submit')?.disabled).toBe(true);

    typeInto(root, '#start-run-seed', '5');
    harness.detectChanges();

    expect(root.textContent).not.toContain('This seed is not accepted for the selected plan.');
    expect(root.querySelector<HTMLButtonElement>('#start-run-submit')?.disabled).toBe(false);
  });

  it.each(['PLANNER', 'VIEWER'] as const)(
    'keeps %s settings read-only and never starts a run',
    async (role) => {
      const harness = await openWithVersion(role);
      const root = rootOf(harness);
      const http = TestBed.inject(HttpTestingController);

      expect(root.textContent).toContain('Starting a run is an Operator action.');
      const submitButton = root.querySelector<HTMLButtonElement>('#start-run-submit');
      expect(submitButton?.disabled).toBe(true);
      expect(root.querySelector<HTMLFieldSetElement>('fieldset')?.disabled).toBe(true);

      submit(root);
      harness.detectChanges();

      expect(http.match('/api/runs')).toHaveLength(0);
    },
  );

  it('shows a retryable not-found state for an unknown published version', async () => {
    const harness = await open('OPERATOR');
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    http.expectOne(`/api/plan-versions/${VERSION_ID}`).flush(
      {
        code: 'NOT_FOUND',
        message: 'The plan version was not found.',
        requestId: 'req-version-404',
      },
      { status: 404, statusText: 'Not Found' },
    );
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.textContent).toContain('Published version not found');
    expect(root.textContent).toContain('req-version-404');
    expect(
      root.querySelector<HTMLAnchorElement>('.not-found a[href="/plans"]')?.textContent,
    ).toContain('Back to Test Plans');

    Array.from(root.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Try again'))
      ?.click();
    harness.detectChanges();

    http.expectOne(`/api/plan-versions/${VERSION_ID}`).flush(VERSION_DETAIL);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.querySelector('#selected-version-heading')?.textContent?.trim()).toBe(
      'Power rail verification',
    );
  });

  it('shows a clear state when the address has no versionId', async () => {
    const harness = await open('OPERATOR', null);
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    expect(root.textContent).toContain('Choose a published plan version');
    expect(root.querySelector('form')).toBeNull();
    expect(http.match((request) => request.url.startsWith('/api/plan'))).toHaveLength(0);
  });

  it('shows role and session guidance for 403 and 401 responses', async () => {
    const harness = await openWithVersion();
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    typeInto(root, '#start-run-seed', '3');
    submit(root);
    harness.detectChanges();

    http.expectOne('/api/runs').flush(
      {
        code: 'FORBIDDEN',
        message: 'You are not allowed to start runs.',
        requestId: 'req-forbidden-1',
      },
      { status: 403, statusText: 'Forbidden' },
    );
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.textContent).toContain('You cannot start a run');
    expect(root.textContent).toContain('CSRF');
    expect(
      root.querySelector<HTMLAnchorElement>('#start-run-error-panel a[href="/plans"]')?.textContent,
    ).toContain('Back to Test Plans');

    submit(root);
    harness.detectChanges();

    http.expectOne('/api/runs').flush(
      {
        code: 'UNAUTHENTICATED',
        message: 'The session is missing or expired.',
        requestId: 'req-401-1',
      },
      { status: 401, statusText: 'Unauthorized' },
    );
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.textContent).toContain('Your session has expired');
    expect(root.querySelector<HTMLAnchorElement>('a[href="/login"]')?.textContent).toContain(
      'Sign in again',
    );
  });
});
