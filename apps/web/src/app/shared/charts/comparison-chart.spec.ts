import type { components } from '@probedesk/api-client';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildComparisonSummary,
  buildComparisonTooltipLines,
  buildComparisonTooltipTitle,
} from './comparison-chart.config';
import { ComparisonChart } from './comparison-chart';
import type { ComparisonChartSeries } from './comparison-chart.types';
import { MEASUREMENT_CHART_FACTORY } from './measurement-chart.factory';
import type { MeasurementChartStep } from './measurement-chart.types';
import {
  FakeMeasurementChartFactory,
  FakeMeasurementChartHandle,
} from './testing/fake-measurement-chart';

type RunMeasurement = components['schemas']['RunMeasurementDto'];

const LEFT_RUN_ID = '11111111-1111-4111-8111-111111111111';
const RIGHT_RUN_ID = '22222222-2222-4222-8222-222222222222';
const STEP_ID = '33333333-3333-4333-8333-333333333333';

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
    runStepId: '44444444-4444-4444-8444-444444444444',
    logicalStepId: STEP_ID,
    position: 1,
    name: 'Output voltage',
    unit: 'V',
    minimum: '4.750000',
    maximum: '5.250000',
    sampleCount: 3,
    outOfToleranceCount: 1,
    firstFailureSampleIndex: 1,
    hasOutOfTolerance: true,
    measurements: [
      sample(0, '5.000000', true, 500),
      sample(1, '5.500000', false, 1000),
      sample(2, '5.100000', true, 1500),
    ],
    ...overrides,
  };
}

function series(
  side: 'left' | 'right',
  overrides: Partial<ComparisonChartSeries> = {},
): ComparisonChartSeries {
  return {
    side,
    runId: side === 'left' ? LEFT_RUN_ID : RIGHT_RUN_ID,
    planName: 'Power rail verification',
    versionNumber: side === 'left' ? 3 : 4,
    step: chartStep(
      side === 'left'
        ? {}
        : {
            runStepId: '55555555-5555-4555-8555-555555555555',
            measurements: [
              sample(0, '5.100000', true, 400),
              sample(1, '5.600000', false, 900),
            ],
            sampleCount: 2,
          },
    ),
    ...overrides,
  };
}

