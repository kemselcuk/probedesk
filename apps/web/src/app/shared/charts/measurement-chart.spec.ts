import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { components } from '@probedesk/api-client';
import { MeasurementChart } from './measurement-chart';
import {
  FakeMeasurementChartFactory,
  FakeMeasurementChartHandle,
} from './testing/fake-measurement-chart';
import { MEASUREMENT_CHART_FACTORY } from './measurement-chart.factory';
import type { MeasurementChartStep, MeasurementSelection } from './measurement-chart.types';

const RUN_ID = '33333333-3333-4333-8333-333333333333';
const STEP_ID = '44444444-4444-4444-8444-444444444444';
const RUN_STEP_ID = '55555555-5555-4555-8555-555555555555';

type RunMeasurement = components['schemas']['RunMeasurementDto'];

function sample(
  sampleIndex: number,
  value: string,
  isWithinTolerance: boolean,
  elapsedMs: number,
): RunMeasurement {
  return {
    sampleIndex,
    value,
    isWithinTolerance,
    recordedAt: `2026-11-03T10:00:0${Math.min(sampleIndex, 9)}.000Z`,
    elapsedMs,
  };
}

function chartStep(overrides: Partial<MeasurementChartStep> = {}): MeasurementChartStep {
  return {
    runStepId: RUN_STEP_ID,
    logicalStepId: STEP_ID,
    position: 2,
    name: 'Current draw',
    unit: 'A',
    minimum: '0.100000',
    maximum: '0.550000',
    sampleCount: 3,
    outOfToleranceCount: 1,
    firstFailureSampleIndex: 1,
    hasOutOfTolerance: true,
    measurements: [
      sample(0, '0.200000', true, 500),
      sample(1, '0.600000', false, 1000),
      sample(2, '0.210000', true, 1500),
    ],
    ...overrides,
  };
}

