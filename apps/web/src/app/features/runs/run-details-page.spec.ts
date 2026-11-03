import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import {
  Router,
  TitleStrategy,
  provideRouter,
  withDisabledInitialNavigation,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../app.routes';
import { AuthSessionStore } from '../../core/auth/auth-session.store';
import type { Role } from '../../core/auth/auth.types';
import { AppTitleStrategy } from '../../core/title/app-title.strategy';
import { MEASUREMENT_CHART_FACTORY } from '../../shared/charts/measurement-chart.factory';
import { FakeMeasurementChartFactory } from '../../shared/charts/testing/fake-measurement-chart';

const RUN_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_RUN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ACTIVE_RUN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NEW_RUN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const VERSION_ID = '22222222-2222-4222-8222-222222222222';
const STEP_1 = '33333333-3333-4333-8333-333333333333';
const STEP_2 = '55555555-5555-4555-8555-555555555555';
const RUN_STEP_1 = '66666666-6666-4666-8666-666666666666';
const RUN_STEP_2 = '77777777-7777-4777-8777-777777777777';
const PROFILE_ID = '88888888-8888-4888-8888-888888888888';
const USER_ID = '99999999-9999-4999-8999-999999999999';

const PROFILE = {
  id: PROFILE_ID,
  code: 'DC_POWER_MODULE',
  name: 'DC Power Module',
  description: null,
};

const VOLTAGE_STEP = {
  runStepId: RUN_STEP_1,
  logicalStepId: STEP_1,
  position: 1,
  name: 'Output voltage',
  unit: 'V',
  minimum: '4.750000',
  maximum: '5.250000',
  sampleCount: 2,
  intervalMs: 500,
  status: 'COMPLETED',
  outcome: 'PASSED',
  recordedCount: 2,
  outOfToleranceCount: 0,
  firstFailureSampleIndex: null,
  hasOutOfTolerance: false,
  statistics: {
    minimum: '4.980000',
    maximum: '5.010000',
    average: '4.995000',
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
      value: '5.010000',
      isWithinTolerance: true,
      recordedAt: '2026-11-03T10:00:01.000Z',
      elapsedMs: 1000,
    },
  ],
};

const CURRENT_STEP = {
  runStepId: RUN_STEP_2,
  logicalStepId: STEP_2,
  position: 2,
  name: 'Current draw',
  unit: 'A',
  minimum: '0.100000',
  maximum: '0.550000',
  sampleCount: 2,
  intervalMs: 250,
  status: 'COMPLETED',
  outcome: 'PASSED',
  recordedCount: 2,
  outOfToleranceCount: 0,
  firstFailureSampleIndex: null,
  hasOutOfTolerance: false,
  statistics: {
    minimum: '0.200000',
    maximum: '0.210000',
    average: '0.205000',
    sampleCount: 2,
  },
  measurements: [
    {
      sampleIndex: 0,
      value: '0.200000',
      isWithinTolerance: true,
      recordedAt: '2026-11-03T10:00:02.000Z',
      elapsedMs: 1500,
    },
    {
      sampleIndex: 1,
      value: '0.210000',
      isWithinTolerance: true,
      recordedAt: '2026-11-03T10:00:02.500Z',
      elapsedMs: 2000,
    },
  ],
};

const PASSED_SNAPSHOT = {
  id: RUN_ID,
  planId: PLAN_ID,
  planVersionId: VERSION_ID,
  planName: 'Power rail verification',
  versionNumber: 3,
  profile: PROFILE,
  scenario: 'NORMAL',
  seed: 42,
  errorProbability: null,
  failureStepId: null,
  simulatorVersion: 'mulberry32-v1',
  evaluationVersion: 'decimal-v1',
  status: 'COMPLETED',
  outcome: 'PASSED',
  startedAt: '2026-11-03T10:00:00.000Z',
  finishedAt: '2026-11-03T10:00:03.000Z',
  requestedBy: {
    id: USER_ID,
    email: 'operator@probedesk.local',
    role: 'OPERATOR',
  },
  reasonCode: null,
  expectedSampleCount: 4,
  recordedSampleCount: 4,
  lastEventSequence: 12,
  steps: [VOLTAGE_STEP, CURRENT_STEP],
};

const FAILED_SNAPSHOT = {
  ...PASSED_SNAPSHOT,
  status: 'COMPLETED',
  outcome: 'FAILED',
  steps: [
    VOLTAGE_STEP,
    {
      ...CURRENT_STEP,
      outcome: 'FAILED',
      outOfToleranceCount: 1,
      firstFailureSampleIndex: 1,
      hasOutOfTolerance: true,
      measurements: [
        CURRENT_STEP.measurements[0],
        {
          ...CURRENT_STEP.measurements[1],
          value: '0.600000',
          isWithinTolerance: false,
        },
      ],
    },
  ],
};

const RUNNING_SNAPSHOT = {
  ...PASSED_SNAPSHOT,
  status: 'RUNNING',
  outcome: null,
  finishedAt: null,
  recordedSampleCount: 1,
  steps: [
    {
      ...VOLTAGE_STEP,
      status: 'RUNNING',
      outcome: null,
      recordedCount: 1,
      statistics: {
        minimum: null,
        maximum: null,
        average: null,
        sampleCount: null,
      },
      measurements: [VOLTAGE_STEP.measurements[0]],
    },
    {
      ...CURRENT_STEP,
      status: 'PENDING',
      outcome: null,
      recordedCount: 0,
      outOfToleranceCount: 0,
      firstFailureSampleIndex: null,
      hasOutOfTolerance: false,
      statistics: {
        minimum: null,
        maximum: null,
        average: null,
        sampleCount: null,
      },
      measurements: [],
    },
  ],
};

