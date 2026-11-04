import type { AnnotationOptions } from 'chartjs-plugin-annotation';
import type { MeasurementChartPoint, MeasurementChartStep } from './measurement-chart.types';

/** The two stored runs overlaid on one chart. */
export type ComparisonChartSide = 'left' | 'right';

/**
 * One run's series input. Every field comes from the stored comparison
 * response; the chart never invents a run label or a tolerance.
 */
export interface ComparisonChartSeries {
  readonly side: ComparisonChartSide;
  readonly runId: string;
  readonly planName: string;
  readonly versionNumber: number;
  readonly step: MeasurementChartStep;
}

/**
 * A chart point keeps the run identity and its own elapsedMs. The two series
 * are never aligned by sample index or interpolated.
 */
export interface ComparisonChartPoint extends MeasurementChartPoint {
  readonly side: ComparisonChartSide;
  readonly runId: string;
  readonly planName: string;
  readonly versionNumber: number;
}

/** Visibility is a view-only toggle; it never changes stored data. */
export interface ComparisonSeriesVisibility {
  readonly left: boolean;
  readonly right: boolean;
}

export interface ComparisonPointSelection {
  readonly side: ComparisonChartSide;
  readonly logicalStepId: string;
  readonly sampleIndex: number;
}

export interface ComparisonChartConfigInput {
  readonly left: ComparisonChartSeries;
  readonly right: ComparisonChartSeries;
  readonly visibility: ComparisonSeriesVisibility;
  readonly onPointSelected: (selection: ComparisonPointSelection) => void;
}

/** Annotation list with exactly the visible runs' tolerance rules. */
export type ComparisonToleranceAnnotation = AnnotationOptions;
