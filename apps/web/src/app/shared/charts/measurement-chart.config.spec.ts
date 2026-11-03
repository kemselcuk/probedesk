import { describe, expect, it } from 'vitest';
import type { components } from '@probedesk/api-client';
import type { TooltipItem, TooltipModel } from 'chart.js';
import {
  NORMAL_POINT_COLOR,
  OUTSIDE_POINT_COLOR,
  buildMeasurementChartConfig,
  buildMeasurementChartPoints,
  buildMeasurementPointStyles,
  buildMeasurementSummary,
  buildTooltipLines,
  buildTooltipTitle,
  buildToleranceAnnotations,
  computeValueDomain,
  formatUtcTimestamp,
} from './measurement-chart.config';
import type { MeasurementChartStep } from './measurement-chart.types';

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
    name: 'Output voltage',
    unit: 'V',
    minimum: '4.750000',
    maximum: '5.250000',
    sampleCount: 2,
    outOfToleranceCount: 0,
    firstFailureSampleIndex: null,
    hasOutOfTolerance: false,
    measurements: [sample(0, '4.980000', true, 500), sample(1, '5.010000', true, 1000)],
    ...overrides,
  };
}

function configFor(step: MeasurementChartStep, selectedSampleIndex: number | null = null) {
  return buildMeasurementChartConfig({
    runId: RUN_ID,
    planName: 'Power rail verification',
    step,
    selectedSampleIndex,
    onPointSelected: () => undefined,
  });
}