const CANCELLED_SNAPSHOT = {
  ...RUNNING_SNAPSHOT,
  status: 'CANCELLED',
  outcome: null,
  finishedAt: '2026-11-03T10:00:04.000Z',
  reasonCode: 'RUN_CANCELLED',
  recordedSampleCount: 1,
  steps: [
    {
      ...VOLTAGE_STEP,
      status: 'CANCELLED',
      outcome: null,
      recordedCount: 1,
      statistics: {
        minimum: null,
        maximum: null,
        average: null,
        sampleCount: null,
      },
      measurements: [VOLTAGE_STEP.measurements[0]],
    },
    {
      ...CURRENT_STEP,
      status: 'NOT_RUN',
      outcome: null,
      recordedCount: 0,
      outOfToleranceCount: 0,
      firstFailureSampleIndex: null,
      hasOutOfTolerance: false,
      statistics: {
        minimum: null,
        maximum: null,
        average: null,
        sampleCount: null,
      },
      measurements: [],
    },
  ],
};

const INTERRUPTED_SNAPSHOT = {
  ...CANCELLED_SNAPSHOT,
  status: 'INTERRUPTED',
  reasonCode: 'SERVER_RESTART',
  recordedSampleCount: 2,
  steps: [
    VOLTAGE_STEP,
    {
      ...CURRENT_STEP,
      status: 'INTERRUPTED',
      outcome: null,
      recordedCount: 0,
      statistics: {
        minimum: null,
        maximum: null,
        average: null,
        sampleCount: null,
      },
      measurements: [],
    },
  ],
};

const ERROR_SNAPSHOT = {
  ...CANCELLED_SNAPSHOT,
  status: 'ERROR',
  reasonCode: 'SIMULATOR_OUTPUT_INVALID',
  recordedSampleCount: 2,
  steps: [
    VOLTAGE_STEP,
    {
      ...CURRENT_STEP,
      status: 'ERROR',
      outcome: null,
      recordedCount: 0,
      statistics: {
        minimum: null,
        maximum: null,
        average: null,
        sampleCount: null,
      },
      measurements: [],
    },
  ],
};

/**
 * A run stopped by an operator or a technical error after the last sample was
 * written but before the completion transaction committed. Every sample and
 * step result is present; the screen must not claim that data is missing.
 */
const FULLY_RECORDED_CANCELLED_SNAPSHOT = {
  ...PASSED_SNAPSHOT,
  status: 'CANCELLED',
  outcome: null,
  reasonCode: 'RUN_CANCELLED',
};

const FULLY_RECORDED_ERROR_SNAPSHOT = {
  ...PASSED_SNAPSHOT,
  status: 'ERROR',
  outcome: null,
  reasonCode: 'EXECUTION_FAILED',
};

const FAILED_FORCED_SNAPSHOT = {
  ...FAILED_SNAPSHOT,
  scenario: 'FORCED_FAILURE',
  failureStepId: STEP_2,
};

