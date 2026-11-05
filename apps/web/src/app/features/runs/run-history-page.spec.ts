import { selectValue, materialSelect } from '../../../testing/material-select';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
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
import type { RunHistoryItem, RunHistoryPage } from './runs-api.types';

const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_PLAN_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '33333333-3333-4333-8333-333333333333';
const RUN_2_ID = '44444444-4444-4444-8444-444444444444';
const RUN_3_ID = '55555555-5555-4555-8555-555555555555';
const USER_ID = '66666666-6666-4666-8666-666666666666';
const PROFILE_ID = '77777777-7777-4777-8777-777777777777';
const VERSION_ID = '88888888-8888-4888-8888-888888888888';
const STEP_ID = '99999999-9999-4999-8999-999999999999';

const PLAN_LIST = [
  {
    id: PLAN_ID,
    name: 'Power rail verification',
    profile: {
      id: PROFILE_ID,
      code: 'DC_POWER_MODULE',
      name: 'DC Power Module',
      description: null,
    },
    latestPublishedVersion: null,
  },
  {
    id: OTHER_PLAN_ID,
    name: 'Thermal soak',
    profile: {
      id: PROFILE_ID,
      code: 'DC_POWER_MODULE',
      name: 'DC Power Module',
      description: null,
    },
    latestPublishedVersion: null,
  },
];

function historyItem(overrides: Partial<RunHistoryItem> = {}): RunHistoryItem {
  return {
    id: RUN_ID,
    planId: PLAN_ID,
    planVersionId: VERSION_ID,
    planName: 'Power rail verification',
    versionNumber: 3,
    status: 'COMPLETED',
    outcome: 'PASSED',
    scenario: 'NORMAL',
    seed: 42,
    startedAt: '2026-11-03T10:00:00.000Z',
    finishedAt: '2026-11-03T10:00:03.000Z',
    expectedSampleCount: 4,
    recordedSampleCount: 4,
    outOfToleranceCount: 0,
    firstFailure: null,
    partial: false,
    requestedBy: {
      id: USER_ID,
      email: 'operator@probedesk.local',
      role: 'OPERATOR',
    },
    ...overrides,
  };
}

function historyPage(
  items: readonly RunHistoryItem[],
  overrides: Partial<RunHistoryPage> = {},
): RunHistoryPage {
  return {
    items: [...items],
    page: 1,
    limit: 20,
    total: items.length,
    totalPages: items.length === 0 ? 0 : 1,
    ...overrides,
  };
}

const FAILED_ITEM = historyItem({
  status: 'COMPLETED',
  outcome: 'FAILED',
  outOfToleranceCount: 1,
  firstFailure: {
    stepPosition: 2,
    stepName: 'Current draw',
    logicalStepId: STEP_ID,
    sampleIndex: 1,
  },
});