describe('measurement chart configuration', () => {
  it('maps elapsedMs to X, the numeric value to Y, and the unit to the Y axis', () => {
    const step = chartStep();
    const config = configFor(step);
    const pointSamples = buildMeasurementChartPoints(step.measurements);

    expect(config.type).toBe('line');
    expect(config.data.datasets).toHaveLength(1);
    expect(config.data.datasets[0]?.data.map((point) => ({ x: point.x, y: point.y }))).toEqual([
      { x: 500, y: 4.98 },
      { x: 1000, y: 5.01 },
    ]);
    expect(pointSamples.map((point) => point.sampleIndex)).toEqual([0, 1]);
    expect(config.options?.scales?.['x']?.title).toMatchObject({
      display: true,
      text: 'Elapsed time (ms)',
    });
    expect(config.options?.scales?.['y']?.title).toMatchObject({
      display: true,
      text: 'V',
    });
    expect(config.options?.responsive).toBe(true);
    expect(config.options?.maintainAspectRatio).toBe(false);
  });

  it('uses the backend tolerance flags, not a value comparison, for point styles', () => {
    const step = chartStep({
      measurements: [sample(0, '5.000000', false, 500), sample(1, '5.500000', true, 1000)],
    });
    const points = buildMeasurementChartPoints(step.measurements);
    const styles = buildMeasurementPointStyles(points, null);

    expect(styles[0]).toMatchObject({
      pointStyle: 'rectRot',
      pointBackgroundColor: OUTSIDE_POINT_COLOR,
    });
    expect(styles[1]).toMatchObject({
      pointStyle: 'circle',
      pointBackgroundColor: NORMAL_POINT_COLOR,
    });
  });

  it('draws a tolerance band with boundary lines from the snapshot strings', () => {
    const annotations = buildToleranceAnnotations(chartStep());

    expect(annotations).toHaveLength(3);
    expect(annotations[0]).toMatchObject({
      type: 'box',
      yMin: 4.75,
      yMax: 5.25,
    });
    expect(annotations[1]).toMatchObject({ type: 'line', value: 4.75 });
    expect(annotations[2]).toMatchObject({ type: 'line', value: 5.25 });
    expect(JSON.stringify(annotations)).toContain('Tolerance 4.750000 – 5.250000 V');
  });

  it('draws a single tolerance line when minimum equals maximum and keeps the sample normal', () => {
    const step = chartStep({
      minimum: '5.000000',
      maximum: '5.000000',
      measurements: [sample(0, '5.000000', true, 500)],
    });
    const annotations = buildToleranceAnnotations(step);
    const points = buildMeasurementChartPoints(step.measurements);
    const styles = buildMeasurementPointStyles(points, null);
    const domain = computeValueDomain(points, step);

    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toMatchObject({
      type: 'line',
      value: 5,
    });
    expect(JSON.stringify(annotations)).toContain('Tolerance value 5.000000 V');
    expect(styles[0]?.pointStyle).toBe('circle');
    expect(styles[0]?.pointBackgroundColor).toBe(NORMAL_POINT_COLOR);
    expect(domain.min).toBeLessThan(5);
    expect(domain.max).toBeGreaterThan(5);
    expect(buildMeasurementSummary(step, points)).toContain(
      'The recorded tolerance is the single accepted value 5.000000 V.',
    );
  });

  it('keeps selected points visible with a larger, dark-bordered marker', () => {
    const points = buildMeasurementChartPoints(chartStep().measurements);
    const styles = buildMeasurementPointStyles(points, 1);

    expect(styles[0]?.pointRadius).toBe(4);
    expect(styles[1]).toMatchObject({ pointRadius: 7, pointBorderWidth: 2 });
    expect(styles[1]?.pointBorderColor).not.toBe(NORMAL_POINT_COLOR);
  });

  it('supports an empty series without inventing values', () => {
    const step = chartStep({ measurements: [], sampleCount: 0, outOfToleranceCount: 0 });
    const config = configFor(step);
    const points = buildMeasurementChartPoints(step.measurements);
    const summary = buildMeasurementSummary(step, points);

    expect(points).toEqual([]);
    expect(config.data.datasets[0]?.data).toEqual([]);
    expect(summary).toContain('No samples were recorded for step 2: Output voltage, unit V.');
    expect(summary).toContain('no result is inferred');
    const emptyDomain = computeValueDomain(points, step);
    expect(emptyDomain.min).toBeCloseTo(4.71, 6);
    expect(emptyDomain.max).toBeCloseTo(5.29, 6);
  });

  it('supports a single sample and includes the tolerance in the Y domain', () => {
    const step = chartStep({ measurements: [sample(0, '4.980000', true, 500)], sampleCount: 1 });
    const points = buildMeasurementChartPoints(step.measurements);
    const domain = computeValueDomain(points, step);

    expect(points).toHaveLength(1);
    expect(domain.min).toBeLessThan(4.75);
    expect(domain.max).toBeGreaterThan(5.25);
    expect(buildMeasurementSummary(step, points)).toContain('1 recorded sample.');
  });

  it('formats tooltips with run, step, sample, value/unit, elapsed and UTC time', () => {
    const step = chartStep({
      measurements: [sample(1, '5.250000', false, 1500)],
    });
    const point = buildMeasurementChartPoints(step.measurements)[0];

    expect(point).toBeDefined();
    if (point === undefined) {
      return;
    }

    expect(buildTooltipTitle(step, point)).toBe('Sample 1 · Output voltage');
    const lines = buildTooltipLines(RUN_ID, 'Power rail verification', step, point);
    expect(lines).toContain(`Run: Power rail verification (${RUN_ID})`);
    expect(lines).toContain('Step: 2 · Output voltage');
    expect(lines).toContain('Sample index: 1');
    expect(lines).toContain('Value: 5.250000 V');
    expect(lines).toContain('Elapsed: 1,500 ms');
    expect(lines.some((line) => line.startsWith('Recorded (UTC):'))).toBe(true);
    expect(lines.some((line) => line.endsWith('UTC'))).toBe(true);
    expect(lines).toContain('Result: Outside tolerance');
  });

  it('feeds the tooltip callbacks from the plotted sample at the hovered index', () => {
    const step = chartStep();
    const config = configFor(step);
    const callbacks = config.options?.plugins?.tooltip?.callbacks;
    const title = callbacks?.title;
    const label = callbacks?.label;
    const item = { dataIndex: 1 } as unknown as TooltipItem<'line'>;
    const model = {} as TooltipModel<'line'>;

    expect(typeof title).toBe('function');
    expect(typeof label).toBe('function');
    if (typeof title !== 'function' || typeof label !== 'function') {
      return;
    }

    expect(title.call(model, [item])).toBe('Sample 1 · Output voltage');
    const lines = label.call(model, item);
    expect(Array.isArray(lines)).toBe(true);
    if (!Array.isArray(lines)) {
      return;
    }
    expect(lines).toContain('Value: 5.010000 V');
    expect(lines).toContain('Elapsed: 1,000 ms');
    expect(lines).toContain('Sample index: 1');
  });

  it('formats timestamps in UTC deterministically', () => {
    expect(formatUtcTimestamp('2026-11-03T10:00:02.500Z')).toContain('UTC');
    expect(formatUtcTimestamp('2026-11-03T10:00:02.500Z')).toContain('2026');
    expect(formatUtcTimestamp('not-a-date')).toBe('not-a-date (UTC)');
  });

  it('configures X-only zoom and pan with original-series limits and no data rewrite', () => {
    const config = configFor(chartStep());
    const originalData = config.data.datasets[0]?.data;

    expect(config.options?.plugins?.zoom).toMatchObject({
      pan: { enabled: true, mode: 'x' },
      zoom: { mode: 'x', wheel: { enabled: true }, pinch: { enabled: true } },
      limits: { x: { min: 'original', max: 'original' } },
    });
    expect(config.options?.plugins?.zoom?.limits?.['x']?.minRange).toBeGreaterThan(0);
    expect(config.data.datasets[0]?.data).toBe(originalData);
    expect(buildToleranceAnnotations(chartStep())).toHaveLength(3);
  });

  it('omits unplottable values from the chart but keeps them in the summary count', () => {
    const step = chartStep({
      measurements: [sample(0, 'not-a-number', false, 500)],
    });
    const points = buildMeasurementChartPoints(step.measurements);
    const summary = buildMeasurementSummary(step, points);

    expect(points).toEqual([]);
    expect(summary).toContain('1 recorded sample has a value that could not be plotted');
    expect(summary).toContain('1 recorded sample is outside tolerance');
  });
});
