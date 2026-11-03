import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RUN_EVENT_RECONNECT_DELAYS,
  RUN_EVENT_SOURCE_FACTORY,
  RunEventsService,
} from '../../core/runs/run-events.service';
import type { RunStreamUpdate } from '../../core/runs/run-events.service';
import {
  FakeEventSource,
  eventData,
} from '../../core/runs/testing/fake-event-source';
import type { RunEventEnvelope } from '../../core/runs/run-event.types';
import { LiveRunFacade } from './live-run.facade';
import {
  RUN_ID,
  RUN_STEP_ID,
  cancelledEvent,
  completedEvent,
  measurementEvent,
  runSnapshot,
  runningStep,
} from './testing/run-fixtures';

describe('LiveRunFacade', () => {
  let http: HttpTestingController;
  let extraSubscription: Subscription | null;

  beforeEach(() => {
    FakeEventSource.reset();
    TestBed.configureTestingModule({
      providers: [
        LiveRunFacade,
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: Router,
          useValue: {
            url: `/runs/${RUN_ID}/live`,
            navigate: vi.fn().mockResolvedValue(true),
          },
        },
        { provide: RUN_EVENT_RECONNECT_DELAYS, useValue: [0, 0] },
        {
          provide: RUN_EVENT_SOURCE_FACTORY,
          useValue: (url: string) =>
            new FakeEventSource(url) as unknown as EventSource,
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    extraSubscription = null;
  });

  afterEach(() => {
    extraSubscription?.unsubscribe();
    extraSubscription = null;
    http.verify();
  });

  function emit(source: FakeEventSource, event: RunEventEnvelope): void {
    source.emit(
      event.type,
      eventData(event.type, event.runId, event.sequence, event.payload),
      String(event.sequence),
    );
  }

  async function loadRunning(
    snapshot = runSnapshot(),
  ): Promise<{ facade: LiveRunFacade; source: FakeEventSource }> {
    const facade = TestBed.inject(LiveRunFacade);
    facade.load(RUN_ID);
    const request = http.expectOne(`/api/runs/${RUN_ID}`);
    request.flush(snapshot);
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    const source = FakeEventSource.latest();
    source.open();
    return { facade, source };
  }

  it('loads the snapshot first and opens the stream at its cursor', async () => {
    const facade = TestBed.inject(LiveRunFacade);
    facade.load(RUN_ID);

    const request = http.expectOne(`/api/runs/${RUN_ID}`);
    expect(request.request.method).toBe('GET');
    request.flush(runSnapshot());

    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.latest();
    expect(source.url).toBe(`/api/runs/${RUN_ID}/events?after=3`);

    source.open();
    expect(facade.connection()).toBe('connected');
    expect(facade.snapshot()?.status).toBe('RUNNING');
    expect(facade.loadStatus()).toBe('loaded');
  });

  it('applies live samples and keeps the first violation after a normal sample', async () => {
    const { facade, source } = await loadRunning();

    emit(source, measurementEvent(4, 0, false));
    expect(facade.snapshot()?.steps[0]?.hasOutOfTolerance).toBe(true);
    expect(facade.snapshot()?.steps[0]?.firstFailureSampleIndex).toBe(0);
    expect(facade.recentMeasurements()).toHaveLength(1);
    expect(facade.recentMeasurements()[0]?.isWithinTolerance).toBe(false);

    emit(source, measurementEvent(5, 1, true));
    expect(facade.snapshot()?.recordedSampleCount).toBe(2);
    expect(facade.snapshot()?.steps[0]?.hasOutOfTolerance).toBe(true);
    expect(facade.snapshot()?.steps[0]?.firstFailureSampleIndex).toBe(0);
    expect(facade.snapshot()?.steps[0]?.measurements).toHaveLength(2);
  });

  it('ignores a duplicate sequence without duplicating the sample', async () => {
    const { facade, source } = await loadRunning();

    emit(source, measurementEvent(4, 0, true));
    emit(source, measurementEvent(4, 0, true));

    expect(facade.snapshot()?.recordedSampleCount).toBe(1);
    expect(facade.snapshot()?.steps[0]?.measurements).toHaveLength(1);
  });

  it('reconciles a forward gap with a fresh snapshot and reopens after its cursor', async () => {
    const { facade, source } = await loadRunning();

    emit(source, measurementEvent(6, 1, true));

    const reconcile = http.expectOne(`/api/runs/${RUN_ID}`);
    expect(source.closed).toBe(true);
    expect(facade.connection()).toBe('reconnecting');

    reconcile.flush(
      runSnapshot({
        lastEventSequence: 6,
        recordedSampleCount: 2,
        steps: [
          runningStep({
            recordedCount: 2,
            measurements: [
              {
                sampleIndex: 0,
                value: '5.000000',
                isWithinTolerance: true,
                recordedAt: '2026-11-03T10:00:01.000Z',
                elapsedMs: 500,
              },
              {
                sampleIndex: 1,
                value: '5.000000',
                isWithinTolerance: true,
                recordedAt: '2026-11-03T10:00:02.000Z',
                elapsedMs: 1000,
              },
            ],
          }),
        ],
      }),
    );

    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));
    const reopened = FakeEventSource.latest();
    expect(reopened.url).toBe(`/api/runs/${RUN_ID}/events?after=6`);
    expect(facade.snapshot()?.recordedSampleCount).toBe(2);
    expect(facade.snapshot()?.steps[0]?.measurements).toHaveLength(2);
  });

  it('reconciles a gap without reusing a session whose cursor is ahead', async () => {
    const events = TestBed.inject(RunEventsService);
    const shadowUpdates: RunStreamUpdate[] = [];
    extraSubscription = events
      .connect(RUN_ID, 3)
      .subscribe((update) => shadowUpdates.push(update));

    const { facade, source } = await loadRunning();
    expect(FakeEventSource.instances).toHaveLength(1);

    // The transport delivers sequence 15 while the facade is still at 3. The
    // facade rejects it as a gap, but the shadow consumer keeps the session
    // (and its cursor at 15) alive across the reconcile.
    emit(source, measurementEvent(15, 0, true));
    expect(facade.connection()).toBe('reconnecting');
    expect(source.closed).toBe(false);

    const reconcile = http.expectOne(`/api/runs/${RUN_ID}`);
    reconcile.flush(
      runSnapshot({
        lastEventSequence: 10,
        recordedSampleCount: 2,
        steps: [
          runningStep({
            recordedCount: 2,
            measurements: [
              {
                sampleIndex: 0,
                value: '5.000000',
                isWithinTolerance: true,
                recordedAt: '2026-11-03T10:00:01.000Z',
                elapsedMs: 500,
              },
              {
                sampleIndex: 1,
                value: '5.000000',
                isWithinTolerance: true,
                recordedAt: '2026-11-03T10:00:02.000Z',
                elapsedMs: 1000,
              },
            ],
          }),
        ],
      }),
    );

    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));
    const reopened = FakeEventSource.latest();
    expect(source.closed).toBe(true);
    expect(reopened.url).toBe(`/api/runs/${RUN_ID}/events?after=10`);
    expect(FakeEventSource.instances.filter((item) => !item.closed)).toEqual([
      reopened,
    ]);

    reopened.open();
    for (let sampleIndex = 2; sampleIndex <= 6; sampleIndex += 1) {
      emit(reopened, measurementEvent(9 + sampleIndex, sampleIndex, true));
    }

    // Sequences 11..15 are replayed exactly once after the snapshot at 10;
    // the event 15 that triggered the gap is not counted twice or skipped.
    expect(facade.snapshot()?.lastEventSequence).toBe(15);
    expect(facade.snapshot()?.recordedSampleCount).toBe(7);
    const measurements = facade.snapshot()?.steps[0]?.measurements ?? [];
    expect(measurements.map((measurement) => measurement.sampleIndex)).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
    expect(FakeEventSource.instances).toHaveLength(2);
    http.expectNone(`/api/runs/${RUN_ID}`);
    expect(shadowUpdates.length).toBeGreaterThan(0);
  });

  it('applies a terminal event, closes the stream, and fills final step states once', async () => {
    const { facade, source } = await loadRunning();

    emit(source, cancelledEvent(4));
    expect(facade.snapshot()?.status).toBe('CANCELLED');
    expect(source.closed).toBe(true);
    expect(facade.isTerminal()).toBe(true);
    expect(facade.connection()).toBe('disconnected');

    const finalRequest = http.expectOne(`/api/runs/${RUN_ID}`);
    finalRequest.flush(
      runSnapshot({
        status: 'CANCELLED',
        reasonCode: 'USER_CANCELLED',
        finishedAt: '2026-11-03T10:00:02.000Z',
        recordedSampleCount: 1,
        lastEventSequence: 4,
        steps: [runningStep({ status: 'CANCELLED', recordedCount: 1 })],
      }),
    );

    expect(facade.snapshot()?.steps[0]?.status).toBe('CANCELLED');
    expect(facade.finalizing()).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('never reverts a terminal event when the final snapshot claims RUNNING', async () => {
    const { facade, source } = await loadRunning();

    emit(source, completedEvent(4));
    http
      .expectOne(`/api/runs/${RUN_ID}`)
      .flush(runSnapshot({ lastEventSequence: 4 }));

    expect(facade.snapshot()?.status).toBe('COMPLETED');
    expect(facade.snapshot()?.outcome).toBe('FAILED');
  });

  it('does not show a cancellation before the server confirms it', async () => {
    const { facade } = await loadRunning();

    facade.cancel();
    expect(facade.cancelPending()).toBe(true);
    expect(facade.snapshot()?.status).toBe('RUNNING');

    const request: TestRequest = http.expectOne(`/api/runs/${RUN_ID}/cancel`);
    expect(request.request.method).toBe('POST');
    request.flush(
      runSnapshot({
        status: 'CANCELLED',
        reasonCode: 'USER_CANCELLED',
        finishedAt: '2026-11-03T10:00:02.000Z',
        recordedSampleCount: 1,
        lastEventSequence: 4,
        steps: [runningStep({ status: 'CANCELLED' })],
      }),
    );

    expect(facade.cancelPending()).toBe(false);
    expect(facade.snapshot()?.status).toBe('CANCELLED');
    expect(FakeEventSource.latest().closed).toBe(true);
  });

  it('keeps RUNNING and reports the error when cancellation fails', async () => {
    const { facade } = await loadRunning();

    facade.cancel();
    http
      .expectOne(`/api/runs/${RUN_ID}/cancel`)
      .flush(
        { code: 'INTERNAL_ERROR', message: 'The cancel failed.', requestId: 'r1' },
        { status: 500, statusText: 'Server Error' },
      );

    expect(facade.cancelPending()).toBe(false);
    expect(facade.snapshot()?.status).toBe('RUNNING');
    expect(facade.cancelError()?.status).toBe(500);
  });

  it('stops the stream and shows reconnecting after a network drop, then resumes', async () => {
    const { facade, source } = await loadRunning();
    emit(source, measurementEvent(4, 0, true));

    source.fail(0);
    expect(facade.connection()).toBe('reconnecting');

    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));
    const reopened = FakeEventSource.latest();
    expect(reopened.url).toBe(`/api/runs/${RUN_ID}/events?after=4`);
    reopened.open();
    expect(facade.connection()).toBe('connected');
  });

  it('ignores a stale snapshot response after a newer load starts', async () => {
    const facade = TestBed.inject(LiveRunFacade);
    facade.load(RUN_ID);
    facade.load(RUN_ID);

    const requests = http.match(`/api/runs/${RUN_ID}`);
    expect(requests).toHaveLength(2);

    requests[1]?.flush(runSnapshot({ planName: 'Newer plan', versionNumber: 9 }));
    expect(facade.snapshot()?.planName).toBe('Newer plan');
    expect(facade.snapshot()?.versionNumber).toBe(9);

    requests[0]?.flush(runSnapshot({ planName: 'Older plan', versionNumber: 2 }));
    expect(facade.snapshot()?.planName).toBe('Newer plan');
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    expect(FakeEventSource.latest().url).toBe(
      `/api/runs/${RUN_ID}/events?after=3`,
    );
  });

  it('does not open a stream for a terminal snapshot', () => {
    const facade = TestBed.inject(LiveRunFacade);
    facade.load(RUN_ID);
    http.expectOne(`/api/runs/${RUN_ID}`).flush(
      runSnapshot({
        status: 'COMPLETED',
        outcome: 'PASSED',
        finishedAt: '2026-11-03T10:00:04.000Z',
        recordedSampleCount: 4,
        lastEventSequence: 9,
        steps: [runningStep({ status: 'COMPLETED', outcome: 'PASSED' })],
      }),
    );

    expect(FakeEventSource.instances).toHaveLength(0);
    expect(facade.connection()).toBe('disconnected');
    expect(facade.isTerminal()).toBe(true);
  });

  it('uses the runId in the route for the latest snapshot', async () => {
    const facade = TestBed.inject(LiveRunFacade);
    facade.load(RUN_ID);
    http.expectOne(`/api/runs/${RUN_ID}`).flush(runSnapshot());
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    expect(facade.recentMeasurements()).toEqual([]);
    expect(facade.snapshot()?.steps[0]?.runStepId).toBe(RUN_STEP_ID);
  });
});