describe('RunDetailsPage', () => {
  let chartFactory: FakeMeasurementChartFactory;

  beforeEach(async () => {
    chartFactory = new FakeMeasurementChartFactory();
    await TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter(routes, withDisabledInitialNavigation()),
        { provide: TitleStrategy, useClass: AppTitleStrategy },
        { provide: MEASUREMENT_CHART_FACTORY, useValue: chartFactory },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    TestBed.inject(HttpTestingController).verify();
  });

  function actAs(role: Role): void {
    TestBed.inject(AuthSessionStore).authenticate({
      id: USER_ID,
      email: `${role.toLowerCase()}@probedesk.local`,
      role,
    });
  }

  async function open(role: Role = 'OPERATOR'): Promise<RouterTestingHarness> {
    actAs(role);
    const harness = await RouterTestingHarness.create(`/runs/${RUN_ID}`);
    harness.detectChanges();
    return harness;
  }

  async function openLoaded(
    snapshot: object = PASSED_SNAPSHOT,
    role: Role = 'OPERATOR',
  ): Promise<RouterTestingHarness> {
    const harness = await open(role);
    const http = TestBed.inject(HttpTestingController);
    http.expectOne(`/api/runs/${RUN_ID}`).flush(snapshot);
    await harness.fixture.whenStable();
    TestBed.tick();
    harness.detectChanges();
    return harness;
  }

  function rootOf(harness: RouterTestingHarness): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  function settle(harness: RouterTestingHarness): void {
    TestBed.tick();
    harness.detectChanges();
  }

  function measurementRow(
    root: ParentNode,
    runStepId: string,
    sampleIndex: number,
  ): HTMLElement | null {
    return root.querySelector<HTMLElement>(`#measurement-row-${runStepId}-${sampleIndex}`);
  }

  function findButton(root: ParentNode, label: string): HTMLButtonElement | undefined {
    return Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.includes(label),
    );
  }

  async function openCancelDialog(harness: RouterTestingHarness): Promise<HTMLElement> {
    const root = rootOf(harness);
    root.querySelector<HTMLButtonElement>('#cancel-run-button')?.click();
    harness.detectChanges();

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Cancel this run?');
    });

    return document.body;
  }

  async function confirmCancel(
    harness: RouterTestingHarness,
    http: HttpTestingController,
  ): Promise<TestRequest> {
    const root = rootOf(harness);
    document.querySelector<HTMLButtonElement>('#cancel-run-confirm')?.click();

    await vi.waitFor(() => {
      harness.detectChanges();
      const pending = root.querySelector<HTMLButtonElement>('#cancel-run-button');
      expect(pending?.textContent).toContain('Cancelling…');
    });

    return http.expectOne(`/api/runs/${RUN_ID}/cancel`);
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

  it('renders a passed snapshot with copied rules, statistics, and accessible measurements', async () => {
    const harness = await openLoaded(PASSED_SNAPSHOT);
    const root = rootOf(harness);

    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Run Details');
    expect(root.querySelector('#run-summary-heading')?.textContent?.trim()).toBe(
      'Power rail verification',
    );

    const badge = root.querySelector('.status-badge');
    expect(badge?.textContent).toContain('Passed');
    expect(badge?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(root.textContent).toContain('Every expected sample was recorded');

    expect(root.textContent).toContain('Normal (NORMAL)');
    expect(root.textContent).toContain('42');
    expect(root.textContent).toContain('mulberry32-v1');
    expect(root.textContent).toContain('decimal-v1');
    expect(root.textContent).toContain('DC Power Module (DC_POWER_MODULE)');
    expect(root.textContent).toContain('operator@probedesk.local (OPERATOR)');
    expect(root.textContent).toContain('UTC');
    expect(root.textContent).toContain('4 of 4 samples recorded (100%)');
    expect(root.textContent).not.toContain('Partial results');

    expect(root.querySelectorAll('.step-card')).toHaveLength(2);
    expect(root.textContent).toContain('Step 1: Output voltage');
    expect(root.textContent).toContain('4.750000 V');
    expect(root.textContent).toContain('5.250000 V');
    expect(root.textContent).toContain('0.100000 A');
    expect(root.textContent).toContain('4.995000 V');
    expect(root.textContent).toContain('0.205000 A');

    const firstTable = root.querySelector<HTMLTableElement>('.step-card table');
    expect(firstTable?.querySelector('caption')?.textContent).toContain(
      'Recorded measurements for step 1: Output voltage (V)',
    );
    expect(firstTable?.querySelectorAll('th[scope="col"]')).toHaveLength(6);
    const rows = firstTable?.querySelectorAll('tbody tr') ?? [];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('4.980000');
    expect(rows[0]?.textContent).toContain('Within tolerance');
    expect(rows[1]?.textContent).toContain('5.010000');
    expect(rows[0]?.textContent).toContain('500');

    expect(root.querySelector('#run-again-button')).not.toBeNull();
    expect(root.querySelector('#cancel-run-button')).toBeNull();
    expect(root.textContent).toContain('The recorded run on this page stays in history unchanged.');
  });

  it('renders a failed run with out-of-tolerance samples and the first failure index', async () => {
    const harness = await openLoaded(FAILED_SNAPSHOT);
    const root = rootOf(harness);

    expect(root.querySelector('.status-badge')?.textContent).toContain('Failed');
    expect(root.textContent).toContain('at least one step failed');
    expect(root.textContent).toContain('Outside tolerance');
    expect(root.textContent).toContain('First failure index');
    expect(root.querySelectorAll('.step-card')[1]?.textContent).toContain('1');
    expect(root.textContent).not.toContain('Partial results');
  });

  it('explains cancelled partial data and does not invent missing statistics', async () => {
    const harness = await openLoaded(CANCELLED_SNAPSHOT);
    const root = rootOf(harness);

    expect(root.querySelector('.status-badge')?.textContent).toContain('Cancelled');
    expect(root.textContent).toContain('Partial results.');
    expect(root.textContent).toContain('never as zero');
    expect(root.textContent).toContain('Reason code:');
    expect(root.textContent).toContain('RUN_CANCELLED');
    expect(root.textContent).toContain('1 of 4 samples recorded (25%)');
    expect(root.textContent).toContain('This step did not start. No samples were recorded for it.');
    expect(root.textContent).toContain('Partial step: 1 of 2 samples were recorded.');

    const unavailable = Array.from(root.querySelectorAll('dd')).filter(
      (cell) => cell.textContent?.trim() === 'Not available',
    );
    expect(unavailable.length).toBeGreaterThanOrEqual(8);
    expect(root.textContent).not.toContain('0.000000');
    expect(root.querySelectorAll('.step-card table tbody tr')).toHaveLength(1);
  });

  it.each([
    ['INTERRUPTED' as const, INTERRUPTED_SNAPSHOT, 'Interrupted', 'SERVER_RESTART'],
    ['ERROR' as const, ERROR_SNAPSHOT, 'Error', 'SIMULATOR_OUTPUT_INVALID'],
  ])('renders %s terminal state with its reason', async (_kind, snapshot, label, reason) => {
    const harness = await openLoaded(snapshot);
    const root = rootOf(harness);

    expect(root.querySelector('.status-badge')?.textContent).toContain(label);
    expect(root.textContent).toContain(reason);
    expect(root.textContent).toContain('Partial results.');
    expect(root.querySelector('#run-again-button')).not.toBeNull();
  });

  it.each([
    ['CANCELLED' as const, FULLY_RECORDED_CANCELLED_SNAPSHOT, 'RUN_CANCELLED'],
    ['ERROR' as const, FULLY_RECORDED_ERROR_SNAPSHOT, 'EXECUTION_FAILED'],
  ])(
    'does not claim missing samples for a fully recorded %s run',
    async (_kind, snapshot, reason) => {
      const harness = await openLoaded(snapshot);
      const root = rootOf(harness);

      expect(root.textContent).toContain('4 of 4 samples recorded (100%)');
      expect(root.textContent).toContain(reason);
      expect(root.textContent).not.toContain('Partial results.');
      expect(root.textContent).not.toContain('stopped before every expected sample');
      expect(root.textContent).toContain('All expected samples were recorded.');
      expect(root.textContent).toContain(
        'stopped during finalization or because of a technical error',
      );
      expect(root.querySelectorAll('.step-card')).toHaveLength(2);
      expect(root.querySelector('#run-again-button')).not.toBeNull();
    },
  );

  it('shows a completed run without an outcome without inferring one', async () => {
    const harness = await openLoaded({ ...PASSED_SNAPSHOT, outcome: null });
    const root = rootOf(harness);

    expect(root.querySelector('.status-badge')?.textContent).toContain('Completed');
    expect(root.textContent).toContain('no overall outcome');
    expect(root.querySelector('.status-badge')?.textContent).not.toContain('Passed');
    expect(root.querySelector('.status-badge')?.textContent).not.toContain('Failed');
  });

  it('shows the empty step state without fabricating measurements', async () => {
    const harness = await openLoaded({
      ...PASSED_SNAPSHOT,
      expectedSampleCount: 0,
      recordedSampleCount: 0,
      steps: [],
    });
    const root = rootOf(harness);

    expect(root.textContent).toContain('This run has no steps');
    expect(root.textContent).toContain('Nothing is inferred from the missing data.');
    expect(root.textContent).toContain('No samples were expected');
    expect(root.querySelector('table')).toBeNull();
  });

  it('shows a provisional snapshot while running and cancels only after the server confirms', async () => {
    const harness = await openLoaded(RUNNING_SNAPSHOT);
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    expect(root.querySelector('.status-badge')?.textContent).toContain('Running');
    expect(root.textContent).toContain('Provisional snapshot.');
    expect(root.querySelector('#run-again-button')).toBeNull();
    expect(root.textContent).toContain('Run again becomes available');

    const cancelButton = root.querySelector<HTMLButtonElement>('#cancel-run-button');
    expect(cancelButton?.disabled).toBe(false);

    const dialog = await openCancelDialog(harness);
    expect(dialog.textContent).toContain('Power rail verification');
    expect(dialog.textContent).toContain('1 of 4 expected samples');
    await vi.waitFor(() => {
      expect(document.activeElement?.id).toBe('cancel-run-keep');
    });
    expect(http.match(`/api/runs/${RUN_ID}/cancel`)).toHaveLength(0);
    expect(root.querySelector('.status-badge')?.textContent).toContain('Running');

    const cancelRequest = await confirmCancel(harness, http);
    expect(cancelRequest.request.method).toBe('POST');
    expect(root.querySelector('.status-badge')?.textContent).toContain('Running');
    const pendingButton = root.querySelector<HTMLButtonElement>('#cancel-run-button');
    expect(pendingButton?.disabled).toBe(true);
    expect(pendingButton?.textContent).toContain('Cancelling…');

    cancelRequest.flush(CANCELLED_SNAPSHOT);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.querySelector('.status-badge')?.textContent).toContain('Cancelled');
    expect(root.textContent).toContain('The server confirmed the cancellation.');

    const refreshRequest = http.expectOne(`/api/runs/${RUN_ID}`);
    expect(refreshRequest.request.method).toBe('GET');
    refreshRequest.flush(CANCELLED_SNAPSHOT);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.querySelector('.status-badge')?.textContent).toContain('Cancelled');
    expect(root.querySelector('#cancel-run-button')).toBeNull();
    expect(root.textContent).toContain('Partial results.');
  });

  it('never cancels when the dialog is dismissed', async () => {
    const harness = await openLoaded(RUNNING_SNAPSHOT);
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    const dialog = await openCancelDialog(harness);
    document.querySelector<HTMLButtonElement>('#cancel-run-keep')?.click();
    await vi.waitFor(() => {
      expect(dialog.textContent).not.toContain('Cancel this run?');
    });
    harness.detectChanges();

    expect(http.match(`/api/runs/${RUN_ID}/cancel`)).toHaveLength(0);
    expect(root.querySelector('.status-badge')?.textContent).toContain('Running');
  });

  it('keeps the real running state when cancellation fails and refreshes on request', async () => {
    const harness = await openLoaded(RUNNING_SNAPSHOT);
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    await openCancelDialog(harness);
    const cancelRequest = await confirmCancel(harness, http);
    cancelRequest.flush(
      {
        code: 'SERVICE_UNAVAILABLE',
        message: 'The run service is unavailable.',
        requestId: 'req-cancel-fail',
      },
      { status: 503, statusText: 'Service Unavailable' },
    );
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.querySelector('.status-badge')?.textContent).toContain('Running');
    expect(root.textContent).toContain('The cancellation was not confirmed');
    expect(root.textContent).toContain('was not shown as cancelled');
    expect(root.textContent).toContain('req-cancel-fail');

    findButton(root, 'Refresh snapshot')?.click();
    harness.detectChanges();

    http.expectOne(`/api/runs/${RUN_ID}`).flush(CANCELLED_SNAPSHOT);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.querySelector('.status-badge')?.textContent).toContain('Cancelled');
  });

  it('adopts an already terminal response without reporting a cancellation', async () => {
    const harness = await openLoaded(RUNNING_SNAPSHOT);
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    await openCancelDialog(harness);
    const cancelRequest = await confirmCancel(harness, http);
    cancelRequest.flush(FAILED_SNAPSHOT);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.querySelector('.status-badge')?.textContent).toContain('Failed');
    expect(root.querySelector('.status-badge')?.textContent).not.toContain('Cancelled');
    expect(root.textContent).toContain(
      'was already Failed. Its existing result is shown unchanged.',
    );

    http.expectOne(`/api/runs/${RUN_ID}`).flush(FAILED_SNAPSHOT);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.querySelector('.status-badge')?.textContent).toContain('Failed');
  });

  it.each(['PLANNER', 'VIEWER'] as const)(
    'does not show an enabled cancel action to %s',
    async (role) => {
      const harness = await openLoaded(RUNNING_SNAPSHOT, role);
      const root = rootOf(harness);
      const http = TestBed.inject(HttpTestingController);

      expect(root.querySelector('#cancel-run-button')).toBeNull();
      expect(root.querySelector('#run-again-button')).toBeNull();
      expect(root.textContent).toContain('are Operator actions');
      expect(http.match(`/api/runs/${RUN_ID}/cancel`)).toHaveLength(0);
    },
  );

  it.each(['PLANNER', 'VIEWER'] as const)(
    'does not show Run Again to %s on a terminal run',
    async (role) => {
      const harness = await openLoaded(PASSED_SNAPSHOT, role);
      const root = rootOf(harness);

      expect(root.querySelector('#run-again-button')).toBeNull();
      expect(root.textContent).toContain('are Operator actions');
    },
  );

  it('runs again with the stored settings, a new key, and the real new run id', async () => {
    const harness = await openLoaded(FAILED_FORCED_SNAPSHOT);
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);

    expect(root.textContent).toContain('Forced failure (FORCED_FAILURE)');
    expect(root.textContent).toContain('Current draw (A)');
    expect(root.textContent).toContain('This creates a new run. The existing run is not modified.');

    root.querySelector<HTMLButtonElement>('#run-again-button')?.click();
    harness.detectChanges();

    const request = http.expectOne('/api/runs');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      planVersionId: VERSION_ID,
      scenario: 'FORCED_FAILURE',
      seed: 42,
      failureStepId: STEP_2,
    });
    expect(request.request.body).not.toHaveProperty('errorProbability');
    expect(idempotencyKey(request)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(root.querySelector<HTMLButtonElement>('#run-again-button')?.textContent).toContain(
      'Starting new run…',
    );
    expect(router.url).toBe(`/runs/${RUN_ID}`);

    request.flush(
      {
        runId: NEW_RUN_ID,
        status: 'RUNNING',
        outcome: null,
        snapshotUrl: `/api/runs/${NEW_RUN_ID}`,
        eventsUrl: `/api/runs/${NEW_RUN_ID}/events`,
      },
      { status: 202, statusText: 'Accepted' },
    );
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(router.url).toBe(`/runs/${NEW_RUN_ID}`);

    const detailsRequest = http.expectOne(`/api/runs/${NEW_RUN_ID}`);
    expect(detailsRequest.request.method).toBe('GET');
    detailsRequest.flush(
      {
        code: 'NOT_FOUND',
        message: 'The run was not found.',
        requestId: 'req-rerun-details-404',
      },
      { status: 404, statusText: 'Not Found' },
    );
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Run Details');
  });

  it('runs again with the stored RANDOM probability as decimal text', async () => {
    const harness = await openLoaded({
      ...PASSED_SNAPSHOT,
      scenario: 'RANDOM',
      errorProbability: '0.050000',
    });
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    expect(root.textContent).toContain('Random failure (RANDOM)');
    expect(root.textContent).toContain('0.050000');

    root.querySelector<HTMLButtonElement>('#run-again-button')?.click();
    harness.detectChanges();

    const request = http.expectOne('/api/runs');
    expect(request.request.body).toEqual({
      planVersionId: VERSION_ID,
      scenario: 'RANDOM',
      seed: 42,
      errorProbability: '0.050000',
    });
    expect(request.request.body).not.toHaveProperty('failureStepId');
    request.flush(
      {
        runId: NEW_RUN_ID,
        status: 'RUNNING',
        outcome: null,
        snapshotUrl: `/api/runs/${NEW_RUN_ID}`,
        eventsUrl: `/api/runs/${NEW_RUN_ID}/events`,
      },
      { status: 202, statusText: 'Accepted' },
    );
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(TestBed.inject(Router).url).toBe(`/runs/${NEW_RUN_ID}`);
    const detailsRequest = http.expectOne(`/api/runs/${NEW_RUN_ID}`);
    detailsRequest.flush(
      {
        code: 'NOT_FOUND',
        message: 'The run was not found.',
        requestId: 'req-rerun-random-details-404',
      },
      { status: 404, statusText: 'Not Found' },
    );
    await harness.fixture.whenStable();
  });

  it('keeps the Run Again key for a retry and renews it after a conflict', async () => {
    const harness = await openLoaded(PASSED_SNAPSHOT);
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    root.querySelector<HTMLButtonElement>('#run-again-button')?.click();
    harness.detectChanges();

    const first = http.expectOne('/api/runs');
    const firstKey = idempotencyKey(first);
    first.flush(null, { status: 0, statusText: 'Network error' });
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.textContent).toContain('The server could not be reached');
    expect(root.querySelector('.status-badge')?.textContent).toContain('Passed');

    root.querySelector<HTMLButtonElement>('#run-again-button')?.click();
    harness.detectChanges();

    const retry = http.expectOne('/api/runs');
    expect(idempotencyKey(retry)).toBe(firstKey);
    retry.flush(
      {
        code: 'IDEMPOTENCY_CONFLICT',
        message: 'The Idempotency-Key was already used with a different request.',
        requestId: 'req-rerun-conflict',
      },
      { status: 409, statusText: 'Conflict' },
    );
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.textContent).toContain('This Run Again attempt was already used');
    expect(root.textContent).toContain('req-rerun-conflict');

    root.querySelector<HTMLButtonElement>('#run-again-button')?.click();
    harness.detectChanges();

    const fresh = http.expectOne('/api/runs');
    expect(idempotencyKey(fresh)).not.toBe(firstKey);
    fresh.flush(
      {
        code: 'VALIDATION_ERROR',
        message: 'The request is not valid.',
        requestId: 'req-rerun-invalid',
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await harness.fixture.whenStable();
  });

  it('links to the active run on RUN_ALREADY_ACTIVE and keeps the record', async () => {
    const harness = await openLoaded(PASSED_SNAPSHOT);
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);

    root.querySelector<HTMLButtonElement>('#run-again-button')?.click();
    harness.detectChanges();

    http.expectOne('/api/runs').flush(
      {
        code: 'RUN_ALREADY_ACTIVE',
        message: 'Another run is already active.',
        requestId: 'req-rerun-active',
        details: { activeRunId: ACTIVE_RUN_ID },
      },
      { status: 409, statusText: 'Conflict' },
    );
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.textContent).toContain('Another run is already active');
    expect(root.textContent).toContain('req-rerun-active');
    expect(
      root.querySelector<HTMLAnchorElement>(`a[href="/runs/${ACTIVE_RUN_ID}"]`)?.textContent,
    ).toContain('Open active run');
    expect(router.url).toBe(`/runs/${RUN_ID}`);
    expect(root.querySelector('.status-badge')?.textContent).toContain('Passed');
  });

  it('shows 400 field errors from Run Again without changing the recorded run', async () => {
    const harness = await openLoaded(PASSED_SNAPSHOT);
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    root.querySelector<HTMLButtonElement>('#run-again-button')?.click();
    harness.detectChanges();

    http.expectOne('/api/runs').flush(
      {
        code: 'VALIDATION_ERROR',
        message: 'Check the submitted settings.',
        requestId: 'req-rerun-validation',
        fieldErrors: [
          {
            path: 'seed',
            code: 'SEED_REJECTED',
            message: 'This seed is not accepted for the selected plan.',
          },
        ],
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await harness.fixture.whenStable();
    harness.detectChanges();

    const fieldErrors = root.querySelector('.field-errors');
    expect(fieldErrors?.textContent).toContain('seed');
    expect(fieldErrors?.textContent).toContain('This seed is not accepted for the selected plan.');
    expect(root.textContent).toContain('The recorded run on this page has not changed.');
    expect(root.querySelector('.status-badge')?.textContent).toContain('Passed');
  });

  it('shows a 404 run state and retries with the same run id', async () => {
    const harness = await open();
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    expect(root.textContent).toContain('Loading run snapshot…');

    http.expectOne(`/api/runs/${RUN_ID}`).flush(
      {
        code: 'NOT_FOUND',
        message: 'The run was not found.',
        requestId: 'req-run-404',
      },
      { status: 404, statusText: 'Not Found' },
    );
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.textContent).toContain('Run not found');
    expect(root.textContent).toContain(RUN_ID);
    expect(root.textContent).toContain('req-run-404');
    expect(root.textContent).not.toContain('Passed');

    findButton(root, 'Try again')?.click();
    harness.detectChanges();

    http.expectOne(`/api/runs/${RUN_ID}`).flush(PASSED_SNAPSHOT);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.querySelector('.status-badge')?.textContent).toContain('Passed');
  });

  it('shows a retryable load error', async () => {
    const harness = await open();
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    http.expectOne(`/api/runs/${RUN_ID}`).flush(
      {
        code: 'SERVICE_UNAVAILABLE',
        message: 'The run service is unavailable.',
        requestId: 'req-run-503',
      },
      { status: 503, statusText: 'Service Unavailable' },
    );
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.textContent).toContain('The run snapshot could not be loaded');
    expect(root.textContent).toContain('The run service is unavailable.');
    expect(root.textContent).toContain('req-run-503');
    expect(findButton(root, 'Try again')).not.toBeUndefined();
  });

  it('refreshes the snapshot and reports the refreshed state', async () => {
    const harness = await openLoaded(RUNNING_SNAPSHOT);
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    expect(root.textContent).toContain('1 of 4 samples recorded (25%)');

    root.querySelector<HTMLButtonElement>('#refresh-run-button')?.click();
    harness.detectChanges();

    expect(root.querySelector<HTMLButtonElement>('#refresh-run-button')?.textContent).toContain(
      'Refreshing…',
    );

    const refreshed = {
      ...RUNNING_SNAPSHOT,
      recordedSampleCount: 2,
      steps: [
        {
          ...VOLTAGE_STEP,
          status: 'RUNNING',
          outcome: null,
          recordedCount: 2,
          statistics: {
            minimum: '4.980000',
            maximum: '5.010000',
            average: '4.995000',
            sampleCount: 2,
          },
        },
        RUNNING_SNAPSHOT.steps[1],
      ],
    };

    http.expectOne(`/api/runs/${RUN_ID}`).flush(refreshed);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.textContent).toContain('2 of 4 samples recorded (50%)');
    expect(root.textContent).toContain('The latest run snapshot has been loaded.');
  });

  it('does not let an older response overwrite a newer run selection', async () => {
    const harness = await openLoaded(PASSED_SNAPSHOT);
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);

    root.querySelector<HTMLButtonElement>('#refresh-run-button')?.click();
    harness.detectChanges();

    const staleRefresh = http.expectOne(`/api/runs/${RUN_ID}`);

    await harness.navigateByUrl(`/runs/${OTHER_RUN_ID}`);
    const otherRequest = http.expectOne(`/api/runs/${OTHER_RUN_ID}`);
    otherRequest.flush({
      ...PASSED_SNAPSHOT,
      id: OTHER_RUN_ID,
      planName: 'Second plan',
      seed: 7,
    });
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(router.url).toBe(`/runs/${OTHER_RUN_ID}`);
    expect(root.querySelector('#run-summary-heading')?.textContent?.trim()).toBe('Second plan');

    staleRefresh.flush({
      ...PASSED_SNAPSHOT,
      planName: 'Stale plan',
      seed: 999,
    });
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.querySelector('#run-summary-heading')?.textContent?.trim()).toBe('Second plan');
    expect(root.textContent).toContain('7');
    expect(root.textContent).not.toContain('Stale plan');
  });

  it('shows the total out-of-tolerance count and the first failure step, sample index, and value', async () => {
    const harness = await openLoaded(FAILED_SNAPSHOT);
    const root = rootOf(harness);

    expect(root.querySelector('#total-out-of-tolerance')?.textContent?.trim()).toBe('1');

    const firstFailure = root.querySelector('#first-failure-summary')?.textContent ?? '';
    expect(firstFailure).toContain('Step 2: Current draw');
    expect(firstFailure).toContain('Sample index 1');
    expect(firstFailure).toContain('0.600000 A');

    expect(root.querySelector('#partial-sample-summary')?.textContent).toContain(
      'None — every expected sample was recorded',
    );
  });

  it('uses only the stored run snapshot, never the current plan draft', async () => {
    const harness = await openLoaded(PASSED_SNAPSHOT);
    const root = rootOf(harness);

    expect(root.textContent).toContain('Power rail verification');
    expect(root.textContent).toContain('Version 3');
    expect(root.textContent).toContain('4.750000 V');
    expect(
      TestBed.inject(HttpTestingController).match((request) =>
        request.url.startsWith('/api/plans'),
      ),
    ).toHaveLength(0);
  });

  it('renders a single-sample step without inventing extra rows', async () => {
    const singleSampleStep = {
      ...VOLTAGE_STEP,
      sampleCount: 1,
      recordedCount: 1,
      measurements: [VOLTAGE_STEP.measurements[0]],
      statistics: {
        minimum: '4.980000',
        maximum: '4.980000',
        average: '4.980000',
        sampleCount: 1,
      },
    };
    const harness = await openLoaded({
      ...PASSED_SNAPSHOT,
      expectedSampleCount: 1,
      recordedSampleCount: 1,
      steps: [singleSampleStep],
    });
    const root = rootOf(harness);

    expect(root.textContent).toContain('1 of 1 samples recorded (100%)');
    expect(root.querySelectorAll('.step-card')).toHaveLength(1);
    expect(root.querySelectorAll('.step-card table tbody tr')).toHaveLength(1);
    expect(root.textContent).toContain('4.980000 V');
    expect(root.querySelector('#partial-sample-summary')?.textContent).toContain(
      'None — every expected sample was recorded',
    );
  });

  it('reports the partial sample count and percentage with the recorded value missing', async () => {
    const harness = await openLoaded(CANCELLED_SNAPSHOT);
    const root = rootOf(harness);

    expect(root.querySelector('#total-out-of-tolerance')?.textContent?.trim()).toBe('0');
    expect(root.querySelector('#partial-sample-summary')?.textContent).toContain('3 of 4');
    expect(root.querySelector('#partial-sample-summary')?.textContent).toContain('(75%)');
    expect(root.textContent).toContain('not recorded');
    expect(root.querySelector('#first-failure-summary')?.textContent).toContain('None recorded');
    expect(root.textContent).toContain('This is not a Passed or Failed result');
  });

  it('never presents a stopped run as Passed or Failed even when an outcome is present', async () => {
    const harness = await openLoaded({
      ...ERROR_SNAPSHOT,
      outcome: 'PASSED',
    });
    const root = rootOf(harness);

    expect(root.querySelector('.status-badge')?.textContent).toContain('Error');
    expect(root.querySelector('.status-badge')?.textContent).not.toContain('Passed');
    expect(root.querySelector('.status-badge')?.textContent).not.toContain('Failed');
    expect(root.textContent).toContain('not a Passed or Failed result');
  });

  it('renders one measurement chart per step and never duplicates a chart on re-render', async () => {
    const harness = await openLoaded(PASSED_SNAPSHOT);
    const root = rootOf(harness);

    expect(root.querySelectorAll('app-measurement-chart')).toHaveLength(2);
    expect(chartFactory.created).toHaveLength(2);
    expect(chartFactory.created[0]?.config.data.datasets[0]?.data).toHaveLength(2);
    expect(chartFactory.created[1]?.config.data.datasets[0]?.data).toHaveLength(2);

    settle(harness);
    settle(harness);

    expect(chartFactory.created).toHaveLength(2);
  });

  it('uses the same recorded value and backend flag in the chart and the table', async () => {
    const harness = await openLoaded(FAILED_SNAPSHOT);
    const root = rootOf(harness);
    const chartPoints = chartFactory.created[1]?.config.data.datasets[0]?.data ?? [];
    const failingPoint = chartPoints.find((point) => point.sampleIndex === 1);
    const row = measurementRow(root, RUN_STEP_2, 1);

    expect(failingPoint?.measurement.value).toBe('0.600000');
    expect(failingPoint?.measurement.isWithinTolerance).toBe(false);
    expect(row?.textContent).toContain('0.600000');
    expect(row?.textContent).toContain('Outside tolerance');
    expect(chartPoints).toHaveLength(2);
  });

  it('selects and focuses the measurement row when a chart point is clicked', async () => {
    const harness = await openLoaded(FAILED_SNAPSHOT);
    const root = rootOf(harness);
    const failureChart = chartFactory.created[1];
    expect(failureChart).toBeDefined();

    failureChart?.clickPoint(1);
    settle(harness);

    const row = measurementRow(root, RUN_STEP_2, 1);
    expect(row?.classList.contains('is-selected')).toBe(true);
    expect(row?.getAttribute('aria-current')).toBe('true');
    expect(document.activeElement?.id).toBe(row?.id);
    expect(root.textContent).toContain('Outside tolerance: sample 1 of step 2, Current draw');
    expect(root.textContent).toContain('The measurement row is focused in the table.');
    expect(failureChart?.updateCalls.length).toBeGreaterThan(0);
  });

  it('reaches the same selection from the chart failure list and switches step correctly', async () => {
    const harness = await openLoaded(FAILED_SNAPSHOT);
    const root = rootOf(harness);

    const failureButton = root
      .querySelectorAll('app-measurement-chart')[1]
      ?.querySelector<HTMLButtonElement>('.failure-item');
    expect(failureButton?.tagName).toBe('BUTTON');
    failureButton?.click();
    settle(harness);

    const stepTwoRow = measurementRow(root, RUN_STEP_2, 1);
    expect(stepTwoRow?.classList.contains('is-selected')).toBe(true);
    expect(document.activeElement?.id).toBe(stepTwoRow?.id);

    measurementRow(root, RUN_STEP_1, 0)?.click();
    settle(harness);

    const stepOneRow = measurementRow(root, RUN_STEP_1, 0);
    expect(stepOneRow?.classList.contains('is-selected')).toBe(true);
    expect(stepTwoRow?.classList.contains('is-selected')).toBe(false);
    expect(root.textContent).toContain('Within tolerance: sample 0 of step 1, Output voltage');

    settle(harness);
    expect(stepOneRow?.classList.contains('is-selected')).toBe(true);
  });

  it('offers a keyboard alternative on out-of-tolerance table rows', async () => {
    const harness = await openLoaded(FAILED_SNAPSHOT);
    const root = rootOf(harness);
    const row = measurementRow(root, RUN_STEP_2, 1);

    expect(row?.getAttribute('tabindex')).toBe('0');
    expect(row?.getAttribute('aria-label')).toContain('outside tolerance');
    expect(measurementRow(root, RUN_STEP_1, 0)?.getAttribute('tabindex')).toBe('-1');

    row?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    settle(harness);

    expect(row?.classList.contains('is-selected')).toBe(true);
    expect(document.activeElement?.id).toBe(row?.id);
  });

  it('focuses the measurement table from the chart table link and the first-failure action', async () => {
    const harness = await openLoaded(FAILED_SNAPSHOT);
    const root = rootOf(harness);
    const tableLink = root
      .querySelectorAll('app-measurement-chart')[1]
      ?.querySelector<HTMLAnchorElement>('.table-link');

    const notCancelled = tableLink?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    expect(notCancelled).toBe(false);
    settle(harness);
    expect(document.activeElement?.id).toBe(`measurements-table-${RUN_STEP_2}`);
    expect(root.textContent).toContain('Measurement table for step 2, Current draw, is focused.');

    root.querySelector<HTMLButtonElement>('.first-failure-action')?.click();
    settle(harness);

    const row = measurementRow(root, RUN_STEP_2, 1);
    expect(row?.classList.contains('is-selected')).toBe(true);
    expect(document.activeElement?.id).toBe(row?.id);
  });

  it('clears a selection when a refreshed snapshot no longer contains that sample', async () => {
    const harness = await openLoaded(FAILED_SNAPSHOT);
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    measurementRow(root, RUN_STEP_2, 1)?.click();
    settle(harness);
    expect(measurementRow(root, RUN_STEP_2, 1)?.classList.contains('is-selected')).toBe(true);

    root.querySelector<HTMLButtonElement>('#refresh-run-button')?.click();
    harness.detectChanges();

    http.expectOne(`/api/runs/${RUN_ID}`).flush({
      ...FAILED_SNAPSHOT,
      recordedSampleCount: 3,
      steps: [
        VOLTAGE_STEP,
        {
          ...CURRENT_STEP,
          recordedCount: 1,
          outOfToleranceCount: 0,
          firstFailureSampleIndex: null,
          hasOutOfTolerance: false,
          measurements: [CURRENT_STEP.measurements[0]],
        },
      ],
    });
    await harness.fixture.whenStable();
    settle(harness);

    expect(root.querySelector('.step-card tbody tr.is-selected')).toBeNull();
    expect(root.querySelector('.step-card tbody tr[aria-current="true"]')).toBeNull();
    expect(chartFactory.created[1]?.config.data.datasets[0]?.data).toHaveLength(1);
  });
});
