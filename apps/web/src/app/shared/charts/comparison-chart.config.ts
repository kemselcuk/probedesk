import type { AnnotationOptions } from 'chartjs-plugin-annotation';
import {
  OUTSIDE_POINT_COLOR,
  buildMeasurementChartPoints,
  formatUtcTimestamp,
  toPlotNumber,
} from './measurement-chart.config';
import type {
  MeasurementChartConfig,
  MeasurementChartPoint,
  MeasurementChartStep,
  MeasurementPointStyle,
} from './measurement-chart.types';
import type {
  ComparisonChartConfigInput,
  ComparisonChartPoint,
  ComparisonChartSeries,
  ComparisonSeriesVisibility,
} from './comparison-chart.types';

export const LEFT_SERIES_COLOR = '#2563eb';
export const RIGHT_SERIES_COLOR = '#b45309';
export const LEFT_BAND_COLOR = 'rgba(37, 99, 235, 0.10)';
export const LEFT_LINE_COLOR = 'rgba(37, 99, 235, 0.78)';
export const RIGHT_BAND_COLOR = 'rgba(180, 83, 9, 0.08)';
export const RIGHT_LINE_COLOR = 'rgba(180, 83, 9, 0.78)';

export function comparisonSeriesLabel(series: ComparisonChartSeries): string {
  const side = series.side === 'left' ? 'Left' : 'Right';
  return `${side} · Version ${series.versionNumber} · ${series.planName}`;
}

/**
 * Builds the points for one series from its own measurements. `x` is that
 * run's elapsedMs, so the two series are never index-aligned or interpolated.
 */
export function buildComparisonSeriesPoints(
  series: ComparisonChartSeries,
): ComparisonChartPoint[] {
  return buildMeasurementChartPoints(series.step.measurements).map((point) => ({
    ...point,
    side: series.side,
    runId: series.runId,
    planName: series.planName,
    versionNumber: series.versionNumber,
  }));
}

/** Shape plus colour: failures stay red diamonds; the run uses its line colour. */
export function buildComparisonPointStyles(
  points: readonly ComparisonChartPoint[],
  seriesColor: string,
): MeasurementPointStyle[] {
  return points.map((point) => {
    const failed = !point.measurement.isWithinTolerance;
    return {
      pointStyle: failed ? 'rectRot' : 'circle',
      pointRadius: failed ? 6 : 4,
      pointHoverRadius: 7,
      pointBackgroundColor: failed ? OUTSIDE_POINT_COLOR : seriesColor,
      pointBorderColor: failed ? OUTSIDE_POINT_COLOR : seriesColor,
      pointBorderWidth: 1,
    };
  });
}

/**
 * Tolerance band or single-value line for one run. Both runs keep their own
 * copied limits; hiding a series also hides only that run's tolerance marks.
 */
export function buildRunToleranceAnnotations(
  series: ComparisonChartSeries,
  visible: boolean,
): AnnotationOptions[] {
  if (!visible) {
    return [];
  }

  const step = series.step;
  const minimum = toPlotNumber(step.minimum);
  const maximum = toPlotNumber(step.maximum);
  if (minimum === null || maximum === null) {
    return [];
  }

  const side = series.side === 'left' ? 'left' : 'right';
  const sideLabel = series.side === 'left' ? 'Left' : 'Right';
  const lineColor = series.side === 'left' ? LEFT_LINE_COLOR : RIGHT_LINE_COLOR;
  const bandColor = series.side === 'left' ? LEFT_BAND_COLOR : RIGHT_BAND_COLOR;

  if (minimum === maximum) {
    return [
      {
        type: 'line',
        id: `${side}-tolerance-value`,
        scaleID: 'y',
        value: minimum,
        borderColor: lineColor,
        borderDash: series.side === 'left' ? [8, 4] : [3, 3],
        borderWidth: 2,
        label: {
          display: true,
          content: `${sideLabel} tolerance value ${step.minimum} ${step.unit}`,
          position: series.side === 'left' ? 'start' : 'end',
          backgroundColor: 'rgba(255, 255, 255, 0.94)',
          color: lineColor,
          padding: 4,
        },
      },
    ];
  }

  return [
    {
      type: 'box',
      id: `${side}-tolerance-band`,
      yMin: minimum,
      yMax: maximum,
      backgroundColor: bandColor,
      borderColor: lineColor,
      borderDash: series.side === 'left' ? [6, 4] : [3, 3],
      borderWidth: 1,
      label: {
        display: true,
        content: `${sideLabel} tolerance ${step.minimum} – ${step.maximum} ${step.unit}`,
        position: { x: series.side === 'left' ? 'end' : 'start', y: 'center' },
        color: lineColor,
        padding: 4,
      },
    },
    {
      type: 'line',
      id: `${side}-tolerance-minimum`,
      scaleID: 'y',
      value: minimum,
      borderColor: lineColor,
      borderDash: series.side === 'left' ? [6, 4] : [3, 3],
      borderWidth: 1,
    },
    {
      type: 'line',
      id: `${side}-tolerance-maximum`,
      scaleID: 'y',
      value: maximum,
      borderColor: lineColor,
      borderDash: series.side === 'left' ? [6, 4] : [3, 3],
      borderWidth: 1,
    },
  ];
}

