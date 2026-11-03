import type { components } from '@probedesk/api-client';
import type { ChartConfiguration, Point } from 'chart.js';

/**
 * Chart view types.
 *
 * They are structural slices of the generated OpenAPI snapshot schema, so the
 * Run Details screen passes the recorded DTOs straight through without a
 * second hand-written measurement model.
 */

/** One recorded sample as returned by the run snapshot endpoint. */
export type MeasurementChartSample = components['schemas']['RunMeasurementDto'];

/** The step fields the chart needs; all values come from the snapshot. */
export type MeasurementChartStep = Pick<
  components['schemas']['RunSnapshotStepDto'],
  | 'runStepId'
  | 'logicalStepId'
  | 'position'
  | 'name'
  | 'unit'
  | 'minimum'
  | 'maximum'
  | 'sampleCount'
  | 'outOfToleranceCount'
  | 'firstFailureSampleIndex'
  | 'hasOutOfTolerance'
  | 'measurements'
>;

/**
 * A logged sample is identified by the logical step plus its run-local sample
 * index. The same identity is used by the chart, failure list, and table row.
 */
export interface MeasurementSelection {
  readonly logicalStepId: string;
  readonly sampleIndex: number;
}

/** A plotted point. `x` is elapsedMs, `y` is the numeric projection only. */
export interface MeasurementChartPoint extends Point {
  readonly x: number;
  readonly y: number;
  readonly sampleIndex: number;
  readonly measurement: MeasurementChartSample;
}

/** Per-point visual state; shape as well as colour distinguishes a failure. */
export interface MeasurementPointStyle {
  readonly pointStyle: 'circle' | 'rectRot';
  readonly pointRadius: number;
  readonly pointHoverRadius: number;
  readonly pointBackgroundColor: string;
  readonly pointBorderColor: string;
  readonly pointBorderWidth: number;
}

export type MeasurementChartConfig = ChartConfiguration<'line', MeasurementChartPoint[], number>;

/** Small boundary around the Chart.js instance so tests never need a canvas. */
export interface MeasurementChartHandle {
  update(config: MeasurementChartConfig): void;
  resetZoom(): void;
  resize(): void;
  destroy(): void;
}

/** Factory injection boundary. Production uses Chart.js; tests use a fake. */
export interface MeasurementChartFactory {
  create(canvas: HTMLCanvasElement, config: MeasurementChartConfig): MeasurementChartHandle;
}