describe('MeasurementChart', () => {
  let factory: FakeMeasurementChartFactory;

  beforeEach(async () => {
    factory = new FakeMeasurementChartFactory();
    await TestBed.configureTestingModule({
      imports: [MeasurementChart],
      providers: [{ provide: MEASUREMENT_CHART_FACTORY, useValue: factory }],
    }).compileComponents();
  });

  function create(
    step: MeasurementChartStep = chartStep(),
    selectedSample: MeasurementSelection | null = null,
  ) {
    const fixture = TestBed.createComponent(MeasurementChart);
    fixture.componentRef.setInput('runId', RUN_ID);
    fixture.componentRef.setInput('planName', 'Power rail verification');
    fixture.componentRef.setInput('step', step);
    fixture.componentRef.setInput('selectedSample', selectedSample);
    fixture.detectChanges();
    TestBed.tick();
    fixture.detectChanges();
    return fixture;
  }

  function firstHandle(): FakeMeasurementChartHandle {
    const handle = factory.created[0];
    if (handle === undefined) {
      throw new Error('The measurement chart was not created.');
    }

    return handle;
  }

  function text(fixture: ReturnType<typeof create>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('creates one chart instance and updates it in place instead of recreating it', () => {
    const fixture = create();
    const handle = firstHandle();

    expect(factory.created).toHaveLength(1);
    expect(handle.config.data.datasets[0]?.data).toHaveLength(3);

    fixture.detectChanges();
    TestBed.tick();
    fixture.detectChanges();
    expect(factory.created).toHaveLength(1);

    fixture.componentRef.setInput('selectedSample', { logicalStepId: STEP_ID, sampleIndex: 2 });
    fixture.detectChanges();
    TestBed.tick();

    expect(factory.created).toHaveLength(1);
    expect(handle.updateCalls.length).toBeGreaterThan(0);
    const radii = handle.config.data.datasets[0]?.pointRadius;
    expect(Array.isArray(radii) ? radii[2] : null).toBe(7);
  });

  it('emits logicalStepId and sampleIndex when a chart point is clicked', () => {
    const fixture = create();
    const selections: MeasurementSelection[] = [];
    fixture.componentInstance.sampleSelected.subscribe((selection) => selections.push(selection));

    firstHandle().clickPoint(1);

    expect(selections).toEqual([{ logicalStepId: STEP_ID, sampleIndex: 1 }]);
  });

  it('offers a keyboard-reachable failure list that reaches the same selection', () => {
    const fixture = create();
    const root = fixture.nativeElement as HTMLElement;
    const selections: MeasurementSelection[] = [];
    fixture.componentInstance.sampleSelected.subscribe((selection) => selections.push(selection));

    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('.failure-item'));
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.tagName).toBe('BUTTON');
    expect(buttons[0]?.textContent).toContain('Sample 1');
    expect(buttons[0]?.textContent).toContain('0.600000 A');
    expect(buttons[0]?.textContent).toContain('First failure');
    expect(buttons[0]?.getAttribute('aria-pressed')).toBe('false');

    buttons[0]?.click();

    expect(selections).toEqual([{ logicalStepId: STEP_ID, sampleIndex: 1 }]);
  });

  it('marks the selected failure item and exposes a visible table link', () => {
    const fixture = create(chartStep(), { logicalStepId: STEP_ID, sampleIndex: 1 });
    const root = fixture.nativeElement as HTMLElement;
    const requested: string[] = [];
    fixture.componentInstance.tableViewRequested.subscribe((stepId) => requested.push(stepId));

    const button = root.querySelector<HTMLButtonElement>('.failure-item');
    expect(button?.getAttribute('aria-pressed')).toBe('true');

    const link = root.querySelector<HTMLAnchorElement>('.table-link');
    expect(link?.textContent).toContain('View measurements in the table');
    expect(link?.getAttribute('href')).toBe(`#measurements-table-${RUN_STEP_ID}`);

    const notCancelled = link?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    expect(notCancelled).toBe(false);
    expect(requested).toEqual([STEP_ID]);
  });

  it('applies a selection only to its logical step and clears it when the step changes', () => {
    const firstStep = chartStep();
    const fixture = create(firstStep, { logicalStepId: STEP_ID, sampleIndex: 1 });
    const handle = firstHandle();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('.failure-item')?.getAttribute('aria-pressed')).toBe('true');

    fixture.componentRef.setInput(
      'step',
      chartStep({
        logicalStepId: '99999999-9999-4999-8999-999999999999',
        runStepId: '88888888-8888-4888-8888-888888888888',
      }),
    );
    fixture.detectChanges();
    TestBed.tick();

    expect(factory.created).toHaveLength(1);
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('.failure-item')
        ?.getAttribute('aria-pressed'),
    ).toBe('false');
    const radii = handle.config.data.datasets[0]?.pointRadius;
    expect(Array.isArray(radii) ? radii[1] : null).toBe(6);
  });

  it('resets only the view and announces that recorded data did not change', () => {
    const fixture = create();
    const root = fixture.nativeElement as HTMLElement;
    const handle = firstHandle();

    root.querySelector<HTMLButtonElement>('.reset-view')?.click();
    fixture.detectChanges();
    TestBed.tick();

    expect(handle.resetZoomCalls).toBe(1);
    expect(text(fixture)).toContain('Zooming and panning never changed the recorded values');
    expect(handle.config.data.datasets[0]?.data).toHaveLength(3);
  });

  it('renders an empty series with a text summary and no failure list', () => {
    const fixture = create(
      chartStep({
        measurements: [],
        sampleCount: 0,
        outOfToleranceCount: 0,
        firstFailureSampleIndex: null,
        hasOutOfTolerance: false,
      }),
    );
    const root = fixture.nativeElement as HTMLElement;

    expect(factory.created).toHaveLength(1);
    expect(root.textContent).toContain('No samples were recorded for this step.');
    expect(root.textContent).toContain('no value or result is inferred');
    expect(text(fixture)).toContain('The recorded tolerance is 0.100000 to 0.550000 A');
    expect(root.querySelector('.failure-item')).toBeNull();
    expect(root.querySelector('.table-link')).not.toBeNull();
  });

  it('renders a single sample with equal limits and never marks it failed', () => {
    const fixture = create(
      chartStep({
        minimum: '5.000000',
        maximum: '5.000000',
        measurements: [sample(0, '5.000000', true, 500)],
        sampleCount: 1,
        outOfToleranceCount: 0,
        firstFailureSampleIndex: null,
        hasOutOfTolerance: false,
      }),
    );
    const root = fixture.nativeElement as HTMLElement;

    expect(text(fixture)).toContain('single accepted value 5.000000 A');
    expect(text(fixture)).toContain('No recorded sample is outside tolerance.');
    expect(root.querySelector('.failure-item')).toBeNull();
    expect(factory.created).toHaveLength(1);
  });

  it('describes the canvas and always includes a visually hidden summary', () => {
    const fixture = create();
    const root = fixture.nativeElement as HTMLElement;
    const canvas = root.querySelector<HTMLCanvasElement>('canvas');
    const summary = root.querySelector<HTMLElement>('.visually-hidden[id^="chart-summary-"]');

    expect(canvas?.getAttribute('role')).toBe('img');
    expect(canvas?.getAttribute('aria-label')).toContain('Measurement chart for step 2');
    expect(canvas?.getAttribute('aria-label')).toContain('1 outside tolerance');
    expect(canvas?.getAttribute('aria-describedby')).toBe(summary?.id);
    expect(summary?.textContent).toContain('Normal samples are circles');
  });

  it('destroys the chart instance when the component is destroyed', () => {
    const fixture = create();
    const handle = firstHandle();

    fixture.destroy();

    expect(handle.destroyCalls).toBe(1);
  });

  it('resizes with the container and disconnects the observer on destroy', () => {
    const observerState: {
      callback: (() => void) | null;
      observed: Element | null;
      disconnected: boolean;
    } = { callback: null, observed: null, disconnected: false };

    class TestResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        observerState.callback = () => callback([], this as unknown as ResizeObserver);
      }

      observe(target: Element): void {
        observerState.observed = target;
      }

      unobserve(): void {
        return undefined;
      }

      disconnect(): void {
        observerState.disconnected = true;
      }
    }

    vi.stubGlobal('ResizeObserver', TestResizeObserver);

    try {
      const fixture = create();
      const handle = firstHandle();
      const frame = (fixture.nativeElement as HTMLElement).querySelector('.chart-frame');

      expect(observerState.observed).toBe(frame);
      observerState.callback?.();
      expect(handle.resizeCalls).toBe(1);

      fixture.destroy();
      expect(observerState.disconnected).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