export function buildComparisonToleranceAnnotations(
  left: ComparisonChartSeries,
  right: ComparisonChartSeries,
  visibility: ComparisonSeriesVisibility,
): AnnotationOptions[] {
  return [
    ...buildRunToleranceAnnotations(left, visibility.left),
    ...buildRunToleranceAnnotations(right, visibility.right),
  ];
}

/**
 * Y range covers both series and both copied tolerances, even while one series
 * is hidden, so toggling never rescales the run that stays visible.
 */
export function computeComparisonValueDomain(
  leftPoints: readonly MeasurementChartPoint[],
  rightPoints: readonly MeasurementChartPoint[],
  leftStep: MeasurementChartStep,
  rightStep: MeasurementChartStep,
): { readonly min: number; readonly max: number } {
  const values = [
    ...leftPoints.map((point) => point.y),
    ...rightPoints.map((point) => point.y),
  ];

  for (const value of [
    leftStep.minimum,
    leftStep.maximum,
    rightStep.minimum,
    rightStep.maximum,
  ]) {
    const parsed = toPlotNumber(value);
    if (parsed !== null) {
      values.push(parsed);
    }
  }

  if (values.length === 0) {
    return { min: 0, max: 1 };
  }

  const lowest = Math.min(...values);
  const highest = Math.max(...values);
  if (lowest === highest) {
    const padding = lowest === 0 ? 1 : Math.abs(lowest) * 0.05;
    return { min: lowest - padding, max: highest + padding };
  }

  const padding = (highest - lowest) * 0.08;
  return { min: lowest - padding, max: highest + padding };
}

export function buildComparisonTooltipTitle(
  series: ComparisonChartSeries,
  point: ComparisonChartPoint,
): string {
  return `Sample ${point.sampleIndex} · ${series.step.name}`;
}

/** Tooltip names the run and version before the stored sample facts. */
export function buildComparisonTooltipLines(
  series: ComparisonChartSeries,
  point: ComparisonChartPoint,
): string[] {
  const side = series.side === 'left' ? 'Left run' : 'Right run';
  const measurement = point.measurement;

  return [
    `Run: ${side} · Version ${series.versionNumber} · ${series.planName}`,
    `Run ID: ${series.runId}`,
    `Step: ${series.step.position} · ${series.step.name}`,
    `Sample index: ${measurement.sampleIndex}`,
    `Value: ${measurement.value} ${series.step.unit}`,
    `Elapsed: ${measurement.elapsedMs.toLocaleString('en-US')} ms`,
    `Recorded (UTC): ${formatUtcTimestamp(measurement.recordedAt)}`,
    measurement.isWithinTolerance ? 'Result: Within tolerance' : 'Result: Outside tolerance',
  ];
}

/** Accessible equivalent of the two-series canvas. */
export function buildComparisonSummary(
  left: ComparisonChartSeries,
  right: ComparisonChartSeries,
  visibility: ComparisonSeriesVisibility,
): string {
  const leftPoints = buildComparisonSeriesPoints(left);
  const rightPoints = buildComparisonSeriesPoints(right);
  const leftFailures = left.step.measurements.filter(
    (measurement) => !measurement.isWithinTolerance,
  ).length;
  const rightFailures = right.step.measurements.filter(
    (measurement) => !measurement.isWithinTolerance,
  ).length;

  const describe = (
    label: string,
    series: ComparisonChartSeries,
    points: readonly ComparisonChartPoint[],
    failures: number,
    visible: boolean,
  ) => {
    const state = visible ? 'shown' : 'hidden';
    const tolerance =
      series.step.minimum === series.step.maximum
        ? `single accepted value ${series.step.minimum} ${series.step.unit}`
        : `${series.step.minimum} to ${series.step.maximum} ${series.step.unit}`;
    return `${label} run, version ${series.versionNumber}, is ${state}: ${points.length} recorded sample${points.length === 1 ? '' : 's'}, ${failures} outside tolerance, tolerance ${tolerance}`;
  };

  return `Comparison chart for step ${left.step.position}: ${left.step.name}, unit ${left.step.unit}. ${describe('Left', left, leftPoints, leftFailures, visibility.left)}. ${describe('Right', right, rightPoints, rightFailures, visibility.right)}. Both series use their own elapsed milliseconds on the X axis; samples are not aligned by index. Normal samples are circles, outside-tolerance samples are diamonds, and each run has its own dashed tolerance band.`;
}

