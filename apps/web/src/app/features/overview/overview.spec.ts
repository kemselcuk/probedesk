import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../app.routes';
import { AuthSessionStore } from '../../core/auth/auth-session.store';
import type { Role } from '../../core/auth/auth.types';
import { AnalyticsApi, type OverviewQuery } from './analytics-api';
import { OverviewFacade } from './overview.facade';
import { OverviewTrend, OVERVIEW_CHART_FACTORY } from './overview-trend';
import { defaultOverviewQuery, historyDayParams, historyParams } from './overview-links';
import { overviewFixture, PLAN_ID, VERSION_ID } from './testing/overview-fixtures';

const QUERY: OverviewQuery = { from: '2026-11-01T12:30:00.000Z', to: '2026-11-03T15:45:00.000Z' };
const destroy = vi.fn(),
  update = vi.fn();
const create = vi.fn(() => ({ destroy, update }));
function analyticsRequest(): TestRequest {
  return TestBed.inject(HttpTestingController).expectOne(
    (request) => request.url === '/api/analytics/overview',
  );
}
function requestQuery(request: TestRequest): OverviewQuery {
  return { from: request.request.params.get('from')!, to: request.request.params.get('to')! };
}

describe('overview API and request state', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), OverviewFacade],
    }),
  );
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  it('keeps backend decimal strings and sends the exact filters', async () => {
    const query = { ...QUERY, planId: PLAN_ID, batchNumber: 'Lot-1', scenario: 'RANDOM' as const };
    const promise = firstValueFrom(TestBed.inject(AnalyticsApi).overview(query));
    const request = analyticsRequest();
    expect(request.request.params.get('batchNumber')).toBe('Lot-1');
    request.flush(overviewFixture(query));
    const result = await promise;
    expect(result.summary.passRatePercent).toBe('75.00');
    expect(result.summary.averageDurationMs).toBe('1000.125');
    expect(result.filters.batchNumber).toBe('LOT-1');
  });
  it.each(['missing', 'number', 'echo', 'gap'] as const)(
    'rejects a malformed %s response rather than inventing values',
    async (kind) => {
      const promise = firstValueFrom(TestBed.inject(AnalyticsApi).overview(QUERY));
      const body: Record<string, unknown> = { ...overviewFixture(QUERY) };
      if (kind === 'missing')
        body['summary'] = { ...overviewFixture(QUERY).summary, passRatePercent: undefined };
      if (kind === 'number')
        body['summary'] = { ...overviewFixture(QUERY).summary, passRatePercent: 75 };
      if (kind === 'echo')
        body['filters'] = { ...overviewFixture(QUERY).filters, deviceId: PLAN_ID };
      if (kind === 'gap') body['trend'] = overviewFixture(QUERY).trend.slice(1);
      analyticsRequest().flush(body);
      await expect(promise).rejects.toThrow('invalid analytics response');
    },
  );
  it('cancels an older selection and clears in-flight results on an invalid URL', () => {
    const facade = TestBed.inject(OverviewFacade);
    facade.load(QUERY);
    const old = analyticsRequest();
    const next = { ...QUERY, scenario: 'NORMAL' as const };
    facade.load(next);
    expect(old.cancelled).toBe(true);
    analyticsRequest().flush(overviewFixture(next));
    expect(facade.data()?.filters.scenario).toBe('NORMAL');
    facade.load(QUERY);
    const pending = analyticsRequest();
    facade.clear();
    expect(pending.cancelled).toBe(true);
    expect(facade.data()).toBeNull();
    expect(facade.loading()).toBe(false);
  });
});

describe('overview date and history links', () => {
  it('defaults to 30 UTC calendar days including today', () =>
    expect(defaultOverviewQuery(new Date('2026-11-08T23:30:00-03:00'))).toEqual({
      from: '2026-10-11T00:00:00.000Z',
      to: '2026-11-10T00:00:00.000Z',
    }));
  it('intersects first and last day links with exact UTC boundaries', () => {
    const data = overviewFixture({ ...QUERY, deviceId: PLAN_ID, batchNumber: 'Lot-1' });
    expect(historyDayParams(data, '2026-11-01')).toMatchObject({
      from: QUERY.from,
      to: '2026-11-02T00:00:00.000Z',
      deviceId: PLAN_ID,
      batchNumber: 'LOT-1',
    });
    expect(historyDayParams(data, '2026-11-03')).toMatchObject({
      from: '2026-11-03T00:00:00.000Z',
      to: QUERY.to,
    });
    expect(
      historyParams(data, {
        planId: PLAN_ID,
        planVersionId: VERSION_ID,
        status: 'COMPLETED',
        outcome: 'FAILED',
      }),
    ).not.toHaveProperty('logicalStepId');
  });
});

