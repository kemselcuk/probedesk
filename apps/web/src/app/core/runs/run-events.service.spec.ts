import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  FakeEventSource,
  eventData,
} from './testing/fake-event-source';
import {
  RUN_EVENT_RECONNECT_DELAYS,
  RUN_EVENT_SOURCE_FACTORY,
  RunEventsService,
} from './run-events.service';
import type { RunStreamUpdate } from './run-events.service';

const RUN_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_RUN_ID = '44444444-4444-4444-8444-444444444444';
const STEP_ID = '55555555-5555-4555-8555-555555555555';
const USER_ID = '66666666-6666-4666-8666-666666666666';

const USER: AuthenticatedUser = {
  id: USER_ID,
  email: 'viewer@probedesk.local',
  role: 'VIEWER',
};

function measurementPayload(sequence: number): Record<string, unknown> {
  return {
    stepId: STEP_ID,
    logicalStepId: STEP_ID,
    position: 1,
    sampleIndex: sequence - 2,
    value: '5.000000',
    isWithinTolerance: true,
    recordedAt: '2026-11-03T10:00:01.000Z',
    elapsedMs: 500,
    recordedCount: sequence - 1,
    outOfToleranceCount: 0,
    firstFailureSampleIndex: null,
    hasOutOfTolerance: false,
    recordedSampleCount: sequence - 1,
    expectedSampleCount: 4,
  };
}

function runCompletedPayload(): Record<string, unknown> {
  return {
    status: 'COMPLETED',
    outcome: 'PASSED',
    recordedSampleCount: 4,
    expectedSampleCount: 4,
    stepCount: 1,
    passedStepCount: 1,
    failedStepCount: 0,
    finishedAt: '2026-11-03T10:00:04.000Z',
  };
}

