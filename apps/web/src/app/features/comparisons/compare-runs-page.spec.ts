import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, TitleStrategy, provideRouter, withDisabledInitialNavigation } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { routes } from '../../app.routes';
import { AuthSessionStore } from '../../core/auth/auth-session.store';
import type { Role } from '../../core/auth/auth.types';
import { AppTitleStrategy } from '../../core/title/app-title.strategy';
import { MEASUREMENT_CHART_FACTORY } from '../../shared/charts/measurement-chart.factory';
import {
  FakeMeasurementChartFactory,
} from '../../shared/charts/testing/fake-measurement-chart';
import type { RunHistoryItem, RunHistoryPage } from '../runs/runs-api.types';
import {
  ADDED_STEP_ID,
  COMPARE_PLAN_ID,
  CURRENT_STEP_ID,
  LEFT_RUN_ID,
  LEFT_VERSION_ID,
  REMOVED_STEP_ID,
  RIGHT_RUN_ID,
  RIGHT_VERSION_ID,
  TEMPERATURE_STEP_ID,
  VOLTAGE_STEP_ID,
  comparisonResult,
  comparisonRun,
} from './testing/comparison-fixtures';

const OTHER_PLAN_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OTHER_RUN_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const RUNNING_RUN_ID = 'cccccccc-dddd-4eee-8fff-121212121212';
const USER_ID = '12121212-3434-4565-8787-909090909090';

function historyItem(overrides: Partial<RunHistoryItem> = {}): RunHistoryItem {
  return {
    id: LEFT_RUN_ID,
    planId: COMPARE_PLAN_ID,
    planVersionId: LEFT_VERSION_ID,
    planName: 'Power rail verification',
    versionNumber: 3,
    scenario: 'NORMAL',
    seed: 42,
    status: 'COMPLETED',
    outcome: 'PASSED',
    startedAt: '2026-11-03T10:00:00.000Z',
    finishedAt: '2026-11-03T10:00:04.000Z',
    expectedSampleCount: 8,
    recordedSampleCount: 8,
    outOfToleranceCount: 0,
    firstFailure: null,
    partial: false,
    requestedBy: { id: USER_ID, email: 'viewer@probedesk.local', role: 'VIEWER' },
    ...overrides,
  };
}

function runOptionsPage(items: readonly RunHistoryItem[]): RunHistoryPage {
  return {
    items: [...items],
    page: 1,
    limit: 100,
    total: items.length,
    totalPages: items.length === 0 ? 0 : 1,
  };
}

function render(harness: RouterTestingHarness): HTMLElement {
  return harness.fixture.nativeElement as HTMLElement;
}

async function settle(harness: RouterTestingHarness): Promise<void> {
  await harness.fixture.whenStable();
  TestBed.tick();
  harness.detectChanges();
}

