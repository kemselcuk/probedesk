import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../app.routes';
import { AuthSessionStore } from '../../core/auth/auth-session.store';
import { authInterceptor } from '../../core/auth/auth.interceptor';
import { MEASUREMENT_CHART_FACTORY } from '../../shared/charts/measurement-chart.factory';
import { FakeMeasurementChartFactory } from '../../shared/charts/testing/fake-measurement-chart';
import { RUN_ID, USER_ID } from '../runs/testing/run-fixtures';
import { ReportsApi } from './reports-api';
import { ReportFacade } from './report.facade';
import { RunExportActions } from './run-export-actions';
import { reportFixture } from './testing/report-fixture';
const REPORT = `/api/runs/${RUN_ID}/report`,
  EXPORT = `/api/runs/${RUN_ID}/export?format=csv`;
function http() {
  return TestBed.inject(HttpTestingController);
}
function auth() {
  TestBed.inject(AuthSessionStore).authenticate({
    id: USER_ID,
    role: 'VIEWER',
    email: 'viewer@example.test',
  });
}
describe('report API and facade', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), ReportFacade],
    }),
  );
  afterEach(() => http().verify());
  it.each(['COMPLETED', 'CANCELLED', 'INTERRUPTED', 'ERROR'] as const)(
    'reads %s without inventing metadata or decimal statistics',
    async (status) => {
      const promise = firstValueFrom(TestBed.inject(ReportsApi).report(RUN_ID));
      http().expectOne(REPORT).flush(reportFixture({ status }));
      const report = await promise;
      expect(report.deviceSnapshot).toBeNull();
      expect(report.steps[0].statistics.average).toBe('5.000000');
      expect(report).not.toHaveProperty('lastEventSequence');
      expect(report).not.toHaveProperty('id');
    },
  );
  it.each(['identity', 'schema', 'nullable', 'decimal', 'running'] as const)(
    'rejects malformed %s',
    async (kind) => {
      const promise = firstValueFrom(TestBed.inject(ReportsApi).report(RUN_ID));
      const body = reportFixture();
      if (kind === 'identity') body.runId = USER_ID;
      if (kind === 'schema') Object.assign(body, { schemaVersion: 2 });
      if (kind === 'nullable') Object.assign(body, { batchNumber: undefined });
      if (kind === 'decimal') body.steps[0].measurements[0].value = 'NaN';
      if (kind === 'running') body.status = 'RUNNING';
      http().expectOne(REPORT).flush(body);
      await expect(promise).rejects.toThrow();
    },
  );
  it('accepts an explicitly absent terminal finish time', async () => {
    const promise = firstValueFrom(TestBed.inject(ReportsApi).report(RUN_ID));
    http()
      .expectOne(REPORT)
      .flush(reportFixture({ finishedAt: null }));
    expect((await promise).finishedAt).toBeNull();
  });
  it.each(['expected', 'samples', 'interval', 'samplesMax', 'intervalMax'] as const)(
    'rejects report counters or rules outside the DTO limits: %s',
    async (kind) => {
      const promise = firstValueFrom(TestBed.inject(ReportsApi).report(RUN_ID));
      const report = reportFixture();
      if (kind === 'expected') report.expectedSampleCount = 0;
      if (kind === 'samples') report.steps[0].sampleCount = 0;
      if (kind === 'interval') report.steps[0].intervalMs = 0;
      if (kind === 'samplesMax') report.steps[0].sampleCount = 1001;
      if (kind === 'intervalMax') report.steps[0].intervalMs = 5001;
      http().expectOne(REPORT).flush(report);
      await expect(promise).rejects.toThrow('Invalid report response');
    },
  );
  it('cancels previous run data and ignores an old response after route selection changes', () => {
    const facade = TestBed.inject(ReportFacade);
    facade.load(RUN_ID);
    const old = http().expectOne(REPORT);
    facade.load(USER_ID);
    expect(old.cancelled).toBe(true);
    expect(facade.data()).toBeNull();
    http()
      .expectOne(`/api/runs/${USER_ID}/report`)
      .flush(reportFixture({ runId: USER_ID }));
    expect(facade.data()?.runId).toBe(USER_ID);
  });
});
describe('run downloads', () => {
  let createUrl: ReturnType<typeof vi.fn>, revokeUrl: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    createUrl = vi.fn(() => 'blob:test-download');
    revokeUrl = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeUrl });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    TestBed.configureTestingModule({
      imports: [RunExportActions],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });
  afterEach(() => {
    http().verify();
    vi.restoreAllMocks();
  });
  function open() {
    const fixture = TestBed.createComponent(RunExportActions);
    fixture.componentRef.setInput('runId', RUN_ID);
    fixture.detectChanges();
    return fixture;
  }
  it('blocks duplicates, names the file safely and revokes its object URL on destruction', () => {
    const fixture = open();
    const root = fixture.nativeElement as HTMLElement;
    const button = root.querySelector('button')!;
    button.click();
    button.click();
    fixture.detectChanges();
    expect(button.disabled).toBe(true);
    http()
      .expectOne(EXPORT)
      .flush(new Blob(['csv']), { headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(root.ownerDocument.querySelector('a[download]')).toBeNull();
    fixture.destroy();
    expect(revokeUrl).toHaveBeenCalledWith('blob:test-download');
  });
  it('parses JSON blob errors and preserves the real request ID for retry', async () => {
    const fixture = open();
    const root = fixture.nativeElement as HTMLElement;
    root.querySelector('button')!.click();
    http()
      .expectOne(EXPORT)
      .flush(
        new Blob(
          [
            JSON.stringify({
              code: 'RUN_NOT_TERMINAL',
              message: 'Run is still running.',
              requestId: 'req-export',
            }),
          ],
          { type: 'application/json' },
        ),
        { status: 409, statusText: 'Conflict' },
      );
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.textContent).toContain('req-export');
    expect(root.textContent).toContain('Run is still running.');
    expect(createUrl).not.toHaveBeenCalled();
    expect(root.querySelector('button')!.disabled).toBe(false);
  });
  it('rejects an HTML response rather than downloading a login page', async () => {
    const fixture = open();
    const root = fixture.nativeElement as HTMLElement;
    root.querySelector('button')!.click();
    http()
      .expectOne(EXPORT)
      .flush(new Blob(['<html>']), { headers: { 'Content-Type': 'text/html' } });
    fixture.detectChanges();
    expect(root.textContent).toContain('Unexpected download content');
    expect(createUrl).not.toHaveBeenCalled();
  });
  it('cancels pending downloads when the component is destroyed', () => {
    const fixture = open();
    (fixture.nativeElement as HTMLElement).querySelector('button')!.click();
    const request = http().expectOne(EXPORT);
    fixture.destroy();
    expect(request.cancelled).toBe(true);
  });
});
describe('download authentication', () => {
  it('expires the session and preserves the report return URL on a blob 401', async () => {
    const navigate = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: Router, useValue: { url: `/runs/${RUN_ID}/report`, navigate } },
      ],
    });
    auth();
    const promise = firstValueFrom(TestBed.inject(ReportsApi).export(RUN_ID, 'csv'));
    http()
      .expectOne(EXPORT)
      .flush(new Blob(['{}']), { status: 401, statusText: 'Unauthorized' });
    await expect(promise).rejects.toThrow();
    expect(TestBed.inject(AuthSessionStore).status()).toBe('anonymous');
    expect(navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: `/runs/${RUN_ID}/report`, reason: 'session-expired' },
    });
    http().verify();
  });
});
describe('report page and native print', () => {
  let charts: FakeMeasurementChartFactory;
  let print: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    charts = new FakeMeasurementChartFactory();
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,dGVzdA==',
    );
    Object.defineProperty(HTMLImageElement.prototype, 'decode', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });
    print = vi.spyOn(window, 'print').mockImplementation(() => {});
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter(routes),
        { provide: MEASUREMENT_CHART_FACTORY, useValue: charts },
      ],
    });
  });
  afterEach(() => {
    http().verify();
    vi.restoreAllMocks();
  });
  async function open() {
    auth();
    return RouterTestingHarness.create(`/runs/${RUN_ID}/report`);
  }
  function printButton(root: HTMLElement) {
    return [...root.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Print / Save PDF'),
    )!;
  }
  it('opens directly for a viewer and prints decoded chart snapshots with recorded rules', async () => {
    const harness = await open();
    http().expectOne(REPORT).flush(reportFixture());
    await harness.fixture.whenStable();
    harness.detectChanges();
    const root = harness.fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('No device recorded');
    expect(root.textContent).toContain('No batch recorded');
    expect(root.textContent).toContain('4.750000');
    expect(root.querySelectorAll('app-report-chart')).toHaveLength(1);
    expect(root.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(printButton(root).disabled).toBe(false);
    printButton(root).click();
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(print).toHaveBeenCalledOnce();
    expect(root.querySelector('app-report-chart img')).not.toBeNull();
    expect(root.querySelector('.print-warning')).toBeNull();
    window.dispatchEvent(new Event('beforeprint'));
    expect(charts.created[0].resizeCalls).toBe(1);
    harness.fixture.destroy();
    expect(charts.created[0].destroyCalls).toBe(1);
    expect(document.body.classList.contains('pd-print-report')).toBe(false);
  });
  it('does not print a stale report if navigation occurs while images decode', async () => {
    let resolveDecode: (() => void) | undefined;
    Object.defineProperty(HTMLImageElement.prototype, 'decode', {
      configurable: true,
      value: () =>
        new Promise<void>((resolve) => {
          resolveDecode = resolve;
        }),
    });
    const harness = await open();
    http().expectOne(REPORT).flush(reportFixture());
    await harness.fixture.whenStable();
    harness.detectChanges();
    const root = harness.fixture.nativeElement as HTMLElement;
    printButton(root).click();
    await harness.navigateByUrl(`/runs/${USER_ID}/report`);
    const next = http().expectOne(`/api/runs/${USER_ID}/report`);
    resolveDecode!();
    await harness.fixture.whenStable();
    expect(print).not.toHaveBeenCalled();
    next.flush(reportFixture({ runId: USER_ID }));
  });
  it('ignores a rejected old decode without disabling or changing a new report print operation', async () => {
    let rejectOld: ((error: Error) => void) | undefined, resolveNew: (() => void) | undefined;
    let calls = 0;
    Object.defineProperty(HTMLImageElement.prototype, 'decode', {
      configurable: true,
      value: () =>
        ++calls === 1
          ? new Promise<void>((_resolve, reject) => {
              rejectOld = reject;
            })
          : new Promise<void>((resolve) => {
              resolveNew = resolve;
            }),
    });
    const harness = await open();
    http().expectOne(REPORT).flush(reportFixture());
    await harness.fixture.whenStable();
    harness.detectChanges();
    const root = harness.fixture.nativeElement as HTMLElement;
    printButton(root).click();
    await harness.navigateByUrl(`/runs/${USER_ID}/report`);
    http()
      .expectOne(`/api/runs/${USER_ID}/report`)
      .flush(reportFixture({ runId: USER_ID }));
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(printButton(root).disabled).toBe(false);
    printButton(root).click();
    harness.detectChanges();
    rejectOld!(Error('Old image failed'));
    await Promise.resolve();
    await Promise.resolve();
    harness.detectChanges();
    expect(
      [...root.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Preparing print'),
      )?.disabled,
    ).toBe(true);
    expect(root.textContent).not.toContain('Charts could not be prepared');
    expect(calls).toBe(2);
    resolveNew!();
    await Promise.resolve();
    await Promise.resolve();
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(print).toHaveBeenCalledOnce();
  });
  it.each(['CANCELLED', 'INTERRUPTED', 'ERROR'] as const)(
    'accurately labels a fully recorded %s run without inventing missing samples',
    async (status) => {
      const harness = await open();
      http()
        .expectOne(REPORT)
        .flush(reportFixture({ status, outcome: null, finishedAt: null }));
      await harness.fixture.whenStable();
      harness.detectChanges();
      const text = (harness.fixture.nativeElement as HTMLElement).textContent;
      expect(text).toContain('All expected samples were recorded');
      expect(text).not.toContain('Partial result:');
      expect(text).toContain('A completed verdict is not inferred');
      expect(text).toContain('Not recorded');
    },
  );
  it('blocks printing after a canvas capture failure and preserves the text report', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => {
      throw Error('Canvas error');
    });
    const harness = await open();
    http().expectOne(REPORT).flush(reportFixture());
    await harness.fixture.whenStable();
    harness.detectChanges();
    const root = harness.fixture.nativeElement as HTMLElement;
    printButton(root).click();
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(print).not.toHaveBeenCalled();
    expect(printButton(root).disabled).toBe(true);
    expect(root.textContent).toContain('Recorded minimum');
    expect(root.textContent).toContain('Printing is unavailable');
  });
  it('keeps partial and absent statistics explicit, without fabricating success', async () => {
    const harness = await open();
    const report = reportFixture({ status: 'INTERRUPTED', outcome: null, recordedSampleCount: 0 });
    report.steps[0] = {
      ...report.steps[0],
      status: 'INTERRUPTED',
      outcome: null,
      recordedCount: 0,
      measurements: [],
      statistics: { minimum: null, maximum: null, average: null, sampleCount: null },
    };
    http().expectOne(REPORT).flush(report);
    await harness.fixture.whenStable();
    harness.detectChanges();
    const text = (harness.fixture.nativeElement as HTMLElement).textContent;
    expect(text).toContain('Partial result: INTERRUPTED');
    expect(text).toContain('Not available');
    expect(text).toContain('No samples recorded');
  });
  it('explains a running conflict and retries once requested', async () => {
    const harness = await open();
    http()
      .expectOne(REPORT)
      .flush(
        { code: 'RUN_NOT_TERMINAL', message: 'Not terminal.', requestId: 'req-report' },
        { status: 409, statusText: 'Conflict' },
      );
    await harness.fixture.whenStable();
    harness.detectChanges();
    const root = harness.fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('This run is still running');
    expect(root.textContent).toContain('req-report');
    root.querySelector<HTMLButtonElement>('app-error-state button')!.click();
    http().expectOne(REPORT).flush(reportFixture());
  });
});