describe('RunEventsService', () => {
  let router: { url: string; navigate: ReturnType<typeof vi.fn> };
  let subscription: Subscription | null;

  beforeEach(() => {
    FakeEventSource.reset();
    router = {
      url: `/runs/${RUN_ID}/live`,
      navigate: vi.fn().mockResolvedValue(true),
    };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Router, useValue: router },
        { provide: RUN_EVENT_RECONNECT_DELAYS, useValue: [0, 0] },
        {
          provide: RUN_EVENT_SOURCE_FACTORY,
          useValue: (url: string) => new FakeEventSource(url) as unknown as EventSource,
        },
      ],
    });
    subscription = null;
  });

  afterEach(() => {
    subscription?.unsubscribe();
    TestBed.inject(HttpTestingController).verify();
  });

  function connect(after = 3): {
    updates: RunStreamUpdate[];
    completed: () => boolean;
  } {
    const service = TestBed.inject(RunEventsService);
    const updates: RunStreamUpdate[] = [];
    let complete = false;
    subscription = service.connect(RUN_ID, after).subscribe({
      next: (update) => updates.push(update),
      complete: () => {
        complete = true;
      },
    });

    return { updates, completed: () => complete };
  }

  it('opens one URL at the snapshot cursor and closes it on unsubscribe', () => {
    const { updates } = connect(7);

    expect(FakeEventSource.instances).toHaveLength(1);
    const source = FakeEventSource.latest();
    expect(source.url).toBe(`/api/runs/${RUN_ID}/events?after=7`);
    expect(updates).toContainEqual({ type: 'connection', state: 'connecting' });

    source.open();
    expect(updates.at(-1)).toEqual({ type: 'connection', state: 'connected' });

    subscription?.unsubscribe();
    subscription = null;

    expect(source.closed).toBe(true);
    expect(source.listenerCount()).toBe(0);
  });

  it('parses a named envelope and ignores an event for another run', () => {
    const { updates } = connect();
    const source = FakeEventSource.latest();
    source.open();

    source.emit(
      'measurement.recorded',
      eventData('measurement.recorded', OTHER_RUN_ID, 4, measurementPayload(4)),
      '4',
    );
    expect(updates.filter((update) => update.type === 'event')).toHaveLength(0);

    source.emit(
      'measurement.recorded',
      eventData('measurement.recorded', RUN_ID, 4, measurementPayload(4)),
      '4',
    );

    const eventUpdate = updates.find((update) => update.type === 'event');
    if (eventUpdate?.type !== 'event' || eventUpdate.event.type !== 'measurement.recorded') {
      throw new Error('The measurement event was not emitted.');
    }
    expect(eventUpdate.event.sequence).toBe(4);
    expect(eventUpdate.event.payload.value).toBe('5.000000');
  });

  it('turns a malformed payload into a controlled protocol error and closes', () => {
    const { updates, completed } = connect();
    const source = FakeEventSource.latest();
    source.open();

    source.emit('measurement.recorded', '{not-json', '4');

    expect(updates).toContainEqual(
      expect.objectContaining({ type: 'error', code: 'protocol' }),
    );
    expect(completed()).toBe(true);
    expect(source.closed).toBe(true);
  });

  it('reconnects with the last applied cursor and replays from there', async () => {
    const { updates } = connect(3);
    const first = FakeEventSource.latest();
    first.open();
    first.emit(
      'measurement.recorded',
      eventData('measurement.recorded', RUN_ID, 4, measurementPayload(4)),
      '4',
    );

    first.fail(0);

    expect(updates).toContainEqual({
      type: 'connection',
      state: 'reconnecting',
    });
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));

    const second = FakeEventSource.latest();
    expect(second.url).toBe(`/api/runs/${RUN_ID}/events?after=4`);
    second.open();
    expect(updates.at(-1)).toEqual({ type: 'connection', state: 'connected' });

    // A replay may repeat sequence 4; the transport forwards it and the facade
    // reducer ignores the duplicate before it reaches state.
    second.emit(
      'measurement.recorded',
      eventData('measurement.recorded', RUN_ID, 4, measurementPayload(4)),
      '4',
    );
    second.emit(
      'measurement.recorded',
      eventData('measurement.recorded', RUN_ID, 5, measurementPayload(5)),
      '5',
    );

    const sequences = updates.flatMap((update) =>
      update.type === 'event' ? [update.event.sequence] : [],
    );
    expect(sequences).toEqual([4, 4, 5]);
  });

  it('restarts an open session at the applied cursor when it delivered a gap event', () => {
    const service = TestBed.inject(RunEventsService);
    const firstUpdates: RunStreamUpdate[] = [];
    const firstSubscription = service
      .connect(RUN_ID, 3)
      .subscribe((update) => firstUpdates.push(update));

    const first = FakeEventSource.latest();
    first.open();

    // The transport parses and delivers sequence 5. A facade would reject it
    // as a forward gap and keep its applied cursor at 3, so the session cursor
    // is now ahead of what the consumer committed.
    first.emit(
      'measurement.recorded',
      eventData('measurement.recorded', RUN_ID, 5, measurementPayload(5)),
      '5',
    );
    expect(
      firstUpdates.flatMap((update) =>
        update.type === 'event' ? [update.event.sequence] : [],
      ),
    ).toEqual([5]);

    const reopenedUpdates: RunStreamUpdate[] = [];
    const reopenedSubscription = service
      .connect(RUN_ID, 3)
      .subscribe((update) => reopenedUpdates.push(update));

    const reopened = FakeEventSource.latest();
    expect(reopened).not.toBe(first);
    expect(first.closed).toBe(true);
    expect(first.listenerCount()).toBe(0);
    expect(reopened.url).toBe(`/api/runs/${RUN_ID}/events?after=3`);
    expect(FakeEventSource.instances.filter((source) => !source.closed)).toEqual([
      reopened,
    ]);

    reopened.open();
    for (const sequence of [4, 5, 6]) {
      reopened.emit(
        'measurement.recorded',
        eventData(
          'measurement.recorded',
          RUN_ID,
          sequence,
          measurementPayload(sequence),
        ),
        String(sequence),
      );
    }

    const reopenedSequences = reopenedUpdates.flatMap((update) =>
      update.type === 'event' ? [update.event.sequence] : [],
    );
    expect(reopenedSequences).toEqual([4, 5, 6]);

    firstSubscription.unsubscribe();
    reopenedSubscription.unsubscribe();
    expect(reopened.closed).toBe(true);
    expect(reopened.listenerCount()).toBe(0);
  });

  it('cancels an ahead reconnect and resumes from a lower requested cursor', async () => {
    const service = TestBed.inject(RunEventsService);
    const first = service.connect(RUN_ID, 3).subscribe();
    const source = FakeEventSource.latest();
    source.open();

    source.emit(
      'measurement.recorded',
      eventData('measurement.recorded', RUN_ID, 4, measurementPayload(4)),
      '4',
    );
    source.emit(
      'measurement.recorded',
      eventData('measurement.recorded', RUN_ID, 5, measurementPayload(5)),
      '5',
    );
    source.fail(0);

    const reopenedUpdates: RunStreamUpdate[] = [];
    const reopenedSubscription = service
      .connect(RUN_ID, 3)
      .subscribe((update) => reopenedUpdates.push(update));

    const reopened = FakeEventSource.latest();
    expect(reopened.url).toBe(`/api/runs/${RUN_ID}/events?after=3`);
    expect(source.closed).toBe(true);

    // The pending reconnect timer from the failed source must not open a
    // second source at after=5.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances.filter((item) => !item.closed)).toEqual([
      reopened,
    ]);

    reopened.open();
    reopened.emit(
      'measurement.recorded',
      eventData('measurement.recorded', RUN_ID, 4, measurementPayload(4)),
      '4',
    );
    reopened.emit(
      'measurement.recorded',
      eventData('measurement.recorded', RUN_ID, 5, measurementPayload(5)),
      '5',
    );

    const sequences = reopenedUpdates.flatMap((update) =>
      update.type === 'event' ? [update.event.sequence] : [],
    );
    expect(sequences).toEqual([4, 5]);

    first.unsubscribe();
    reopenedSubscription.unsubscribe();
  });

  it('asks /auth/me on a fatal close and reconnects when the session is alive', async () => {
    const http = TestBed.inject(HttpTestingController);
    connect(3);
    const first = FakeEventSource.latest();
    first.open();

    first.fail(2);

    http.expectOne('/api/auth/me').flush(USER);
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));
  });

  it('stops retrying and redirects to login when /auth/me returns 401', async () => {
    const http = TestBed.inject(HttpTestingController);
    const { updates, completed } = connect(3);
    const first = FakeEventSource.latest();
    first.open();

    first.fail(2);
    http
      .expectOne('/api/auth/me')
      .flush(
        { code: 'UNAUTHENTICATED', message: 'Your session has expired.', requestId: 'r1' },
        { status: 401, statusText: 'Unauthorized' },
      );

    expect(updates).toContainEqual({
      type: 'connection',
      state: 'unauthenticated',
    });
    expect(completed()).toBe(true);
    expect(first.closed).toBe(true);
    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: `/runs/${RUN_ID}/live` },
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('shares one EventSource between subscriptions for the same run', () => {
    const service = TestBed.inject(RunEventsService);
    const first: RunStreamUpdate[] = [];
    const second: RunStreamUpdate[] = [];
    const firstSubscription = service.connect(RUN_ID, 3).subscribe((update) => {
      first.push(update);
    });
    const secondSubscription = service.connect(RUN_ID, 3).subscribe((update) => {
      second.push(update);
    });

    expect(FakeEventSource.instances).toHaveLength(1);
    const source = FakeEventSource.latest();
    source.open();

    source.emit(
      'measurement.recorded',
      eventData('measurement.recorded', RUN_ID, 4, measurementPayload(4)),
      '4',
    );

    expect(first.filter((update) => update.type === 'event')).toHaveLength(1);
    expect(second.filter((update) => update.type === 'event')).toHaveLength(1);

    firstSubscription.unsubscribe();
    expect(source.closed).toBe(false);

    secondSubscription.unsubscribe();
    expect(source.closed).toBe(true);
    expect(source.listenerCount()).toBe(0);
  });

  it('closes after the terminal event and does not reconnect', async () => {
    const { updates, completed } = connect(3);
    const source = FakeEventSource.latest();
    source.open();

    source.emit(
      'run.completed',
      eventData('run.completed', RUN_ID, 4, runCompletedPayload()),
      '4',
    );

    expect(updates).toContainEqual(
      expect.objectContaining({
        type: 'event',
        event: expect.objectContaining({ type: 'run.completed' }),
      }),
    );
    expect(updates.at(-1)).toEqual({
      type: 'connection',
      state: 'disconnected',
    });
    expect(completed()).toBe(true);
    expect(source.closed).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('gives up when every stream opens and closes without a domain event', async () => {
    const { updates, completed } = connect(3);

    for (let index = 0; index < 3; index += 1) {
      const source = FakeEventSource.latest();
      source.open();
      source.fail(0);

      if (index < 2) {
        await vi.waitFor(() =>
          expect(FakeEventSource.instances).toHaveLength(index + 2),
        );
      }
    }

    await vi.waitFor(() => expect(completed()).toBe(true));
    expect(FakeEventSource.instances).toHaveLength(3);
    expect(updates).toContainEqual(
      expect.objectContaining({ type: 'error', code: 'unavailable' }),
    );
    expect(updates.at(-1)).toEqual({
      type: 'connection',
      state: 'disconnected',
    });
    expect(FakeEventSource.instances.every((source) => source.closed)).toBe(true);
    expect(
      FakeEventSource.instances.every((source) => source.listenerCount() === 0),
    ).toBe(true);
  });

  it('resets the reconnect budget only after a delivered domain event', async () => {
    const { updates } = connect(3);

    let source = FakeEventSource.latest();
    source.open();
    source.fail(0);
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));

    source = FakeEventSource.latest();
    source.open();
    source.fail(0);
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(3));

    // Without a delivered event the next failure would exhaust the two-delay
    // budget. The event below is the only thing that grants a fresh budget.
    source = FakeEventSource.latest();
    source.open();
    source.emit(
      'measurement.recorded',
      eventData('measurement.recorded', RUN_ID, 4, measurementPayload(4)),
      '4',
    );
    source.fail(0);

    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(4));
    const reopened = FakeEventSource.latest();
    reopened.open();

    expect(updates.at(-1)).toEqual({ type: 'connection', state: 'connected' });
    expect(updates.filter((update) => update.type === 'error')).toHaveLength(0);
    expect(reopened.closed).toBe(false);
  });

  it('does not reset the reconnect budget for a duplicate replay', async () => {
    const { updates, completed } = connect(3);

    let source = FakeEventSource.latest();
    source.open();
    source.fail(0);
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));

    source = FakeEventSource.latest();
    source.open();
    source.fail(0);
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(3));

    // Sequence 3 is the session cursor, so this replay does not advance it.
    // A server that repeats the same old frame cannot keep the stream alive
    // forever by pretending it produced new data.
    source = FakeEventSource.latest();
    source.open();
    source.emit(
      'measurement.recorded',
      eventData('measurement.recorded', RUN_ID, 3, measurementPayload(3)),
      '3',
    );
    source.fail(0);

    await vi.waitFor(() => expect(completed()).toBe(true));
    expect(FakeEventSource.instances).toHaveLength(3);
    expect(updates).toContainEqual(
      expect.objectContaining({ type: 'error', code: 'unavailable' }),
    );
    expect(updates.at(-1)).toEqual({
      type: 'connection',
      state: 'disconnected',
    });
  });

  it('gives up after the bounded reconnect delays with a visible error', async () => {
    const { updates, completed } = connect(3);
    const first = FakeEventSource.latest();
    first.open();

    first.fail(0);
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));
    FakeEventSource.latest().fail(0);
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(3));
    FakeEventSource.latest().fail(0);

    await vi.waitFor(() => expect(completed()).toBe(true));
    expect(updates).toContainEqual(
      expect.objectContaining({ type: 'error', code: 'unavailable' }),
    );
    expect(updates.at(-1)).toEqual({
      type: 'connection',
      state: 'disconnected',
    });
  });
});
