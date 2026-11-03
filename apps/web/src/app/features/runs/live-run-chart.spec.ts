import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import {
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
import { MEASUREMENT_CHART_FACTORY } from '../../shared/charts/measurement-chart.factory';
import { FakeMeasurementChartFactory } from '../../shared/charts/testing/fake-measurement-chart';
import { LIVE_CHART_SCHEDULER } from './live-chart-scheduler';
import type { RunSnapshotStep } from './runs-api.types';
import {
  RUN_ID,
  USER_ID,
  completedEvent,
  runSnapshot,
  runningStep,
} from './testing/run-fixtures';
import { FakeLiveChartScheduler } from './testing/live-chart-scheduler.fake';

const SECOND_STEP_ID = '88888888-8888-4888-8888-888888888888';
const SECOND_RUN_STEP_ID = '99999999-9999-4999-8999-999999999999';

function secondStep(
  overrides: Partial<RunSnapshotStep> = {},
): RunSnapshotStep {
  return runningStep({
    runStepId: SECOND_RUN_STEP_ID,
    logicalStepId: SECOND_STEP_ID,
    position: 2,
    name: 'Current draw',
    unit: 'A',
    minimum: '0.100000',
    maximum: '0.550000',
    sampleCount: 30,
    intervalMs: 100,
    ...overrides,
  });
}

function measurementFor(
  sequence: number,
  step: RunSnapshotStep,
  sampleIndex: number,
  isWithinTolerance: boolean,
  expectedSampleCount: number,
): RunEventEnvelope {
  const elapsedMs = (sampleIndex + 1) * 100;
  return {
    type: 'measurement.recorded',
    schemaVersion: 1,
    runId: RUN_ID,
    sequence,
    occurredAt: `2026-11-03T10:00:${String(sequence).padStart(2, '0')}.000Z`,
    payload: {
      stepId: step.runStepId,
      logicalStepId: step.logicalStepId,
      position: step.position,
      sampleIndex,
      value: isWithinTolerance ? '0.200000' : '0.600000',
      isWithinTolerance,
      recordedAt: `2026-11-03T10:00:${String(sequence).padStart(2, '0')}.000Z`,
      elapsedMs,
      recordedCount: sampleIndex + 1,
      outOfToleranceCount: isWithinTolerance ? 0 : 1,
      firstFailureSampleIndex: isWithinTolerance ? null : sampleIndex,
      hasOutOfTolerance: !isWithinTolerance,
      recordedSampleCount: sampleIndex + 1,
      expectedSampleCount,
    },
  };
}

function measurementSnapshot(
  step: RunSnapshotStep,
  count: number,
): RunSnapshotStep {
  return {
    ...step,
    status: 'COMPLETED',
    outcome: 'FAILED',
    recordedCount: count,
    outOfToleranceCount: 1,
    firstFailureSampleIndex: 2,
    hasOutOfTolerance: true,
    measurements: Array.from({ length: count }, (_, sampleIndex) => ({
      sampleIndex,
      value: sampleIndex === 2 ? '0.600000' : '0.200000',
      isWithinTolerance: sampleIndex !== 2,
      recordedAt: `2026-11-03T10:00:${String(sampleIndex + 4).padStart(2, '0')}.000Z`,
      elapsedMs: (sampleIndex + 1) * 100,
    })),
  };
}

describe('LiveRunPage measurement charts', () => {
  let chartFactory: FakeMeasurementChartFactory;
  let scheduler: FakeLiveChartScheduler;

  beforeEach(async () => {
    FakeEventSource.reset();
    chartFactory = new FakeMeasurementChartFactory();
    scheduler = new FakeLiveChartScheduler();
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
        { provide: MEASUREMENT_CHART_FACTORY, useValue: chartFactory },
        { provide: LIVE_CHART_SCHEDULER, useValue: scheduler },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    TestBed.inject(HttpTestingController).verify();
  });

  function actAs(role: Role = 'OPERATOR'): void {
    TestBed.inject(AuthSessionStore).authenticate({
      id: USER_ID,
      email: `${role.toLowerCase()}@probedesk.local`,
      role,
    });
  }

  async function openWithStream(
    snapshot = runSnapshot(),
  ): Promise<{ harness: RouterTestingHarness; source: FakeEventSource }> {
    actAs();
    const harness = await RouterTestingHarness.create(`/runs/${RUN_ID}/live`);
    TestBed.inject(HttpTestingController)
      .expectOne(`/api/runs/${RUN_ID}`)
      .flush(snapshot);
    await harness.fixture.whenStable();
    TestBed.tick();
    harness.detectChanges();
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

  function settle(harness: RouterTestingHarness): void {
    TestBed.tick();
    harness.detectChanges();
  }

  function chartPoints(index: number) {
    return chartFactory.created[index]?.config.data.datasets[0]?.data ?? [];
  }

  it('renders one chart per step and groups a burst without losing a sample', async () => {
    const first = runningStep({ sampleCount: 30 });
    const second = secondStep();
    const snapshot = runSnapshot({
      expectedSampleCount: 60,
      steps: [first, second],
    });
    const { harness, source } = await openWithStream(snapshot);

    expect(chartFactory.created).toHaveLength(2);
    expect(rootOf(harness).querySelectorAll('app-measurement-chart')).toHaveLength(2);

    for (let sampleIndex = 0; sampleIndex < 5; sampleIndex += 1) {
      emit(
        source,
        measurementFor(4 + sampleIndex, first, sampleIndex, sampleIndex !== 2, 60),
      );
    }

    // The store has every sample immediately; only the visual copy is buffered.
    expect(scheduler.requestCount).toBe(1);
    expect(scheduler.pendingCount).toBe(1);
    expect(chartPoints(0)).toHaveLength(0);

    scheduler.flush();
    settle(harness);

    const points = chartPoints(0);
    expect(points).toHaveLength(5);
    expect(points.map((point) => point.sampleIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(points.map((point) => point.x)).toEqual([100, 200, 300, 400, 500]);
    expect(points[2]?.measurement.isWithinTolerance).toBe(false);
    expect(points[0]?.measurement.isWithinTolerance).toBe(true);
    expect(chartPoints(1)).toHaveLength(0);

    const firstChartCard = rootOf(harness).querySelector(
      `[data-run-step-id="${first.runStepId}"]`,
    );
    expect(firstChartCard?.querySelectorAll('tbody tr')).toHaveLength(5);
    expect(
      rootOf(harness).querySelector('[data-chart-sample-count]')?.getAttribute(
        'data-chart-sample-count',
      ),
    ).toBe('5');
  });

  it('uses the terminal final snapshot for the chart and table and then stops', async () => {
    const step = runningStep({ sampleCount: 12 });
    const snapshot = runSnapshot({
      expectedSampleCount: 12,
      steps: [step],
    });
    const { harness, source } = await openWithStream(snapshot);

    for (let sampleIndex = 0; sampleIndex < 12; sampleIndex += 1) {
      emit(
        source,
        measurementFor(4 + sampleIndex, step, sampleIndex, sampleIndex !== 2, 12),
      );
    }
    expect(scheduler.pendingCount).toBe(1);

    const finalStep = measurementSnapshot(step, 12);
    emit(source, completedEvent(16));
    settle(harness);

    // No scheduled visual work survives the terminal event.
    expect(scheduler.requestCount).toBe(1);
    expect(scheduler.pendingCount).toBe(0);

    TestBed.inject(HttpTestingController)
      .expectOne(`/api/runs/${RUN_ID}`)
      .flush(
        runSnapshot({
          status: 'COMPLETED',
          outcome: 'FAILED',
          finishedAt: '2026-11-03T10:00:20.000Z',
          expectedSampleCount: 12,
          recordedSampleCount: 12,
          lastEventSequence: 16,
          steps: [finalStep],
        }),
      );
    settle(harness);

    expect(chartPoints(0)).toHaveLength(12);
    expect(
      rootOf(harness).querySelectorAll('#live-charts-section tbody tr'),
    ).toHaveLength(12);
    expect(
      rootOf(harness)
        .querySelector('[data-charts-section], #live-charts-section')
        ?.getAttribute('data-recorded-sample-count'),
    ).toBe('12');
    expect(rootOf(harness).textContent).toContain('12 of 12 recorded samples');

    const chartState = chartPoints(0).length;
    for (let index = 0; index < 10; index += 1) {
      source.emit(
        'measurement.recorded',
        eventData(
          'measurement.recorded',
          RUN_ID,
          17 + index,
          measurementFor(17 + index, step, 12 + index, true, 12).payload,
        ),
        String(17 + index),
      );
    }
    settle(harness);

    expect(chartPoints(0)).toHaveLength(chartState);
    expect(scheduler.requestCount).toBe(1);
    expect(rootOf(harness).textContent).toContain('Run finished');
  });

  it('selects and focuses the matching measurement row from a chart point', async () => {
    const step = runningStep({ sampleCount: 6 });
    const { harness, source } = await openWithStream(
      runSnapshot({ expectedSampleCount: 6, steps: [step] }),
    );

    for (let sampleIndex = 0; sampleIndex < 3; sampleIndex += 1) {
      emit(
        source,
        measurementFor(4 + sampleIndex, step, sampleIndex, sampleIndex !== 1, 6),
      );
    }
    scheduler.flush();
    settle(harness);

    chartFactory.created[0]?.clickPoint(1);
    settle(harness);

    const row = rootOf(harness).querySelector<HTMLElement>(
      `#measurement-row-${step.runStepId}-1`,
    );
    expect(row?.classList.contains('is-selected')).toBe(true);
    expect(row?.getAttribute('aria-current')).toBe('true');
    expect(document.activeElement?.id).toBe(row?.id);
    expect(rootOf(harness).textContent).toContain(
      'Outside tolerance: sample 1 of step 1, Output voltage',
    );
    expect(chartFactory.created[0]?.updateCalls.length).toBeGreaterThan(0);
  });

  it('destroys chart instances on route leave and rebuilds from a fresh snapshot on return', async () => {
    const step = runningStep({ sampleCount: 6 });
    const { harness, source } = await openWithStream(
      runSnapshot({ expectedSampleCount: 6, steps: [step] }),
    );
    emit(source, measurementFor(4, step, 0, true, 6));
    scheduler.flush();
    settle(harness);

    expect(chartFactory.created).toHaveLength(1);
    expect(chartFactory.created[0]?.destroyCalls).toBe(0);

    await harness.navigateByUrl(`/runs/${RUN_ID}`);
    TestBed.inject(HttpTestingController)
      .expectOne(`/api/runs/${RUN_ID}`)
      .flush(
        runSnapshot({
          status: 'COMPLETED',
          outcome: 'PASSED',
          finishedAt: '2026-11-03T10:00:05.000Z',
          expectedSampleCount: 6,
          recordedSampleCount: 2,
          lastEventSequence: 5,
          steps: [
            {
              ...step,
              status: 'COMPLETED',
              outcome: 'PASSED',
              recordedCount: 2,
              measurements: [
                {
                  sampleIndex: 0,
                  value: '5.000000',
                  isWithinTolerance: true,
                  recordedAt: '2026-11-03T10:00:01.000Z',
                  elapsedMs: 100,
                },
                {
                  sampleIndex: 1,
                  value: '5.100000',
                  isWithinTolerance: true,
                  recordedAt: '2026-11-03T10:00:02.000Z',
                  elapsedMs: 200,
                },
              ],
            },
          ],
        }),
      );
    await harness.fixture.whenStable();
    settle(harness);

    expect(chartFactory.created[0]?.destroyCalls).toBe(1);
    expect(source.closed).toBe(true);
    expect(chartFactory.created).toHaveLength(2);
    expect(chartPoints(1)).toHaveLength(2);

    await harness.navigateByUrl(`/runs/${RUN_ID}/live`);
    TestBed.inject(HttpTestingController)
      .expectOne(`/api/runs/${RUN_ID}`)
      .flush(
        runSnapshot({
          status: 'COMPLETED',
          outcome: 'PASSED',
          finishedAt: '2026-11-03T10:00:05.000Z',
          expectedSampleCount: 6,
          recordedSampleCount: 2,
          lastEventSequence: 5,
          steps: [
            {
              ...step,
              status: 'COMPLETED',
              outcome: 'PASSED',
              recordedCount: 2,
              measurements: [
                {
                  sampleIndex: 0,
                  value: '5.000000',
                  isWithinTolerance: true,
                  recordedAt: '2026-11-03T10:00:01.000Z',
                  elapsedMs: 100,
                },
                {
                  sampleIndex: 1,
                  value: '5.100000',
                  isWithinTolerance: true,
                  recordedAt: '2026-11-03T10:00:02.000Z',
                  elapsedMs: 200,
                },
              ],
            },
          ],
        }),
      );
    await harness.fixture.whenStable();
    settle(harness);

    expect(chartFactory.created).toHaveLength(3);
    expect(chartPoints(2)).toHaveLength(2);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(rootOf(harness).textContent).toContain('Passed');
  });

  it('tears down a pending visual update when the route is left', async () => {
    const step = runningStep({ sampleCount: 6 });
    const { harness, source } = await openWithStream(
      runSnapshot({ expectedSampleCount: 6, steps: [step] }),
    );
    emit(source, measurementFor(4, step, 0, true, 6));
    expect(scheduler.pendingCount).toBe(1);

    await harness.navigateByUrl(`/runs/${RUN_ID}`);
    TestBed.inject(HttpTestingController)
      .expectOne(`/api/runs/${RUN_ID}`)
      .flush(
        runSnapshot({
          status: 'COMPLETED',
          outcome: 'PASSED',
          finishedAt: '2026-11-03T10:00:05.000Z',
          expectedSampleCount: 6,
          recordedSampleCount: 1,
          lastEventSequence: 5,
          steps: [measurementSnapshot(step, 1)],
        }),
      );
    await harness.fixture.whenStable();
    settle(harness);

    expect(scheduler.pendingCount).toBe(0);
    expect(scheduler.cancelCount).toBeGreaterThan(0);
    expect(chartFactory.created[0]?.destroyCalls).toBe(1);
  });
});