describe('OverviewPage', () => {
  beforeEach(() => {
    create.mockClear();
    destroy.mockClear();
    update.mockClear();
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: vi.fn(),
    });
    return TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter(routes),
        { provide: OVERVIEW_CHART_FACTORY, useValue: create },
      ],
    });
  });
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  function auth(role: Role = 'VIEWER') {
    TestBed.inject(AuthSessionStore).authenticate({
      id: PLAN_ID,
      role,
      email: 'test@example.test',
    });
  }
  async function open(url = `/overview?from=${QUERY.from}&to=${QUERY.to}`, role: Role = 'VIEWER') {
    auth(role);
    const harness = await RouterTestingHarness.create(url);
    harness.detectChanges();
    TestBed.inject(HttpTestingController).expectOne('/api/plans').flush([]);
    return harness;
  }
  it.each(['PLANNER', 'OPERATOR', 'VIEWER'] as const)(
    'shows %s the backend KPIs and filtered history links',
    async (role) => {
      const harness = await open(undefined, role);
      analyticsRequest().flush(overviewFixture(QUERY));
      await harness.fixture.whenStable();
      harness.detectChanges();
      const root = harness.fixture.nativeElement as HTMLElement;
      expect(root.textContent).toContain('75.00%');
      expect(root.textContent).toContain('1000.125');
      expect(root.textContent).toContain('Simulated test results');
      expect(root.querySelectorAll('.kpi')).toHaveLength(4);
      expect(root.querySelectorAll('mat-datepicker-toggle')).toHaveLength(2);
      expect(
        root
          .querySelector('a[aria-label="View failed completed runs in this selection"]')
          ?.getAttribute('href'),
      ).toContain('outcome=FAILED');
      expect(root.querySelector('.top-table a')?.getAttribute('href')).toContain(
        `planVersionId=${VERSION_ID}`,
      );
    },
  );
  it('shows null KPIs as unavailable and never draws a fake success chart', async () => {
    const harness = await open();
    analyticsRequest().flush(overviewFixture(QUERY, true));
    await harness.fixture.whenStable();
    harness.detectChanges();
    const root = harness.fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('No completed results');
    expect(root.textContent).toContain('No completed durations');
    expect(root.textContent).toContain('No runs in this selection');
    expect(root.querySelector('app-overview-trend')).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
  it('makes default dates explicit on the root route', async () => {
    const harness = await open('/');
    await harness.fixture.whenStable();
    harness.detectChanges();
    const request = analyticsRequest();
    const query = requestQuery(request);
    expect(Date.parse(query.to) - Date.parse(query.from)).toBe(30 * 86_400_000);
    request.flush(overviewFixture(query, true));
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toContain('/overview?from=');
  });
  it.each([
    `/overview?from=${QUERY.to}&to=${QUERY.from}`,
    `/overview?from=${QUERY.from}&to=${QUERY.to}&scenario=NORMAL&scenario=RANDOM`,
  ])('does not query analytics for an invalid URL %s', async (url) => {
    await open(url);
    TestBed.inject(HttpTestingController).expectNone(
      (request) => request.url === '/api/analytics/overview',
    );
  });
  it('preserves exact timestamp boundaries when applying a batch filter', async () => {
    const harness = await open();
    analyticsRequest().flush(overviewFixture(QUERY));
    await harness.fixture.whenStable();
    harness.detectChanges();
    const root = harness.fixture.nativeElement as HTMLElement;
    const batch = root.querySelector<HTMLInputElement>('#overview-batch')!;
    batch.value = 'Lot-2';
    batch.dispatchEvent(new Event('input'));
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await harness.fixture.whenStable();
    const request = analyticsRequest();
    expect(requestQuery(request)).toEqual(QUERY);
    expect(request.request.params.get('batchNumber')).toBe('Lot-2');
    request.flush(overviewFixture({ ...QUERY, batchNumber: 'Lot-2' }));
  });
  it('retries the applied query on an error, and destroys a chart on refresh', async () => {
    const harness = await open();
    analyticsRequest().flush(
      { code: 'SERVER_ERROR', message: 'Temporarily unavailable.', requestId: 'req-overview' },
      { status: 500, statusText: 'Error' },
    );
    await harness.fixture.whenStable();
    harness.detectChanges();
    const root = harness.fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('req-overview');
    root.querySelector<HTMLButtonElement>('app-error-state button')?.click();
    analyticsRequest().flush(overviewFixture(QUERY));
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(create).toHaveBeenCalledTimes(1);
    [...root.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === 'Refresh')
      ?.click();
    harness.detectChanges();
    expect(destroy).toHaveBeenCalledTimes(1);
    analyticsRequest().flush(overviewFixture(QUERY, true));
  });
});

describe('OverviewTrend lifecycle', () => {
  beforeEach(() => {
    create.mockClear();
    destroy.mockClear();
    update.mockClear();
    return TestBed.configureTestingModule({
      imports: [OverviewTrend],
      providers: [{ provide: OVERVIEW_CHART_FACTORY, useValue: create }],
    });
  });
  it('announces chart failure and directs users to the daily table', async () => {
    create.mockImplementationOnce(() => {
      throw Error('Canvas unavailable');
    });
    const fixture = TestBed.createComponent(OverviewTrend);
    fixture.componentRef.setInput('days', overviewFixture(QUERY).trend);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[role="status"]')?.textContent,
    ).toContain('daily results table');
    fixture.destroy();
    expect(destroy).not.toHaveBeenCalled();
  });
  it('updates the existing chart and destroys it with its host', async () => {
    const fixture = TestBed.createComponent(OverviewTrend);
    fixture.componentRef.setInput('days', overviewFixture(QUERY).trend);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(create).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('days', overviewFixture(QUERY, true).trend);
    fixture.detectChanges();
    expect(update).toHaveBeenCalled();
    fixture.destroy();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
