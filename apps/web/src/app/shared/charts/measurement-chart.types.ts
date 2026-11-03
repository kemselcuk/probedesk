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

/**
 * Read-only view used by the opt-in browser verification hook. It is not used
 * by product screens; Chart.js draws tooltips on the canvas, so a real browser
 * check needs access to the live instance to assert the tooltip text instead
 * of guessing pixels.
 */
export interface MeasurementChartDebugSnapshot {
  readonly sampleCount: number;
  readonly visibleSampleCount: number;
  readonly dataMin: number | null;
  readonly dataMax: number | null;
  readonly xMin: number | null;
  readonly xMax: number | null;
  readonly zoomed: boolean;
  readonly tooltip: {
    readonly opacity: number;
    readonly title: string[];
    readonly body: string[];
    readonly sampleIndex: number | null;
  } | null;
}

export interface MeasurementChartDebug {
  /** Chart-local CSS pixel position of a plotted sample, or null when absent. */
  pointPixel(sampleIndex: number): { readonly x: number; readonly y: number } | null;
  snapshot(): MeasurementChartDebugSnapshot;
}

/** Small boundary around the Chart.js instance so tests never need a canvas. */
export interface MeasurementChartHandle {
  update(config: MeasurementChartConfig): void;
  resetZoom(): void;
  resize(): void;
  destroy(): void;
  /** Only the real Chart.js handle provides browser-verification access. */
  readonly debug?: MeasurementChartDebug;
}

/** Factory injection boundary. Production uses Chart.js; tests use a fake. */
export interface MeasurementChartFactory {
  create(canvas: HTMLCanvasElement, config: MeasurementChartConfig): MeasurementChartHandle;
}