export function buildComparisonChartConfig(
  input: ComparisonChartConfigInput,
): MeasurementChartConfig {
  const { left, right, visibility, onPointSelected } = input;
  const leftPoints = buildComparisonSeriesPoints(left);
  const rightPoints = buildComparisonSeriesPoints(right);
  const domain = computeComparisonValueDomain(
    leftPoints,
    rightPoints,
    left.step,
    right.step,
  );
  const leftStyles = buildComparisonPointStyles(leftPoints, LEFT_SERIES_COLOR);
  const rightStyles = buildComparisonPointStyles(rightPoints, RIGHT_SERIES_COLOR);

  return {
    type: 'line',
    data: {
      datasets: [
        {
          label: comparisonSeriesLabel(left),
          data: leftPoints,
          parsing: false,
          normalized: true,
          hidden: !visibility.left,
          borderColor: LEFT_SERIES_COLOR,
          backgroundColor: LEFT_SERIES_COLOR,
          borderWidth: 2,
          tension: 0,
          fill: false,
          spanGaps: false,
          pointStyle: leftStyles.map((style) => style.pointStyle),
          pointRadius: leftStyles.map((style) => style.pointRadius),
          pointHoverRadius: leftStyles.map((style) => style.pointHoverRadius),
          pointBackgroundColor: leftStyles.map((style) => style.pointBackgroundColor),
          pointBorderColor: leftStyles.map((style) => style.pointBorderColor),
          pointBorderWidth: leftStyles.map((style) => style.pointBorderWidth),
        },
        {
          label: comparisonSeriesLabel(right),
          data: rightPoints,
          parsing: false,
          normalized: true,
          hidden: !visibility.right,
          borderColor: RIGHT_SERIES_COLOR,
          backgroundColor: RIGHT_SERIES_COLOR,
          borderWidth: 2,
          borderDash: [6, 3],
          tension: 0,
          fill: false,
          spanGaps: false,
          pointStyle: rightStyles.map((style) => style.pointStyle),
          pointRadius: rightStyles.map((style) => style.pointRadius),
          pointHoverRadius: rightStyles.map((style) => style.pointHoverRadius),
          pointBackgroundColor: rightStyles.map((style) => style.pointBackgroundColor),
          pointBorderColor: rightStyles.map((style) => style.pointBorderColor),
          pointBorderWidth: rightStyles.map((style) => style.pointBorderWidth),
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: {
        mode: 'nearest',
        intersect: true,
      },
      layout: {
        padding: { top: 8, right: 12 },
      },
      scales: {
        x: {
          type: 'linear',
          title: {
            display: true,
            text: 'Elapsed time (ms)',
          },
          grid: {
            color: 'rgba(0, 0, 0, 0.06)',
          },
          ticks: {
            maxRotation: 0,
          },
        },
        y: {
          type: 'linear',
          min: domain.min,
          max: domain.max,
          title: {
            display: true,
            text: left.step.unit,
          },
          grid: {
            color: 'rgba(0, 0, 0, 0.06)',
          },
          ticks: {
            maxTicksLimit: 8,
          },
        },
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          enabled: true,
          displayColors: true,
          callbacks: {
            title: (items) => {
              const item = items[0];
              if (item === undefined) {
                return '';
              }

              const series = item.datasetIndex === 1 ? right : left;
              const points = item.datasetIndex === 1 ? rightPoints : leftPoints;
              const point = points[item.dataIndex];
              return point === undefined ? '' : buildComparisonTooltipTitle(series, point);
            },
            label: (item) => {
              const series = item.datasetIndex === 1 ? right : left;
              const points = item.datasetIndex === 1 ? rightPoints : leftPoints;
              const point = points[item.dataIndex];
              return point === undefined ? [] : buildComparisonTooltipLines(series, point);
            },
          },
        },
        annotation: {
          annotations: buildComparisonToleranceAnnotations(left, right, visibility),
        },
        zoom: {
          pan: {
            enabled: true,
            mode: 'x',
          },
          zoom: {
            mode: 'x',
            wheel: {
              enabled: true,
            },
            pinch: {
              enabled: true,
            },
          },
          limits: {
            x: {
              min: 'original',
              max: 'original',
              minRange: 1,
            },
          },
        },
      },
      onClick: (_event, elements) => {
        const element = elements[0];
        if (element === undefined) {
          return;
        }

        const series = element.datasetIndex === 1 ? right : left;
        const points = element.datasetIndex === 1 ? rightPoints : leftPoints;
        const point = points[element.index];
        if (point === undefined) {
          return;
        }

        onPointSelected({
          side: series.side,
          logicalStepId: series.step.logicalStepId,
          sampleIndex: point.sampleIndex,
        });
      },
      onHover: (event, elements) => {
        const target = event.native?.target;
        if (target instanceof HTMLCanvasElement) {
          target.style.cursor = elements.length > 0 ? 'pointer' : 'default';
        }
      },
    },
  };
}

