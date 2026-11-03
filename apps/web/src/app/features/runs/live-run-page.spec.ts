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
import {
  RUN_EVENT_RECONNECT_DELAYS,
  RUN_EVENT_SOURCE_FACTORY,
} from '../../core/runs/run-events.service';
import {
  FakeEventSource,
  eventData,
} from '../../core/runs/testing/fake-event-source';
import type { RunEventEnvelope } from '../../core/runs/run-event.types';
import { AppTitleStrategy } from '../../core/title/app-title.strategy';
import {
  RUN_ID,
  completedEvent,
  measurementEvent,
  runSnapshot,
  runningStep,
  USER_ID,
} from './testing/run-fixtures';

const MEASUREMENT = {
  sampleIndex: 0,
  value: '5.500000',
  isWithinTolerance: false,
  recordedAt: '2026-11-03T10:00:01.000Z',
  elapsedMs: 500,
};

describe('LiveRunPage', () => {
  beforeEach(async () => {
    FakeEventSource.reset();
    await TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter(routes, withDisabledInitialNavigation()),
        { provide: TitleStrategy, useClass: AppTitleStrategy },
        { provide: RUN_EVENT_RECONNECT_DELAYS, useValue: [0, 0] },
        {
          provide: RUN_EVENT_SOURCE_FACTORY,
          useValue: (url: string) =>
            new FakeEventSource(url) as unknown as EventSource,
        },
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

  async function open(
    role: Role = 'VIEWER',
    snapshot = runSnapshot(),
  ): Promise<RouterTestingHarness> {
    actAs(role);
    const harness = await RouterTestingHarness.create(`/runs/${RUN_ID}/live`);
    TestBed.inject(HttpTestingController)
      .expectOne(`/api/runs/${RUN_ID}`)
      .flush(snapshot);
    await harness.fixture.whenStable();
    harness.detectChanges();
    return harness;
  }

  async function openWithStream(
    role: Role = 'VIEWER',
    snapshot = runSnapshot(),
  ): Promise<{ harness: RouterTestingHarness; source: FakeEventSource }> {
    const harness = await open(role, snapshot);
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.latest();
    source.open();
    harness.detectChanges();
    return { harness, source };
  }

  function rootOf(harness: RouterTestingHarness): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  function emit(source: FakeEventSource, event: RunEventEnvelope): void {
    source.emit(
      event.type,
      eventData(event.type, event.runId, event.sequence, event.payload),
      String(event.sequence),
    );
  }

  it('renders the plan, separate run and connection status, steps, and accessible samples', async () => {
    const { harness, source } = await openWithStream();

    emit(source, measurementEvent(4, 0, false));
    harness.detectChanges();

    const root = rootOf(harness);
    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Live Run');
    expect(root.textContent).toContain('Power rail verification');
    expect(root.textContent).toContain('Version 3');
    expect(root.querySelector('.status-badge')?.textContent).toContain('Running');
    expect(root.querySelector('[data-connection]')?.getAttribute('data-connection')).toBe(
      'connected',
    );
    expect(root.textContent).toContain('Connection: Connected');
    expect(root.textContent).toContain('Step 1: Output voltage');
    expect(root.textContent).toContain('1 of 4 samples recorded (25%)');
    expect(root.textContent).toContain('1 of 4');
    expect(root.textContent).toContain('Out-of-tolerance sample recorded.');

    const link = root.querySelector<HTMLAnchorElement>(
      `#live-run-details-link[href="/runs/${RUN_ID}"]`,
    );
    expect(link?.textContent).toContain('View run details');

    const table = root.querySelector<HTMLTableElement>('.measurements-section table');
    expect(table?.querySelector('caption')?.textContent).toContain(
      'Recent recorded measurements across all steps',
    );
    expect(table?.querySelectorAll('th[scope="col"]')).toHaveLength(7);
    expect(table?.querySelector('tbody tr')?.textContent).toContain('5.500000');
    expect(table?.querySelector('tbody tr')?.textContent).toContain('Outside tolerance');
  });

  it('marks the first violation immediately and never clears it after normal samples', async () => {
    const { harness, source } = await openWithStream();

    emit(source, measurementEvent(4, 0, false));
    harness.detectChanges();
    expect(rootOf(harness).querySelector('[data-first-violation]')?.textContent).toContain(
      'First failing sample: 0',
    );

    emit(source, measurementEvent(5, 1, true));
    harness.detectChanges();

    const marker = rootOf(harness).querySelector('[data-first-violation]');
    expect(marker).not.toBeNull();
    expect(marker?.textContent).toContain('First failing sample: 0');
    expect(rootOf(harness).textContent).toContain('2 of 4 samples recorded (50%)');
  });

  it('shows the reconnecting connection state without changing the run status', async () => {
    const { harness, source } = await openWithStream();

    source.fail(0);
    harness.detectChanges();

    expect(
      rootOf(harness).querySelector('[data-connection]')?.getAttribute('data-connection'),
    ).toBe('reconnecting');
    expect(rootOf(harness).querySelector('.status-badge')?.textContent).toContain('Running');
    expect(rootOf(harness).textContent).toContain('the run keeps executing on the server.');

    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));
    FakeEventSource.latest().open();
    harness.detectChanges();
    expect(
      rootOf(harness).querySelector('[data-connection]')?.getAttribute('data-connection'),
    ).toBe('connected');
  });

  it('shows the explicit stream warning after empty streams exhaust the retry budget', async () => {
    const { harness } = await openWithStream();
    const http = TestBed.inject(HttpTestingController);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const source = FakeEventSource.latest();
      source.open();
      source.fail(0);

      if (attempt < 2) {
        await vi.waitFor(() =>
          expect(FakeEventSource.instances).toHaveLength(attempt + 2),
        );
      }
    }

    await vi.waitFor(() => {
      harness.detectChanges();
      expect(rootOf(harness).querySelector('#live-stream-warning')).not.toBeNull();
    });
    // The facade asks for one fresh snapshot after the stream gives up.
    const refreshes: TestRequest[] = [];
    await vi.waitFor(() => {
      refreshes.push(...http.match(`/api/runs/${RUN_ID}`));
      expect(refreshes.length).toBeGreaterThan(0);
    });
    refreshes[0]?.flush(runSnapshot({ lastEventSequence: 3 }));
    harness.detectChanges();

    const root = rootOf(harness);
    const warning = root.querySelector('#live-stream-warning');
    expect(warning?.textContent).toContain('Live updates are not flowing');
    expect(warning?.textContent).toContain(
      'Live updates stopped after several reconnect attempts',
    );
    expect(warning?.textContent).toContain('Reconnect live updates');
    expect(
      root.querySelector('[data-connection]')?.getAttribute('data-connection'),
    ).toBe('disconnected');
    expect(root.querySelector('.status-badge')?.textContent).toContain('Running');
    expect(FakeEventSource.instances).toHaveLength(3);
  });

  it('hides cancellation from a Viewer while the run is RUNNING', async () => {
    const { harness } = await openWithStream('VIEWER');
    expect(rootOf(harness).querySelector('#cancel-run-button')).toBeNull();
    expect(rootOf(harness).textContent).toContain(
      'Cancelling a running run is an Operator action.',
    );
  });

  it('offers cancellation to an Operator while the run is RUNNING', async () => {
    const { harness } = await openWithStream('OPERATOR');
    expect(rootOf(harness).querySelector('#cancel-run-button')).not.toBeNull();
  });

  it('waits for the server cancellation and does not optimistically complete the run', async () => {
    const { harness, source } = await openWithStream('OPERATOR');

    rootOf(harness).querySelector<HTMLButtonElement>('#cancel-run-button')?.click();
    harness.detectChanges();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Cancel this run?');
    });

    document.querySelector<HTMLButtonElement>('#cancel-run-confirm')?.click();

    await vi.waitFor(() => {
      harness.detectChanges();
      expect(
        rootOf(harness).querySelector('#cancel-run-button')?.textContent,
      ).toContain('Cancelling…');
    });

    const request = TestBed.inject(HttpTestingController).expectOne(
      `/api/runs/${RUN_ID}/cancel`,
    );
    expect(rootOf(harness).querySelector('.status-badge')?.textContent).toContain('Running');

    request.flush(
      runSnapshot({
        status: 'CANCELLED',
        reasonCode: 'USER_CANCELLED',
        finishedAt: '2026-11-03T10:00:02.000Z',
        recordedSampleCount: 1,
        lastEventSequence: 4,
        steps: [
          runningStep({
            status: 'CANCELLED',
            recordedCount: 1,
            measurements: [MEASUREMENT],
          }),
        ],
      }),
    );
    harness.detectChanges();

    expect(rootOf(harness).querySelector('.status-badge')?.textContent).toContain(
      'Cancelled',
    );
    expect(rootOf(harness).textContent).toContain('Run finished');
    expect(rootOf(harness).textContent).toContain(
      'No further live updates will be received for this run.',
    );
    expect(source.closed).toBe(true);
  });

  it('shows a terminal snapshot without opening a stream or offering cancel', async () => {
    const harness = await open(
      'OPERATOR',
      runSnapshot({
        status: 'COMPLETED',
        outcome: 'PASSED',
        finishedAt: '2026-11-03T10:00:04.000Z',
        expectedSampleCount: 1,
        recordedSampleCount: 1,
        lastEventSequence: 7,
        steps: [
          runningStep({
            status: 'COMPLETED',
            outcome: 'PASSED',
            sampleCount: 1,
            recordedCount: 1,
            measurements: [MEASUREMENT],
          }),
        ],
      }),
    );

    const root = rootOf(harness);
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(root.querySelector('.status-badge')?.textContent).toContain('Passed');
    expect(root.querySelector('#cancel-run-button')).toBeNull();
    expect(root.textContent).toContain('Run finished');
    expect(root.textContent).toContain('No further live updates will be received');
  });

  it.each([
    ['INTERRUPTED' as const, 'SERVER_RESTART', 'Interrupted'],
    ['ERROR' as const, 'EXECUTION_FAILED', 'Error'],
  ])(
    'presents the %s terminal state and its reason without claiming completion',
    async (status, reasonCode, label) => {
      const harness = await open(
        'OPERATOR',
        runSnapshot({
          status,
          reasonCode,
          finishedAt: '2026-11-03T10:00:02.000Z',
          recordedSampleCount: 1,
          lastEventSequence: 5,
          steps: [
            runningStep({
              status,
              recordedCount: 1,
              measurements: [MEASUREMENT],
            }),
          ],
        }),
      );

      const root = rootOf(harness);
      expect(root.querySelector('.status-badge')?.textContent).toContain(label);
      expect(root.textContent).toContain(reasonCode);
      expect(root.textContent).toContain('Partial results.');
      expect(root.textContent).toContain('Run finished');
      expect(root.querySelector('#cancel-run-button')).toBeNull();
      expect(FakeEventSource.instances).toHaveLength(0);
    },
  );

  it('keeps View run details working and tears the stream down on route leave', async () => {
    const { harness, source } = await openWithStream();
    emit(source, measurementEvent(4, 0, true));
    harness.detectChanges();

    rootOf(harness)
      .querySelector<HTMLAnchorElement>(`#live-run-details-link[href="/runs/${RUN_ID}"]`)
      ?.click();
    await harness.fixture.whenStable();
    harness.detectChanges();

    TestBed.inject(HttpTestingController)
      .expectOne(`/api/runs/${RUN_ID}`)
      .flush(
        { code: 'NOT_FOUND', message: 'The run was not found.', requestId: 'r1' },
        { status: 404, statusText: 'Not Found' },
      );
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(TestBed.inject(Router).url).toBe(`/runs/${RUN_ID}`);
    expect(rootOf(harness).querySelector('h1')?.textContent?.trim()).toBe('Run Details');
    expect(source.closed).toBe(true);

    await harness.navigateByUrl(`/runs/${RUN_ID}/live`);
    TestBed.inject(HttpTestingController)
      .expectOne(`/api/runs/${RUN_ID}`)
      .flush(
        runSnapshot({
          lastEventSequence: 4,
          recordedSampleCount: 1,
          steps: [
            runningStep({
              recordedCount: 1,
              measurements: [MEASUREMENT],
            }),
          ],
        }),
      );
    await harness.fixture.whenStable();
    harness.detectChanges();

    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));
    expect(FakeEventSource.latest().url).toBe(
      `/api/runs/${RUN_ID}/events?after=4`,
    );
    expect(rootOf(harness).textContent).toContain('1 of 4 samples recorded (25%)');
  });

  it('qualifies stale running steps when every final snapshot attempt fails', async () => {
    const { harness, source } = await openWithStream();

    emit(source, completedEvent(4));
    harness.detectChanges();
    expect(rootOf(harness).querySelector('.status-badge')?.textContent).toContain('Failed');

    for (let attempt = 0; attempt < 3; attempt += 1) {
      TestBed.inject(HttpTestingController)
        .expectOne(`/api/runs/${RUN_ID}`)
        .flush(
          { code: 'INTERNAL_ERROR', message: 'The snapshot failed.', requestId: 'r1' },
          { status: 500, statusText: 'Server Error' },
        );
    }

    harness.detectChanges();
    const root = rootOf(harness);
    const warning = root.querySelector('#live-final-steps-warning');
    expect(warning?.textContent).toContain('Final step detail could not be loaded');
    expect(warning?.textContent).toContain('marked unavailable');
    expect(warning?.textContent).toContain('not shown as');
    expect(root.querySelector('.status-badge')?.textContent).toContain('Failed');
    expect(root.querySelector('.step-row')?.getAttribute('data-status')).toBe('UNAVAILABLE');
    expect(root.querySelector('.step-status')?.textContent?.trim()).toBe('Unavailable');
    expect(root.textContent).not.toContain('In progress:');
    expect(root.textContent).not.toContain('Pending');
  });

  it('does not show the final step warning when the retried snapshot succeeds', async () => {
    const { harness, source } = await openWithStream();

    emit(source, completedEvent(4));
    TestBed.inject(HttpTestingController)
      .expectOne(`/api/runs/${RUN_ID}`)
      .flush(
        { code: 'INTERNAL_ERROR', message: 'The snapshot failed.', requestId: 'r1' },
        { status: 500, statusText: 'Server Error' },
      );
    TestBed.inject(HttpTestingController)
      .expectOne(`/api/runs/${RUN_ID}`)
      .flush(
        runSnapshot({
          status: 'COMPLETED',
          outcome: 'FAILED',
          finishedAt: '2026-11-03T10:00:04.000Z',
          recordedSampleCount: 4,
          lastEventSequence: 4,
          steps: [
            runningStep({
              status: 'COMPLETED',
              outcome: 'FAILED',
              recordedCount: 4,
              outOfToleranceCount: 1,
              firstFailureSampleIndex: 0,
              hasOutOfTolerance: true,
              measurements: [MEASUREMENT],
            }),
          ],
        }),
      );

    harness.detectChanges();
    const root = rootOf(harness);
    expect(root.querySelector('#live-final-steps-warning')).toBeNull();
    expect(root.querySelector('.step-status')?.textContent?.trim()).toBe('Completed');
  });

  it('shows the terminal event and reloads final step states once', async () => {
    const { harness, source } = await openWithStream();

    emit(source, completedEvent(4));
    harness.detectChanges();

    expect(rootOf(harness).querySelector('.status-badge')?.textContent).toContain('Failed');
    expect(source.closed).toBe(true);

    TestBed.inject(HttpTestingController)
      .expectOne(`/api/runs/${RUN_ID}`)
      .flush(
        runSnapshot({
          status: 'COMPLETED',
          outcome: 'FAILED',
          finishedAt: '2026-11-03T10:00:04.000Z',
          recordedSampleCount: 4,
          lastEventSequence: 4,
          steps: [
            runningStep({
              status: 'COMPLETED',
              outcome: 'FAILED',
              recordedCount: 4,
              outOfToleranceCount: 1,
              firstFailureSampleIndex: 0,
              hasOutOfTolerance: true,
              measurements: [MEASUREMENT],
            }),
          ],
        }),
      );
    harness.detectChanges();

    expect(rootOf(harness).textContent).toContain('Run finished');
    expect(rootOf(harness).textContent).toContain('Completed');
    expect(rootOf(harness).textContent).toContain('No further live updates');
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