describe('RunHistoryPage', () => {
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

  function rootOf(harness: RouterTestingHarness): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  async function settle(harness: RouterTestingHarness): Promise<void> {
    await harness.fixture.whenStable();
    harness.detectChanges();
  }

  async function open(url = '/runs'): Promise<RouterTestingHarness> {
    actAs();
    const harness = await RouterTestingHarness.create(url);
    harness.detectChanges();
    return harness;
  }

  function respondToPlans(plans: readonly unknown[] = PLAN_LIST): void {
    httpClient().expectOne('/api/plans').flush(plans);
  }

  function expectHistoryRequest(): TestRequest {
    return httpClient().expectOne((request) => request.url === '/api/runs');
  }

  async function openLoaded(
    page: RunHistoryPage = historyPage([FAILED_ITEM]),
    url = '/runs',
  ): Promise<RouterTestingHarness> {
    const harness = await open(url);
    respondToPlans();
    expectHistoryRequest().flush(page);
    await settle(harness);
    return harness;
  }

  function typeInto(root: HTMLElement, selector: string, value: string): void {
    const input = root.querySelector<HTMLInputElement>(selector);
    if (input === null) {
      throw new Error(`Input not found: ${selector}`);
    }

    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function findButton(root: ParentNode, label: string): HTMLButtonElement | undefined {
    return Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.includes(label),
    );
  }

  it('renders summary rows with status text, UTC times, counters, and a details link', async () => {
    const harness = await openLoaded(historyPage([FAILED_ITEM]));
    const root = rootOf(harness);

    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Run History');
    expect(root.querySelectorAll('tbody tr')).toHaveLength(1);

    const row = root.querySelector('tbody tr');
    const badge = row?.querySelector('app-run-status-badge .status-badge');
    expect(badge?.textContent).toContain('Failed');
    expect(badge?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(row?.textContent).toContain('Power rail verification');
    expect(row?.textContent).toContain('Version 3');
    expect(row?.textContent).toContain('Normal');
    expect(row?.textContent).toContain('Seed 42');
    expect(row?.textContent).toContain('UTC');
    expect(row?.textContent).toContain('4 of 4');
    expect(root.textContent).toContain('First failure');
    expect(root.textContent).toContain('Step 2: Current draw');
    expect(root.textContent).toContain('Sample index 1');
    expect(
      row?.querySelector<HTMLAnchorElement>(`a[href="/runs/${RUN_ID}"]`)?.textContent,
    ).toContain('View details');
    expect(root.textContent).toContain('Showing 1-1 of 1 runs');

    const tableRegion = root.querySelector('#run-history-table');
    expect(tableRegion?.getAttribute('role')).toBe('region');
    expect(tableRegion?.getAttribute('tabindex')).toBe('0');
    expect(tableRegion?.getAttribute('aria-describedby')).toBe('run-history-table-hint');
    expect(root.querySelector('#run-history-table-hint')?.textContent).toContain(
      'Scroll horizontally',
    );

    // The list is built from summary counters; no measurement table or detail
    // request is loaded by this screen.
    expect(root.textContent).not.toContain('Recorded measurements');
    expect(
      httpClient().match((request) => request.url.startsWith(`/api/runs/${RUN_ID}`)),
    ).toHaveLength(0);
    expect(root.querySelector('app-run-history-page a[href="/compare"]')).toBeNull();
  });

  it('restores every filter and the page number from the URL and maps dates to UTC boundaries', async () => {
    const harness = await open(
      `/runs?planId=${PLAN_ID}&status=COMPLETED&outcome=FAILED&from=2026-11-01&to=2026-11-03&page=2`,
    );
    respondToPlans();

    const request = expectHistoryRequest();
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('planId')).toBe(PLAN_ID);
    expect(request.request.params.get('status')).toBe('COMPLETED');
    expect(request.request.params.get('outcome')).toBe('FAILED');
    expect(request.request.params.get('from')).toBe('2026-11-01T00:00:00.000Z');
    expect(request.request.params.get('to')).toBe('2026-11-03T00:00:00.000Z');
    expect(request.request.params.get('page')).toBe('2');
    expect(request.request.params.get('limit')).toBe('20');

    request.flush(
      historyPage([historyItem(), historyItem({ id: RUN_2_ID })], {
        page: 2,
        total: 43,
        totalPages: 3,
      }),
    );
    await settle(harness);

    const root = rootOf(harness);
    expect(materialSelect(root, '#history-plan').value).toBe(PLAN_ID);
    expect(materialSelect(root, '#history-status').value).toBe('COMPLETED');
    expect(materialSelect(root, '#history-outcome').value).toBe('FAILED');
    expect(root.querySelector<HTMLInputElement>('#history-from')?.value).toBe('2026-11-01');
    expect(root.querySelector<HTMLInputElement>('#history-to')?.value).toBe('2026-11-03');
    expect(root.textContent).toContain('Showing 21-22 of 43 runs');
    expect(root.textContent).toContain('Page 2 of 3');
    expect(TestBed.inject(Router).url).toContain('page=2');
  });

  it('writes a filter change to the URL, resets the page to one, and sends the new query', async () => {
    const harness = await openLoaded(
      historyPage([historyItem()], { page: 2, total: 43, totalPages: 3 }),
      '/runs?page=2',
    );
    const root = rootOf(harness);

    expect(TestBed.inject(Router).url).toBe('/runs?page=2');

    selectValue(root, '#history-status', 'ERROR');
    await settle(harness);

    const router = TestBed.inject(Router);
    expect(router.url).toBe('/runs?status=ERROR');
    const request = expectHistoryRequest();
    expect(request.request.params.get('status')).toBe('ERROR');
    expect(request.request.params.get('page')).toBe('1');
    expect(request.request.params.get('planId')).toBeNull();

    request.flush(historyPage([historyItem({ status: 'ERROR', outcome: null, finishedAt: null })]));
    await settle(harness);

    expect(root.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(root.querySelector('nav.pagination')).toBeNull();
  });

  it('maps a date filter to a page-one request and keeps it in the URL', async () => {
    const harness = await openLoaded(historyPage([historyItem()]));
    const root = rootOf(harness);

    typeInto(root, '#history-from', '2026-11-01');
    await settle(harness);

    expect(TestBed.inject(Router).url).toBe('/runs?from=2026-11-01');
    const first = expectHistoryRequest();
    expect(first.request.params.get('from')).toBe('2026-11-01T00:00:00.000Z');
    expect(first.request.params.get('page')).toBe('1');
    first.flush(historyPage([historyItem()]));
    await settle(harness);

    typeInto(root, '#history-to', '2026-11-04');
    await settle(harness);

    expect(TestBed.inject(Router).url).toBe('/runs?from=2026-11-01&to=2026-11-04');
    const second = expectHistoryRequest();
    expect(second.request.params.get('to')).toBe('2026-11-04T00:00:00.000Z');
    second.flush(historyPage([historyItem()]));
    await settle(harness);

    expect(root.querySelector<HTMLInputElement>('#history-from')?.value).toBe('2026-11-01');
    expect(root.querySelector<HTMLInputElement>('#history-to')?.value).toBe('2026-11-04');
  });

  it('keeps a newer filter result when an older response arrives late', async () => {
    const harness = await openLoaded(historyPage([historyItem()]));
    const root = rootOf(harness);

    await harness.navigateByUrl('/runs?status=CANCELLED');
    harness.detectChanges();
    const cancelledRequest = expectHistoryRequest();
    expect(cancelledRequest.request.params.get('status')).toBe('CANCELLED');

    await harness.navigateByUrl('/runs?status=ERROR');
    harness.detectChanges();
    const errorRequest = expectHistoryRequest();
    expect(errorRequest.request.params.get('status')).toBe('ERROR');

    errorRequest.flush(
      historyPage([historyItem({ id: RUN_3_ID, status: 'ERROR', outcome: null })]),
    );
    await settle(harness);
    expect(root.querySelector('tbody')?.textContent).toContain('Error');
    expect(root.querySelector('tbody')?.textContent).toContain('Power rail verification');

    cancelledRequest.flush(
      historyPage([
        { ...FAILED_ITEM, planName: 'Stale cancelled plan', status: 'CANCELLED', outcome: null },
      ]),
    );
    await settle(harness);

    const tableText = root.querySelector('tbody')?.textContent ?? '';
    expect(tableText).toContain('Error');
    expect(tableText).not.toContain('Stale cancelled plan');
    expect(tableText).not.toContain('Cancelled');
  });

  it('shows a distinct loading state, empty state, and error state with retry', async () => {
    const harness = await open();
    const root = rootOf(harness);

    expect(root.textContent).toContain('Loading run history…');
    expect(root.querySelector('table')).toBeNull();

    respondToPlans();
    expectHistoryRequest().flush(historyPage([]));
    await settle(harness);

    expect(root.textContent).toContain('No runs recorded yet');
    expect(root.querySelector('table')).toBeNull();

    await harness.navigateByUrl('/runs?status=ERROR');
    const filtered = expectHistoryRequest();
    filtered.flush(historyPage([]));
    await settle(harness);

    expect(root.textContent).toContain('No runs match these filters');
    expect(root.querySelector('#clear-history-filters')).not.toBeNull();

    root.querySelector<HTMLButtonElement>('#clear-history-filters')?.click();
    await settle(harness);

    expect(TestBed.inject(Router).url).toBe('/runs');
    const cleared = expectHistoryRequest();
    expect(cleared.request.params.get('status')).toBeNull();
    cleared.flush(historyPage([historyItem()]));
    await settle(harness);

    expect(root.querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('recovers from a server error with a retry of the same query', async () => {
    const harness = await open('/runs?status=ERROR');
    const root = rootOf(harness);

    expect(TestBed.inject(Router).url).toBe('/runs?status=ERROR');
    respondToPlans();
    const initial = expectHistoryRequest();
    expect(initial.request.params.get('status')).toBe('ERROR');
    initial.flush(
      {
        code: 'SERVICE_UNAVAILABLE',
        message: 'The run history service is unavailable.',
        requestId: 'req-history-503',
      },
      { status: 503, statusText: 'Service Unavailable' },
    );
    await settle(harness);

    expect(root.textContent).toContain('The run history could not be loaded');
    expect(root.textContent).toContain('The run history service is unavailable.');
    expect(root.textContent).toContain('req-history-503');

    findButton(root, 'Try again')?.click();
    harness.detectChanges();

    const retry = expectHistoryRequest();
    expect(retry.request.params.get('status')).toBe('ERROR');
    expect(retry.request.params.get('page')).toBe('1');
    retry.flush(historyPage([historyItem({ status: 'ERROR', outcome: null })]));
    await settle(harness);

    expect(root.querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('shows a dedicated session-expired state on 401', async () => {
    const harness = await open();
    const root = rootOf(harness);

    respondToPlans();
    expectHistoryRequest().flush(
      {
        code: 'UNAUTHENTICATED',
        message: 'The session has expired.',
        requestId: 'req-history-401',
      },
      { status: 401, statusText: 'Unauthorized' },
    );
    await settle(harness);

    expect(root.textContent).toContain('Your session has expired');
    expect(root.textContent).toContain('req-history-401');
    expect(root.querySelector<HTMLAnchorElement>('a[href="/login"]')?.textContent).toContain(
      'Sign in again',
    );
    expect(root.querySelector('table')).toBeNull();
    expect(root.querySelector('.status-badge')).toBeNull();
  });

  it('pages forward and back with the page number in the URL', async () => {
    const harness = await openLoaded(historyPage([historyItem()], { total: 21, totalPages: 2 }));
    const root = rootOf(harness);

    findButton(root, 'Next page')?.click();
    await settle(harness);

    expect(TestBed.inject(Router).url).toBe('/runs?page=2');
    const next = expectHistoryRequest();
    expect(next.request.params.get('page')).toBe('2');
    next.flush(historyPage([historyItem({ id: RUN_2_ID })], { page: 2, total: 21, totalPages: 2 }));
    await settle(harness);
    expect(root.textContent).toContain('Page 2 of 2');

    findButton(root, 'Previous page')?.click();
    await settle(harness);

    expect(TestBed.inject(Router).url).toBe('/runs');
    const previous = expectHistoryRequest();
    expect(previous.request.params.get('page')).toBe('1');
    previous.flush(historyPage([historyItem()], { total: 21, totalPages: 2 }));
    await settle(harness);
    expect(root.textContent).toContain('Page 1 of 2');
  });

  it('shows an out-of-range state instead of the empty history state', async () => {
    const harness = await openLoaded(
      historyPage([], { page: 999, total: 36, totalPages: 2 }),
      '/runs?page=999',
    );
    const root = rootOf(harness);

    expect(root.textContent).toContain('This page is out of range');
    expect(root.textContent).not.toContain('No runs recorded yet');
    expect(root.textContent).not.toContain('No runs match these filters');
    expect(root.textContent).toContain('36 runs');
    expect(root.textContent).toContain('2 pages');
    expect(root.textContent).toContain('page 999');
    expect(root.querySelector('table')).toBeNull();

    findButton(root, 'Go to first page')?.click();
    await settle(harness);

    expect(TestBed.inject(Router).url).toBe('/runs');
    const firstPage = expectHistoryRequest();
    expect(firstPage.request.params.get('page')).toBe('1');
    firstPage.flush(historyPage([historyItem()]));
    await settle(harness);

    expect(root.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(root.textContent).toContain('Showing 1-1 of 1 runs');
  });

  it('keeps filters when moving from an out-of-range page to the last valid page', async () => {
    const harness = await openLoaded(
      historyPage([], { page: 9, total: 36, totalPages: 2 }),
      '/runs?status=COMPLETED&page=9',
    );
    const root = rootOf(harness);

    findButton(root, 'Go to last page')?.click();
    await settle(harness);

    expect(TestBed.inject(Router).url).toBe('/runs?status=COMPLETED&page=2');
    const lastPage = expectHistoryRequest();
    expect(lastPage.request.params.get('status')).toBe('COMPLETED');
    expect(lastPage.request.params.get('page')).toBe('2');
    lastPage.flush(historyPage([historyItem()], { page: 2, total: 36, totalPages: 2 }));
    await settle(harness);

    expect(root.textContent).toContain('Page 2 of 2');
    expect(materialSelect(root, '#history-status')).toHaveProperty('value', 'COMPLETED');
  });

  it('moves focus to the results heading after page navigation', async () => {
    const harness = await openLoaded(historyPage([historyItem()], { total: 21, totalPages: 2 }));
    const root = rootOf(harness);

    const next = findButton(root, 'Next page');
    next?.focus();
    next?.click();
    await settle(harness);

    expect(TestBed.inject(Router).url).toBe('/runs?page=2');
    expectHistoryRequest().flush(
      historyPage([historyItem({ id: RUN_2_ID })], {
        page: 2,
        total: 21,
        totalPages: 2,
      }),
    );
    await settle(harness);

    const heading = root.querySelector<HTMLElement>('#history-results-heading');
    expect(heading?.textContent).toContain('Recorded runs');
    expect(document.activeElement).toBe(heading);
  });

  it('does not label a cancelled run with all samples as Partial', async () => {
    const harness = await openLoaded(
      historyPage([
        historyItem({
          status: 'CANCELLED',
          outcome: null,
          recordedSampleCount: 1,
          expectedSampleCount: 1,
          partial: true,
        }),
      ]),
    );
    const row = rootOf(harness).querySelector('tbody tr');

    expect(row?.textContent).toContain('Cancelled');
    expect(row?.textContent).toContain('1 of 1');
    expect(row?.textContent).not.toContain('Partial');
    expect(row?.textContent).toContain('All samples recorded; stopped');
  });

  it('labels a stopped run with missing samples as Partial', async () => {
    const harness = await openLoaded(
      historyPage([
        historyItem({
          status: 'INTERRUPTED',
          outcome: null,
          recordedSampleCount: 1,
          expectedSampleCount: 4,
          partial: true,
        }),
      ]),
    );
    const row = rootOf(harness).querySelector('tbody tr');

    expect(row?.textContent).toContain('Interrupted');
    expect(row?.textContent).toContain('1 of 4');
    expect(row?.textContent).toContain('Partial');
    expect(row?.textContent).not.toContain('All samples recorded; stopped');
  });

  it('disambiguates filter options when two plans share a name', async () => {
    const duplicateA = {
      ...PLAN_LIST[0],
      latestPublishedVersion: {
        id: VERSION_ID,
        versionNumber: 2,
        publishedAt: '2026-11-01T10:00:00.000Z',
      },
    };
    const duplicateB = {
      ...PLAN_LIST[0],
      id: OTHER_PLAN_ID,
      latestPublishedVersion: {
        id: RUN_ID,
        versionNumber: 7,
        publishedAt: '2026-11-02T10:00:00.000Z',
      },
    };
    const harness = await open();
    const root = rootOf(harness);

    respondToPlans([duplicateA, duplicateB]);
    expectHistoryRequest().flush(historyPage([historyItem()]));
    await settle(harness);

    const options = materialSelect(root, '#history-plan').options.toArray();
    expect(options).toHaveLength(3);
    expect(options[1]?.viewValue).toContain('Power rail verification');
    expect(options[1]?.viewValue).toContain('version 2');
    expect(options[1]?.viewValue).toContain(PLAN_ID.slice(0, 8));
    expect(options[2]?.viewValue).toContain('Power rail verification');
    expect(options[2]?.viewValue).toContain('version 7');
    expect(options[2]?.viewValue).toContain(OTHER_PLAN_ID.slice(0, 8));
    expect(options[1]?.viewValue).not.toBe(options[2]?.viewValue);

    expect(root.querySelector('tbody td.plan-cell .cell-detail')?.textContent).toContain(
      PLAN_ID.slice(0, 8),
    );
  });

  it('warns about invalid URL filters, ignores them, and removes them', async () => {
    const harness = await open('/runs?status=BOGUS&page=abc&from=notadate');
    const root = rootOf(harness);

    respondToPlans();
    const request = expectHistoryRequest();
    expect(request.request.params.get('status')).toBeNull();
    expect(request.request.params.get('page')).toBe('1');
    expect(request.request.params.get('from')).toBeNull();
    request.flush(historyPage([historyItem()]));
    await settle(harness);

    expect(root.textContent).toContain('filter values that cannot be used');
    expect(root.textContent).toContain('Status "BOGUS"');
    expect(root.textContent).toContain('Page "abc"');
    expect(root.textContent).toContain('From date "notadate"');
    expect(materialSelect(root, '#history-status').value).toBe('');
    expect(root.querySelector<HTMLInputElement>('#history-from')?.value).toBe('');

    findButton(root, 'Remove invalid filters')?.click();
    await settle(harness);

    expect(TestBed.inject(Router).url).toBe('/runs');
    const cleaned = expectHistoryRequest();
    expect(cleaned.request.params.get('status')).toBeNull();
    expect(cleaned.request.params.get('page')).toBe('1');
    expect(cleaned.request.params.get('from')).toBeNull();
    cleaned.flush(historyPage([historyItem()]));
    await settle(harness);

    expect(root.textContent).not.toContain('filter values that cannot be used');
  });

  it('keeps valid URL filters when removing only the invalid values', async () => {
    const harness = await open('/runs?status=COMPLETED&outcome=NOPE&from=notadate&page=abc');
    const root = rootOf(harness);

    respondToPlans();
    const request = expectHistoryRequest();
    expect(request.request.params.get('status')).toBe('COMPLETED');
    expect(request.request.params.get('outcome')).toBeNull();
    expect(request.request.params.get('from')).toBeNull();
    expect(request.request.params.get('page')).toBe('1');
    request.flush(historyPage([historyItem()]));
    await settle(harness);

    findButton(root, 'Remove invalid filters')?.click();
    await settle(harness);

    expect(TestBed.inject(Router).url).toBe('/runs?status=COMPLETED');
    const cleaned = expectHistoryRequest();
    expect(cleaned.request.params.get('status')).toBe('COMPLETED');
    expect(cleaned.request.params.get('outcome')).toBeNull();
    expect(cleaned.request.params.get('from')).toBeNull();
    cleaned.flush(historyPage([historyItem()]));
    await settle(harness);

    expect(materialSelect(root, '#history-status').value).toBe('COMPLETED');
  });

  it('labels Running, Cancelled, Interrupted, Error, Passed, and Failed distinctly', async () => {
    const harness = await openLoaded(
      historyPage([
        historyItem({ id: RUN_ID, status: 'RUNNING', outcome: null, finishedAt: null }),
        historyItem({ id: RUN_2_ID, status: 'CANCELLED', outcome: null }),
        historyItem({ id: RUN_3_ID, status: 'INTERRUPTED', outcome: null }),
        historyItem({ id: '88888888-8888-4888-8888-888888888888', status: 'ERROR', outcome: null }),
        historyItem({ id: '99999999-9999-4999-8999-999999999999' }),
        historyItem({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', outcome: 'FAILED' }),
      ]),
    );
    const root = rootOf(harness);
    const rows = Array.from(root.querySelectorAll('tbody tr'));

    expect(rows[0]?.textContent).toContain('Running');
    expect(rows[0]?.textContent).toContain('Still running');
    expect(rows[1]?.textContent).toContain('Cancelled');
    expect(rows[1]?.textContent).not.toContain('Passed');
    expect(rows[1]?.textContent).not.toContain('Failed');
    expect(rows[2]?.textContent).toContain('Interrupted');
    expect(rows[3]?.textContent).toContain('Error');
    expect(rows[4]?.textContent).toContain('Passed');
    expect(rows[5]?.textContent).toContain('Failed');
    expect(rows[1]?.querySelector('.status-badge svg')).not.toBeNull();
  });

  it('selects at most two terminal runs and explains the same-plan rule', async () => {
    const harness = await openLoaded(
      historyPage([
        historyItem({
          id: RUN_ID,
          status: 'CANCELLED',
          outcome: null,
          partial: true,
          recordedSampleCount: 1,
        }),
        historyItem({
          id: RUN_2_ID,
          status: 'INTERRUPTED',
          outcome: null,
          partial: true,
          recordedSampleCount: 2,
        }),
        historyItem({ id: RUN_3_ID }),
        historyItem({
          id: '88888888-8888-4888-8888-888888888888',
          planId: OTHER_PLAN_ID,
          planName: 'Thermal soak',
        }),
        historyItem({
          id: '99999999-9999-4999-8999-999999999999',
          status: 'RUNNING',
          outcome: null,
          finishedAt: null,
        }),
      ]),
    );
    const root = rootOf(harness);
    const checkboxes = Array.from(
      root.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]'),
    );

    expect(root.textContent).toContain('Partial');
    expect(root.textContent).toContain('Select up to two terminal runs');
    expect(checkboxes).toHaveLength(5);
    expect(checkboxes[4]?.disabled).toBe(true);
    expect(checkboxes[4]?.getAttribute('aria-label')).toContain('still running');

    checkboxes[0]?.click();
    harness.detectChanges();
    checkboxes[1]?.click();
    harness.detectChanges();

    expect(checkboxes[0]?.checked).toBe(true);
    expect(checkboxes[1]?.checked).toBe(true);
    expect(checkboxes[2]?.disabled).toBe(true);
    expect(root.textContent).toContain('2 of 2 selected');
    expect(root.querySelector<HTMLButtonElement>('#compare-selected-runs')?.disabled).toBe(false);
    expect(root.querySelector<HTMLButtonElement>('#compare-selected-runs')?.textContent).toContain(
      'Compare',
    );

    checkboxes[0]?.click();
    harness.detectChanges();
    expect(checkboxes[2]?.disabled).toBe(false);
    expect(root.querySelector<HTMLButtonElement>('#compare-selected-runs')?.disabled).toBe(true);
  });

  it('blocks a different-plan pair and does not navigate', async () => {
    const harness = await openLoaded(
      historyPage([
        historyItem({ id: RUN_ID }),
        historyItem({
          id: RUN_2_ID,
          planId: OTHER_PLAN_ID,
          planName: 'Thermal soak',
        }),
      ]),
    );
    const root = rootOf(harness);
    const checkboxes = Array.from(
      root.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]'),
    );

    checkboxes[0]?.click();
    checkboxes[1]?.click();
    harness.detectChanges();

    expect(root.querySelector<HTMLButtonElement>('#compare-selected-runs')?.disabled).toBe(true);
    expect(root.textContent).toContain('Choose two runs of the same plan');

    root.querySelector<HTMLButtonElement>('#compare-selected-runs')?.click();
    await settle(harness);

    expect(TestBed.inject(Router).url).toBe('/runs');
    expect(httpClient().match((request) => request.url === '/api/comparisons')).toHaveLength(0);
  });

  it('opens the comparison route with both selected run ids', async () => {
    const harness = await openLoaded(
      historyPage([historyItem({ id: RUN_ID }), historyItem({ id: RUN_2_ID })]),
    );
    const root = rootOf(harness);
    const checkboxes = Array.from(
      root.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]'),
    );

    checkboxes[0]?.click();
    checkboxes[1]?.click();
    harness.detectChanges();

    root.querySelector<HTMLButtonElement>('#compare-selected-runs')?.click();
    await settle(harness);

    expect(TestBed.inject(Router).url).toBe(`/compare?leftRunId=${RUN_ID}&rightRunId=${RUN_2_ID}`);

    const comparisonRequest = httpClient().expectOne(
      (request) => request.url === '/api/comparisons',
    );
    expect(comparisonRequest.request.params.get('leftRunId')).toBe(RUN_ID);
    expect(comparisonRequest.request.params.get('rightRunId')).toBe(RUN_2_ID);
    comparisonRequest.flush(
      {
        code: 'NOT_FOUND',
        message: 'One of the runs was not found.',
        requestId: 'req-history-compare-404',
      },
      { status: 404, statusText: 'Not Found' },
    );
    await settle(harness);

    expect(root.textContent).toContain('One of the runs was not found');
  });

  it('keeps the current plan filter when the plan list cannot be loaded', async () => {
    const harness = await open(`/runs?planId=${PLAN_ID}`);
    const root = rootOf(harness);

    httpClient().expectOne('/api/plans').flush(
      {
        code: 'SERVICE_UNAVAILABLE',
        message: 'The plan list is unavailable.',
        requestId: 'req-plans-503',
      },
      { status: 503, statusText: 'Service Unavailable' },
    );
    expectHistoryRequest().flush(historyPage([historyItem()]));
    await settle(harness);

    expect(root.textContent).toContain('Plan names could not be loaded');
    expect(materialSelect(root, '#history-plan').value).toBe(PLAN_ID);
    expect(root.querySelectorAll('tbody tr')).toHaveLength(1);
  });
});