describe('CompareRunsPage', () => {
  let factory: FakeMeasurementChartFactory;

  beforeEach(async () => {
    factory = new FakeMeasurementChartFactory();
    await TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter(routes, withDisabledInitialNavigation()),
        { provide: TitleStrategy, useClass: AppTitleStrategy },
        { provide: MEASUREMENT_CHART_FACTORY, useValue: factory },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  function httpClient(): HttpTestingController {
    return TestBed.inject(HttpTestingController);
  }

  function actAs(role: Role = 'VIEWER'): void {
    TestBed.inject(AuthSessionStore).authenticate({
      id: USER_ID,
      email: `${role.toLowerCase()}@probedesk.local`,
      role,
    });
  }

  async function open(url: string): Promise<RouterTestingHarness> {
    actAs();
    const harness = await RouterTestingHarness.create(url);
    harness.detectChanges();
    return harness;
  }

  function expectComparisonRequest(
    leftRunId = LEFT_RUN_ID,
    rightRunId = RIGHT_RUN_ID,
  ): TestRequest {
    const request = httpClient().expectOne(
      (candidate) => candidate.url === '/api/comparisons',
    );
    expect(request.request.params.get('leftRunId')).toBe(leftRunId);
    expect(request.request.params.get('rightRunId')).toBe(rightRunId);
    return request;
  }

  async function openComparison(
    result = comparisonResult(),
  ): Promise<RouterTestingHarness> {
    const harness = await open(
      `/compare?leftRunId=${LEFT_RUN_ID}&rightRunId=${RIGHT_RUN_ID}`,
    );
    expectComparisonRequest().flush(result);
    await settle(harness);
    return harness;
  }

  function expectRunOptionsRequest(): TestRequest {
    const request = httpClient().expectOne((candidate) => candidate.url === '/api/runs');
    expect(request.request.params.get('page')).toBe('1');
    expect(request.request.params.get('limit')).toBe('100');
    return request;
  }

  function findStepCard(root: HTMLElement, logicalStepId: string): HTMLElement {
    const card = root.querySelector<HTMLElement>(
      `app-comparison-step-card mat-card[data-logical-step-id="${logicalStepId}"]`,
    );
    if (card === null) {
      throw new Error(`Step card not found: ${logicalStepId}`);
    }
    return card;
  }

  it('opens a deep link, requests the exact pair, and renders both run summaries', async () => {
    const harness = await openComparison();
    const root = render(harness);

    expect(TestBed.inject(Router).url).toBe(
      `/compare?leftRunId=${LEFT_RUN_ID}&rightRunId=${RIGHT_RUN_ID}`,
    );
    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Compare Runs');
    expect(document.title).toBe('Compare Runs · ProbeDesk');
    expect(root.textContent).toContain('Left run');
    expect(root.textContent).toContain('Right run');
    expect(root.textContent).toContain('Power rail verification · Version 3');
    expect(root.textContent).toContain('Power rail verification · Version 4');
    expect(root.textContent).toContain('8 of 8');
    expect(root.textContent).toContain('10 of 10');
    expect(root.textContent).toContain('Nov 3, 2026');
    expect(root.textContent).toContain('UTC');
    expect(root.textContent).toContain('The runs used different plan versions');
    expect(root.textContent).toContain('matched by logicalStepId');
    expect(root.textContent).toContain('3');
    expect(root.textContent).toContain('Only in right run');
    expect(root.textContent).toContain('Only in left run');
    expect(root.textContent).toContain('Changed rule fields');
    expect(
      root.querySelector<HTMLAnchorElement>(`a[href="/runs/${LEFT_RUN_ID}"]`),
    ).not.toBeNull();
    expect(
      root.querySelector<HTMLAnchorElement>(`a[href="/runs/${RIGHT_RUN_ID}"]`),
    ).not.toBeNull();
  });

  it('highlights changed rule fields and keeps a renamed/reordered step on its logicalStepId', async () => {
    const harness = await openComparison();
    const root = render(harness);
    const card = findStepCard(root, CURRENT_STEP_ID);

    expect(root.querySelectorAll(`[data-logical-step-id="${CURRENT_STEP_ID}"]`)).toHaveLength(1);
    expect(card.textContent).toContain('Current draw → Current draw (renamed)');
    expect(card.textContent).toContain('Renamed from Current draw to Current draw (renamed)');
    expect(card.textContent).toContain('Position 2 → 3');
    expect(card.textContent).toContain('Changed rule fields');

    for (const field of [
      'name',
      'position',
      'minimum',
      'maximum',
      'sampleCount',
      'intervalMs',
    ]) {
      expect(card.querySelector(`[data-field="${field}"]`)?.getAttribute('data-changed')).toBe(
        'true',
      );
      expect(card.querySelector(`[data-field="${field}"]`)?.textContent).toContain('Changed');
    }

    expect(card.querySelector('[data-field="unit"]')?.getAttribute('data-changed')).toBeNull();
    expect(card.querySelector('[data-field="name"]')?.textContent).toContain('Current draw');
    expect(card.querySelector('[data-field="name"]')?.textContent).toContain(
      'Current draw (renamed)',
    );
    expect(card.querySelector('[data-field="intervalMs"]')?.textContent).toContain('500');
    expect(card.querySelector('[data-field="intervalMs"]')?.textContent).toContain('750');
    expect(card.querySelector('[data-field="unit"]')?.textContent).not.toContain('Changed');
    expect(
      findStepCard(root, VOLTAGE_STEP_ID).textContent,
    ).toContain('No rule field changed');
  });

  it('shows added and removed steps one-sided without zero-filling the absent run', async () => {
    const harness = await openComparison();
    const root = render(harness);
    const added = findStepCard(root, ADDED_STEP_ID);
    const removed = findStepCard(root, REMOVED_STEP_ID);

    expect(added.getAttribute('data-presence')).toBe('added');
    expect(added.textContent).toContain('Only in the right run');
    expect(added.textContent).toContain('Humidity');
    expect(added.textContent).toContain('intentionally absent, not zero-filled');
    expect(added.querySelectorAll('.rules-table thead th')).toHaveLength(2);
    expect(added.textContent).not.toContain('Not in this run');
    expect(added.querySelectorAll('.measurement-table')).toHaveLength(1);
    expect(added.textContent).toContain('Right run · Version 4');
    expect(added.querySelector('canvas')).toBeNull();

    expect(removed.getAttribute('data-presence')).toBe('removed');
    expect(removed.textContent).toContain('Only in the left run');
    expect(removed.textContent).toContain('Leakage current');
    expect(removed.querySelectorAll('.rules-table thead th')).toHaveLength(2);
    expect(removed.textContent).not.toContain('Not in this run');
    expect(removed.querySelectorAll('.measurement-table')).toHaveLength(1);
    expect(removed.textContent).toContain('Left run · Version 3');
  });

  it('draws a dual-series chart for a shared unit and separate panels for a unit change', async () => {
    const harness = await openComparison();
    const root = render(harness);
    const voltage = findStepCard(root, VOLTAGE_STEP_ID);
    const temperature = findStepCard(root, TEMPERATURE_STEP_ID);

    expect(voltage.querySelector('app-comparison-chart')).not.toBeNull();
    expect(voltage.querySelector('app-measurement-chart')).toBeNull();
    expect(voltage.textContent).toContain('Comparison chart');
    expect(voltage.textContent).toContain('Left tolerance 4.750000 – 5.250000 V');
    expect(voltage.textContent).toContain('Right tolerance 4.750000 – 5.250000 V');

    const voltageHandle = factory.created[0];
    expect(voltageHandle?.config.data.datasets).toHaveLength(2);
    expect(voltageHandle?.config.data.datasets[0]?.data.map((point) => point.x)).toEqual([
      500, 1000, 1500,
    ]);
    expect(voltageHandle?.config.data.datasets[1]?.data.map((point) => point.x)).toEqual([
      400, 900, 1400,
    ]);

    expect(temperature.querySelector('app-comparison-chart')).toBeNull();
    expect(temperature.querySelectorAll('app-measurement-chart')).toHaveLength(2);
    expect(temperature.textContent).toContain('The unit changed between the runs');
    expect(temperature.textContent).toContain('separate panel');
    expect(temperature.textContent).toContain('No shared axis, numeric delta, or index alignment');
    expect(temperature.textContent).toContain('Left run · Version 3 · °C');
    expect(temperature.textContent).toContain('Right run · Version 4 · °F');
    expect(temperature.querySelector('[data-stat="minimum"]')?.textContent).toContain(
      'Not calculated — units differ',
    );

    expect(voltage.querySelector('[data-stat="minimum"]')?.textContent).toContain('0.120000');
    expect(voltage.querySelector('[data-stat="sampleCount"]')?.textContent).toContain('0');
  });

  it('opens and focuses the matching measurement row when a comparison point is selected', async () => {
    const harness = await openComparison();
    const root = render(harness);
    const voltage = findStepCard(root, VOLTAGE_STEP_ID);
    const handle = factory.created[0];
    const onClick = (
      handle?.config.options as
        | { onClick?: (event: unknown, elements: unknown[], chart: unknown) => void }
        | undefined
    )?.onClick;

    expect(typeof onClick).toBe('function');
    onClick?.({}, [{ datasetIndex: 0, index: 1 }], {});
    harness.detectChanges();

    const row = document.getElementById(
      'comparison-measurement-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb-1',
    );
    expect(row).not.toBeNull();
    expect(document.activeElement?.id).toBe(row?.id);
    expect(voltage.querySelector('.measurements-section')?.hasAttribute('open')).toBe(true);
    expect(voltage.textContent).toContain('Left run sample 1');
    expect(voltage.textContent).toContain('measurement row is focused');
  });

  it('moves focus from a single-run chart link to the matching comparison table', async () => {
    const harness = await openComparison();
    const root = render(harness);
    const temperature = findStepCard(root, TEMPERATURE_STEP_ID);

    root
      .querySelector<HTMLButtonElement>(
        `.step-jump-button[aria-controls="comparison-step-${TEMPERATURE_STEP_ID}"]`,
      )
      ?.click();
    harness.detectChanges();

    const link = temperature.querySelector<HTMLAnchorElement>('.table-link');
    const table = temperature.querySelector<HTMLTableElement>('.measurement-table');

    expect(link?.getAttribute('href')).toBe(`#${table?.id}`);
    link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    harness.detectChanges();

    expect(document.activeElement?.id).toBe(table?.id);
    expect(temperature.textContent).toContain('measurement table for this run is focused');
  });

  it('renders accessible measurement tables for both runs with stored results and UTC times', async () => {
    const harness = await openComparison();
    const root = render(harness);
    const voltage = findStepCard(root, VOLTAGE_STEP_ID);
    const tables = Array.from(voltage.querySelectorAll<HTMLTableElement>('.measurement-table'));

    expect(tables).toHaveLength(2);
    expect(tables[0]?.querySelector('caption')?.textContent).toContain(
      'Left run version 3 recorded measurements',
    );
    expect(tables[1]?.querySelector('caption')?.textContent).toContain(
      'Right run version 4 recorded measurements',
    );
    expect(tables[0]?.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(tables[1]?.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(tables[0]?.textContent).toContain('5.000000');
    expect(tables[1]?.textContent).toContain('5.600000');
    expect(tables[1]?.textContent).toContain('Outside tolerance');
    expect(tables[0]?.textContent).toContain('Within tolerance');
    expect(tables[0]?.textContent).toContain('UTC');
    const columnHeaders = Array.from(
      tables[0]?.querySelectorAll('th[scope="col"]') ?? [],
    ).map((header) => header.textContent ?? '');
    expect(columnHeaders.join(' ')).toContain('Sample index');
    expect(columnHeaders.join(' ')).toContain('Stored result');

    const current = findStepCard(root, CURRENT_STEP_ID);
    const currentTables = current.querySelectorAll('.measurement-table');
    expect(currentTables[0]?.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(currentTables[1]?.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(current.textContent).toContain('not aligned row by row');
  });

  it('keeps partial runs and missing samples explicit without inventing a Passed result', async () => {
    const result = comparisonResult();
    const partialLeft = comparisonRun({
      status: 'CANCELLED',
      outcome: null,
      expectedSampleCount: 8,
      recordedSampleCount: 6,
      outOfToleranceCount: 0,
      partial: true,
      finishedAt: '2026-11-03T10:00:02.000Z',
    });
    const voltage = result.matchedSteps[0];
    if (voltage === undefined) {
      throw new Error('Fixture is missing the voltage step.');
    }
    const partialVoltage = {
      ...voltage.left,
      status: 'CANCELLED' as const,
      outcome: null,
      recordedCount: 2,
      measurements: voltage.left.measurements.slice(0, 2),
      statistics: {
        minimum: '5.000000',
        maximum: '5.100000',
        average: '5.050000',
        sampleCount: 2,
      },
    };

    const harness = await openComparison({
      ...result,
      leftRun: partialLeft,
      matchedSteps: [
        {
          ...voltage,
          left: partialVoltage,
        },
        ...result.matchedSteps.slice(1),
      ],
    });
    const root = render(harness);
    const card = findStepCard(root, VOLTAGE_STEP_ID);
    const runCard = root.querySelector<HTMLElement>('.run-card[data-side="left"]');
    const leftTable = card.querySelector<HTMLTableElement>('.measurement-table');

    expect(runCard?.textContent).toContain('Cancelled');
    expect(runCard?.querySelector('.status-badge--passed')).toBeNull();
    expect(runCard?.textContent).toContain('Partial data');
    expect(runCard?.textContent).toContain('6 of 8 expected samples were recorded');
    expect(runCard?.textContent).toContain('2 are missing');
    expect(card.textContent).toContain('Partial');
    expect(card.textContent).toContain('2 of 3 expected samples recorded; 1 missing');
    expect(card.textContent).toContain('Missing samples are not zero-filled');
    expect(leftTable?.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(card.textContent).not.toContain('0.000000');
  });

  it.each([
    {
      status: 409,
      code: 'RUN_NOT_TERMINAL',
      heading: 'A running run cannot be compared',
    },
    {
      status: 422,
      code: 'COMPARISON_PLAN_MISMATCH',
      heading: 'The runs belong to different plans',
    },
    {
      status: 404,
      code: 'NOT_FOUND',
      heading: 'One of the runs was not found',
    },
  ])('maps $code to a clear error with recovery actions', async ({ status, code, heading }) => {
    const harness = await open(
      `/compare?leftRunId=${LEFT_RUN_ID}&rightRunId=${RIGHT_RUN_ID}`,
    );
    expectComparisonRequest().flush(
      { code, message: 'The comparison request failed.', requestId: `req-compare-${status}` },
      { status, statusText: 'Comparison failed' },
    );
    await settle(harness);

    const root = render(harness);
    expect(root.querySelector('#comparison-error')?.getAttribute('role')).toBe('alert');
    expect(root.textContent).toContain(heading);
    expect(root.textContent).toContain(`req-compare-${status}`);
    expect(root.querySelector('#retry-comparison')).toBeNull();
    expect(root.querySelector('#choose-different-runs')).not.toBeNull();

    root.querySelector<HTMLButtonElement>('#choose-different-runs')?.click();
    await settle(harness);
    expect(root.textContent).toContain('Choose two runs');
    expectRunOptionsRequest().flush(
      runOptionsPage([
        historyItem(),
        historyItem({ id: RIGHT_RUN_ID, versionNumber: 4, planVersionId: RIGHT_VERSION_ID }),
      ]),
    );
    await settle(harness);
    expect(root.querySelector('#compare-left-run')).not.toBeNull();
  });

  it('explains when both runs used the same plan version', async () => {
    const result = comparisonResult();
    const harness = await openComparison({
      ...result,
      versionDifference: {
        sameVersion: true,
        leftVersionNumber: 3,
        rightVersionNumber: 3,
      },
      rightRun: {
        ...result.rightRun,
        versionNumber: 3,
        planVersionId: LEFT_VERSION_ID,
      },
    });
    const root = render(harness);

    expect(root.textContent).toContain('Both runs used the same plan version');
    expect(root.textContent).toContain('Any measurement or outcome difference');
  });

  it('recovers from a server error with a retry of the same pair', async () => {
    const harness = await open(
      `/compare?leftRunId=${LEFT_RUN_ID}&rightRunId=${RIGHT_RUN_ID}`,
    );
    expectComparisonRequest().flush(
      {
        code: 'INTERNAL_ERROR',
        message: 'The comparison service failed.',
        requestId: 'req-compare-500',
      },
      { status: 500, statusText: 'Internal Server Error' },
    );
    await settle(harness);

    const root = render(harness);
    expect(root.textContent).toContain('The comparison could not be loaded');
    expect(root.textContent).toContain('The comparison service failed.');
    expect(root.textContent).toContain('req-compare-500');
    expect(root.querySelector('#retry-comparison')).not.toBeNull();

    root.querySelector<HTMLButtonElement>('#retry-comparison')?.click();
    await settle(harness);

    expectComparisonRequest().flush(comparisonResult());
    await settle(harness);

    expect(root.textContent).toContain('Run summaries');
    expect(root.querySelector('#comparison-error')).toBeNull();
  });

  it('shows a session-expired state on 401 with a sign-in link', async () => {
    const harness = await open(
      `/compare?leftRunId=${LEFT_RUN_ID}&rightRunId=${RIGHT_RUN_ID}`,
    );
    expectComparisonRequest().flush(
      {
        code: 'UNAUTHENTICATED',
        message: 'The session has expired.',
        requestId: 'req-compare-401',
      },
      { status: 401, statusText: 'Unauthorized' },
    );
    await settle(harness);

    const root = render(harness);
    expect(root.textContent).toContain('Your session has expired');
    expect(root.querySelector('a[href="/login"]')?.textContent).toContain('Sign in again');
    expect(root.querySelector('#choose-different-runs')).toBeNull();
  });

  it('loads options on an empty link, validates the pair, and navigates with both ids', async () => {
    const harness = await open('/compare');
    const root = render(harness);

    expect(root.textContent).toContain('Choose two runs');
    expect(root.textContent).toContain('Loading recent runs…');
    const optionsRequest = expectRunOptionsRequest();
    optionsRequest.flush(
      runOptionsPage([
        historyItem(),
        historyItem({ id: RIGHT_RUN_ID, versionNumber: 4, planVersionId: RIGHT_VERSION_ID }),
        historyItem({
          id: OTHER_RUN_ID,
          planId: OTHER_PLAN_ID,
          planName: 'Thermal soak',
        }),
        historyItem({
          id: RUNNING_RUN_ID,
          status: 'RUNNING',
          outcome: null,
          finishedAt: null,
        }),
      ]),
    );
    await settle(harness);

    const runningOption = Array.from(
      root.querySelectorAll<HTMLOptionElement>('#compare-left-run option'),
    ).find((option) => option.value === RUNNING_RUN_ID);
    expect(runningOption?.disabled).toBe(true);

    const leftSelect = root.querySelector<HTMLSelectElement>('#compare-left-run');
    const rightSelect = root.querySelector<HTMLSelectElement>('#compare-right-run');
    if (leftSelect === null || rightSelect === null) {
      throw new Error('Run selectors were not rendered.');
    }

    leftSelect.value = LEFT_RUN_ID;
    leftSelect.dispatchEvent(new Event('change', { bubbles: true }));
    await settle(harness);

    const otherPlanOption = Array.from(rightSelect.options).find(
      (option) => option.value === OTHER_RUN_ID,
    );
    expect(otherPlanOption?.disabled).toBe(true);

    rightSelect.value = RIGHT_RUN_ID;
    rightSelect.dispatchEvent(new Event('change', { bubbles: true }));
    await settle(harness);

    expect(root.textContent).toContain('Ready to compare');
    expect(
      root.querySelector<HTMLButtonElement>('#apply-comparison-selection')?.disabled,
    ).toBe(false);

    root.querySelector<HTMLButtonElement>('#apply-comparison-selection')?.click();
    await settle(harness);

    expect(TestBed.inject(Router).url).toBe(
      `/compare?leftRunId=${LEFT_RUN_ID}&rightRunId=${RIGHT_RUN_ID}`,
    );
    expectComparisonRequest().flush(comparisonResult());
    await settle(harness);

    expect(root.textContent).toContain('Run summaries');
    expect(root.querySelector('app-comparison-step-card')).not.toBeNull();
  });

  it('rejects an incomplete or self-comparing deep link locally', async () => {
    const incomplete = await open(`/compare?leftRunId=${LEFT_RUN_ID}`);
    const incompleteRoot = render(incomplete);

    expect(incompleteRoot.textContent).toContain('missing rightRunId');
    expect(incompleteRoot.querySelector('h1')?.textContent?.trim()).toBe('Compare Runs');
    expect(
      httpClient().match((request) => request.url === '/api/comparisons'),
    ).toHaveLength(0);
    expectRunOptionsRequest().flush(runOptionsPage([]));
    await settle(incomplete);

    await incomplete.navigateByUrl(
      `/compare?leftRunId=${LEFT_RUN_ID}&rightRunId=${LEFT_RUN_ID}`,
    );
    await settle(incomplete);

    expect(incompleteRoot.textContent).toContain('cannot be compared with itself');
    expect(
      httpClient().match((request) => request.url === '/api/comparisons'),
    ).toHaveLength(0);
  });

  it('reloads when the URL changes and ignores a late response for the previous pair', async () => {
    const harness = await open(
      `/compare?leftRunId=${LEFT_RUN_ID}&rightRunId=${RIGHT_RUN_ID}`,
    );
    const firstRequest = expectComparisonRequest();

    const alternateRightRunId = 'dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb';
    await harness.navigateByUrl(
      `/compare?leftRunId=${LEFT_RUN_ID}&rightRunId=${alternateRightRunId}`,
    );
    await settle(harness);
    const secondRequest = expectComparisonRequest(LEFT_RUN_ID, alternateRightRunId);

    const newer = comparisonResult();
    secondRequest.flush({
      ...newer,
      versionDifference: {
        ...newer.versionDifference,
        rightVersionNumber: 5,
      },
      rightRun: {
        ...newer.rightRun,
        id: alternateRightRunId,
        versionNumber: 5,
      },
    });
    await settle(harness);

    firstRequest.flush(comparisonResult());
    await settle(harness);

    const root = render(harness);
    expect(root.textContent).toContain('Right run');
    expect(root.textContent).toContain('Version 5');
    expect(root.textContent).not.toContain('Version 4');
  });

  it('clears the pair and returns to the run selector', async () => {
    const harness = await openComparison();
    const root = render(harness);

    root.querySelector<HTMLButtonElement>('#clear-comparison')?.click();
    await settle(harness);

    expect(TestBed.inject(Router).url).toBe('/compare');
    expect(root.querySelector('#compare-left-run')).not.toBeNull();
    expect(root.textContent).toContain('Choose two runs');
    expect(root.textContent).not.toContain('Run summaries');
    expect(
      httpClient().match((request) => request.url === '/api/comparisons'),
    ).toHaveLength(0);
    expectRunOptionsRequest().flush(runOptionsPage([]));
    await settle(harness);
  });

  it('swaps the displayed sides without changing the stored comparison', async () => {
    const harness = await openComparison();
    const root = render(harness);

    root.querySelector<HTMLButtonElement>('#swap-runs')?.click();
    await settle(harness);

    expect(TestBed.inject(Router).url).toBe(
      `/compare?leftRunId=${RIGHT_RUN_ID}&rightRunId=${LEFT_RUN_ID}`,
    );
    expectComparisonRequest(RIGHT_RUN_ID, LEFT_RUN_ID).flush(comparisonResult());
    await settle(harness);

    const leftCard = root.querySelector<HTMLElement>('.run-card[data-side="left"]');
    expect(leftCard?.textContent).toContain('Version 3');
  });

  it('explains when no step is shared and does not draw a fabricated chart', async () => {
    const result = comparisonResult({ matchedSteps: [] });
    const harness = await openComparison(result);
    const root = render(harness);

    expect(root.textContent).toContain('No logicalStepId exists in both runs');
    expect(root.querySelectorAll('app-comparison-chart')).toHaveLength(0);
    expect(root.querySelectorAll('app-comparison-step-card')).toHaveLength(2);
  });

  it('does not merge a removed and re-added step that happen to share a name', async () => {
    const result = comparisonResult();
    const removed = result.removedSteps[0];
    if (removed === undefined) {
      throw new Error('Fixture is missing the removed step.');
    }

    const addedWithSameName = {
      ...result.addedSteps[0],
      logicalStepId: ADDED_STEP_ID,
      name: removed.name,
    } as (typeof result.addedSteps)[number];

    const harness = await openComparison({
      ...result,
      matchedSteps: [],
      addedSteps: [addedWithSameName],
      removedSteps: [removed],
    });
    const root = render(harness);
    const addedCard = root.querySelector<HTMLElement>(
      `mat-card[data-presence="added"][data-logical-step-id="${ADDED_STEP_ID}"]`,
    );
    const removedCard = root.querySelector<HTMLElement>(
      `mat-card[data-presence="removed"][data-logical-step-id="${REMOVED_STEP_ID}"]`,
    );

    expect(addedCard).not.toBeNull();
    expect(removedCard).not.toBeNull();
    expect(addedCard?.textContent).toContain('Leakage current');
    expect(removedCard?.textContent).toContain('Leakage current');
    expect(addedCard?.textContent).toContain('Only in the right run');
    expect(removedCard?.textContent).toContain('Only in the left run');
    expect(root.querySelectorAll('mat-card[data-presence]')).toHaveLength(2);
    expect(root.querySelector('app-comparison-chart')).toBeNull();
  });

  it('renders an empty state when both snapshots contain no steps', async () => {
    const result = comparisonResult({ matchedSteps: [], addedSteps: [], removedSteps: [] });
    const harness = await openComparison(result);
    const root = render(harness);

    expect(root.textContent).toContain('No steps to compare');
    expect(root.querySelector('app-comparison-step-card')).toBeNull();
  });
});