describe('ComparisonChart', () => {
  let factory: FakeMeasurementChartFactory;

  beforeEach(async () => {
    factory = new FakeMeasurementChartFactory();
    await TestBed.configureTestingModule({
      imports: [ComparisonChart],
      providers: [{ provide: MEASUREMENT_CHART_FACTORY, useValue: factory }],
    }).compileComponents();
  });

  function create(
    left: ComparisonChartSeries = series('left'),
    right: ComparisonChartSeries = series('right'),
  ) {
    const fixture = TestBed.createComponent(ComparisonChart);
    fixture.componentRef.setInput('left', left);
    fixture.componentRef.setInput('right', right);
    fixture.detectChanges();
    TestBed.tick();
    fixture.detectChanges();
    return fixture;
  }

  function firstHandle(): FakeMeasurementChartHandle {
    const handle = factory.created[0];
    if (handle === undefined) {
      throw new Error('The comparison chart was not created.');
    }

    return handle;
  }

  function annotations(handle: FakeMeasurementChartHandle): readonly unknown[] {
    const value = handle.config.options?.plugins?.annotation?.annotations;
    return Array.isArray(value) ? value : [];
  }

  function annotationIds(handle: FakeMeasurementChartHandle): string[] {
    return annotations(handle).flatMap((entry) => {
      const id = (entry as { id?: unknown }).id;
      return typeof id === 'string' ? [id] : [];
    });
  }

  function text(fixture: ReturnType<typeof create>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('draws both series from their own elapsedMs with run and version labels', () => {
    const fixture = create();
    const handle = firstHandle();
    const datasets = handle.config.data.datasets;

    expect(factory.created).toHaveLength(1);
    expect(datasets).toHaveLength(2);
    expect(datasets[0]?.label).toContain('Left · Version 3');
    expect(datasets[1]?.label).toContain('Right · Version 4');
    expect(datasets[0]?.data.map((point) => point.x)).toEqual([500, 1000, 1500]);
    expect(datasets[1]?.data.map((point) => point.x)).toEqual([400, 900]);
    expect(text(fixture)).toContain('Both series use their own elapsed milliseconds');
  });

  it('keeps both tolerance bands separate and labelled by run', () => {
    const fixture = create();
    const handle = firstHandle();
    const ids = annotationIds(handle);
    const labels = annotations(handle)
      .flatMap((entry) => {
        const label = (entry as { label?: { content?: unknown } }).label;
        return typeof label?.content === 'string' ? [label.content] : [];
      })
      .join(' | ');

    expect(ids).toContain('left-tolerance-band');
    expect(ids).toContain('right-tolerance-band');
    expect(labels).toContain('Left tolerance 4.750000 – 5.250000 V');
    expect(labels).toContain('Right tolerance 4.750000 – 5.250000 V');
    expect(text(fixture)).toContain('Left tolerance 4.750000 – 5.250000 V');
    expect(text(fixture)).toContain('Right tolerance 4.750000 – 5.250000 V');
  });

  it('toggles only the selected series and leaves the other data and tolerance intact', () => {
    const fixture = create();
    const handle = firstHandle();
    const root = fixture.nativeElement as HTMLElement;
    const rightDataBefore = [...(handle.config.data.datasets[1]?.data ?? [])];
    const leftDataBefore = [...(handle.config.data.datasets[0]?.data ?? [])];

    const rightToggle = root.querySelector<HTMLButtonElement>('[data-side="right"]');
    expect(rightToggle?.getAttribute('aria-pressed')).toBe('true');
    rightToggle?.click();
    fixture.detectChanges();
    TestBed.tick();

    expect(handle.config.data.datasets[1]?.hidden).toBe(true);
    expect(handle.config.data.datasets[0]?.hidden).toBe(false);
    expect(handle.config.data.datasets[0]?.data).toEqual(leftDataBefore);
    expect(handle.config.data.datasets[1]?.data).toEqual(rightDataBefore);
    expect(annotationIds(handle)).toEqual([
      'left-tolerance-band',
      'left-tolerance-minimum',
      'left-tolerance-maximum',
    ]);
    expect(rightToggle?.getAttribute('aria-pressed')).toBe('false');
    expect(text(fixture)).toContain('Right series hidden');
    expect(text(fixture)).toContain('recorded data and backend results did not change');

    rightToggle?.click();
    fixture.detectChanges();
    TestBed.tick();

    expect(handle.config.data.datasets[1]?.hidden).toBe(false);
    expect(annotationIds(handle)).toHaveLength(6);
  });

  it('shows an explicit note when one run recorded no samples', () => {
    const fixture = create(series('left', { step: chartStep({ measurements: [] }) }));

    expect(text(fixture)).toContain('The left run recorded no plottable sample');
    expect(text(fixture)).toContain('without zero-filled left points');
    expect(text(fixture)).toContain('0 recorded samples');
  });

  it('resets only the view and destroys the chart instance', () => {
    const fixture = create();
    const handle = firstHandle();
    const root = fixture.nativeElement as HTMLElement;

    root.querySelector<HTMLButtonElement>('.reset-view')?.click();
    fixture.detectChanges();

    expect(handle.resetZoomCalls).toBe(1);
    expect(text(fixture)).toContain('never changed the recorded values');

    fixture.destroy();
    expect(handle.destroyCalls).toBe(1);
  });

  it('describes the canvas and names the run in tooltip text', () => {
    const fixture = create();
    const root = fixture.nativeElement as HTMLElement;
    const canvas = root.querySelector<HTMLCanvasElement>('canvas');
    const summary = root.querySelector<HTMLElement>('[id^="comparison-chart-summary-"]');
    const left = series('left');
    const right = series('right');
    const point = {
      x: 1000,
      y: 5.5,
      sampleIndex: 1,
      measurement: sample(1, '5.500000', false, 1000),
      side: 'left' as const,
      runId: LEFT_RUN_ID,
      planName: 'Power rail verification',
      versionNumber: 3,
    };

    expect(canvas?.getAttribute('role')).toBe('img');
    expect(canvas?.getAttribute('aria-label')).toContain('Comparison chart for step 1');
    expect(canvas?.getAttribute('aria-describedby')).toBe(summary?.id);
    expect(summary?.textContent).toContain('Both series use their own elapsed milliseconds');

    expect(buildComparisonTooltipTitle(left, point)).toContain('Sample 1');
    expect(buildComparisonTooltipLines(left, point)).toContain(
      'Run: Left run · Version 3 · Power rail verification',
    );
    expect(buildComparisonTooltipLines(right, { ...point, side: 'right' })).toContain(
      'Run: Right run · Version 4 · Power rail verification',
    );
    expect(buildComparisonTooltipLines(left, point)).toContain('Value: 5.500000 V');
    expect(buildComparisonTooltipLines(left, point)).toContain('Elapsed: 1,000 ms');
    expect(
      buildComparisonTooltipLines(left, point).some((line) => line.includes('UTC')),
    ).toBe(true);
    expect(buildComparisonSummary(left, right, { left: true, right: true })).toContain(
      'samples are not aligned by index',
    );
  });
});
