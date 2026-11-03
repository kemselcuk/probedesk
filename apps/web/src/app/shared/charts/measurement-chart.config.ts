import type { AnnotationOptions } from 'chartjs-plugin-annotation';
import type { ChartEvent, ActiveElement } from 'chart.js';
import type {
  MeasurementChartConfig,
  MeasurementChartPoint,
  MeasurementChartSample,
  MeasurementChartStep,
  MeasurementSelection,
  MeasurementPointStyle,
} from './measurement-chart.types';

/** Palette values are concrete because a canvas cannot resolve CSS variables. */
export const NORMAL_POINT_COLOR = '#00695c';
export const OUTSIDE_POINT_COLOR = '#b3261e';
export const SELECTED_POINT_COLOR = '#1f1f1f';
export const SEQUENCE_LINE_COLOR = '#5f6b73';
export const TOLERANCE_BAND_COLOR = 'rgba(0, 105, 92, 0.08)';
export const TOLERANCE_LINE_COLOR = 'rgba(0, 105, 92, 0.65)';

export interface MeasurementChartConfigInput {
  readonly runId: string;
  readonly planName: string;
  readonly step: MeasurementChartStep;
  readonly selectedSampleIndex: number | null;
  readonly onPointSelected: (selection: MeasurementSelection) => void;
}

export interface ValueDomain {
  readonly min: number;
  readonly max: number;
}

const UTC_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'medium',
  timeZone: 'UTC',
});

/**
 * Numeric projection for plotting only. The API stores decimal strings; this
 * conversion never feeds a tolerance decision. `null` means "not plottable".
 */
export function toPlotNumber(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Maps recorded samples to Chart.js points in the recorded sample order.
 * `y` is only the numeric projection; the original string and the backend
 * `isWithinTolerance` flag stay on the point for tooltips and styling.
 */
export function buildMeasurementChartPoints(
  measurements: readonly MeasurementChartSample[],
): MeasurementChartPoint[] {
  const points: MeasurementChartPoint[] = [];

  for (const measurement of measurements) {
    const value = toPlotNumber(measurement.value);
    if (value === null) {
      continue;
    }

    points.push({
      x: measurement.elapsedMs,
      y: value,
      sampleIndex: measurement.sampleIndex,
      measurement,
    });
  }

  return points;
}

/** Shape plus colour: a failure is a diamond, a normal sample is a circle. */
export function buildMeasurementPointStyles(
  points: readonly MeasurementChartPoint[],
  selectedSampleIndex: number | null,
): MeasurementPointStyle[] {
  return points.map((point) => {
    const failed = !point.measurement.isWithinTolerance;
    const selected = point.sampleIndex === selectedSampleIndex;

    return {
      pointStyle: failed ? 'rectRot' : 'circle',
      pointRadius: selected ? 7 : failed ? 6 : 4,
      pointHoverRadius: selected ? 9 : 7,
      pointBackgroundColor: failed ? OUTSIDE_POINT_COLOR : NORMAL_POINT_COLOR,
      pointBorderColor: selected
        ? SELECTED_POINT_COLOR
        : failed
          ? OUTSIDE_POINT_COLOR
          : NORMAL_POINT_COLOR,
      pointBorderWidth: selected ? 2 : 1,
    };
  });
}

/**
 * Tolerance band and boundary lines, or one line when minimum equals maximum.
 * Values are read from the step snapshot and only converted for drawing.
 */
export function buildToleranceAnnotations(step: MeasurementChartStep): AnnotationOptions[] {
  const minimum = toPlotNumber(step.minimum);
  const maximum = toPlotNumber(step.maximum);
  if (minimum === null || maximum === null) {
    return [];
  }

  if (minimum === maximum) {
    return [
      {
        type: 'line',
        id: 'tolerance-value',
        scaleID: 'y',
        value: minimum,
        borderColor: TOLERANCE_LINE_COLOR,
        borderDash: [8, 4],
        borderWidth: 2,
        label: {
          display: true,
          content: `Tolerance value ${step.minimum} ${step.unit}`,
          position: 'center',
          backgroundColor: 'rgba(255, 255, 255, 0.92)',
          color: OUTSIDE_POINT_COLOR,
          padding: 4,
        },
      },
    ];
  }

  return [
    {
      type: 'box',
      id: 'tolerance-band',
      yMin: minimum,
      yMax: maximum,
      backgroundColor: TOLERANCE_BAND_COLOR,
      borderColor: TOLERANCE_LINE_COLOR,
      borderDash: [6, 4],
      borderWidth: 1,
      label: {
        display: true,
        content: `Tolerance ${step.minimum} – ${step.maximum} ${step.unit}`,
        position: { x: 'end', y: 'center' },
        color: '#004d40',
        padding: 4,
      },
    },
    {
      type: 'line',
      id: 'tolerance-minimum',
      scaleID: 'y',
      value: minimum,
      borderColor: TOLERANCE_LINE_COLOR,
      borderDash: [6, 4],
      borderWidth: 1,
    },
    {
      type: 'line',
      id: 'tolerance-maximum',
      scaleID: 'y',
      value: maximum,
      borderColor: TOLERANCE_LINE_COLOR,
      borderDash: [6, 4],
      borderWidth: 1,
    },
  ];
}

/**
 * Y range that always includes the recorded tolerance, so a band is never
 * clipped when the samples cluster in the middle (or there is one sample).
 */
export function computeValueDomain(
  points: readonly MeasurementChartPoint[],
  step: MeasurementChartStep,
): ValueDomain {
  const values = points.map((point) => point.y);
  const minimum = toPlotNumber(step.minimum);
  const maximum = toPlotNumber(step.maximum);
  if (minimum !== null) {
    values.push(minimum);
  }
  if (maximum !== null) {
    values.push(maximum);
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

export function formatUtcTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return `${value} (UTC)`;
  }

  return `${UTC_FORMATTER.format(parsed)} UTC`;
}

export function buildTooltipTitle(
  step: MeasurementChartStep,
  point: MeasurementChartPoint,
): string {
  return `Sample ${point.sampleIndex} · ${step.name}`;
}

/** Tooltip text: run identity, step, sample, value/unit, elapsed and UTC time. */
export function buildTooltipLines(
  runId: string,
  planName: string,
  step: MeasurementChartStep,
  point: MeasurementChartPoint,
): string[] {
  const measurement = point.measurement;
  return [
    `Run: ${planName} (${runId})`,
    `Step: ${step.position} · ${step.name}`,
    `Sample index: ${measurement.sampleIndex}`,
    `Value: ${measurement.value} ${step.unit}`,
    `Elapsed: ${measurement.elapsedMs.toLocaleString('en-US')} ms`,
    `Recorded (UTC): ${formatUtcTimestamp(measurement.recordedAt)}`,
    measurement.isWithinTolerance ? 'Result: Within tolerance' : 'Result: Outside tolerance',
  ];
}

/**
 * Accessible text equivalent of the chart. Failure counts and the first
 * failure index come from the recorded flags, never from a value comparison.
 */
export function buildMeasurementSummary(
  step: MeasurementChartStep,
  points: readonly MeasurementChartPoint[],
): string {
  const recorded = step.measurements.length;
  const failures = step.measurements.filter((measurement) => !measurement.isWithinTolerance);
  const firstFailure = step.measurements.find((measurement) => !measurement.isWithinTolerance);
  const unplotted = recorded - points.length;

  if (recorded === 0) {
    return `No samples were recorded for step ${step.position}: ${step.name}, unit ${step.unit}. The recorded tolerance is ${step.minimum} to ${step.maximum} ${step.unit}; no result is inferred.`;
  }

  const tolerance =
    step.minimum === step.maximum
      ? `The recorded tolerance is the single accepted value ${step.minimum} ${step.unit}.`
      : `The recorded tolerance is ${step.minimum} to ${step.maximum} ${step.unit}.`;

  const failureText =
    failures.length === 0
      ? 'No recorded sample is outside tolerance.'
      : `${failures.length} recorded sample${failures.length === 1 ? ' is' : 's are'} outside tolerance. First failing sample index: ${firstFailure?.sampleIndex ?? 'not recorded'}.`;

  const unplottedText =
    unplotted > 0
      ? ` ${unplotted} recorded sample${unplotted === 1 ? ' has' : 's have'} a value that could not be plotted; the table and failure list still include ${unplotted === 1 ? 'it' : 'them'}.`
      : '';

  return `Step ${step.position}: ${step.name}, unit ${step.unit}. ${recorded} recorded sample${recorded === 1 ? '' : 's'}. ${tolerance} ${failureText}${unplottedText} Normal samples are circles; outside-tolerance samples are diamonds. All results use the backend tolerance flags.`;
}

export function buildMeasurementChartConfig(
  input: MeasurementChartConfigInput,
): MeasurementChartConfig {
  const { runId, planName, step, selectedSampleIndex, onPointSelected } = input;
  const points = buildMeasurementChartPoints(step.measurements);
  const styles = buildMeasurementPointStyles(points, selectedSampleIndex);
  const domain = computeValueDomain(points, step);

  return {
    type: 'line',
    data: {
      datasets: [
        {
          label: `${step.name} (${step.unit})`,
          data: points,
          parsing: false,
          normalized: true,
          borderColor: SEQUENCE_LINE_COLOR,
          backgroundColor: SEQUENCE_LINE_COLOR,
          borderWidth: 2,
          tension: 0,
          fill: false,
          spanGaps: false,
          pointStyle: styles.map((style) => style.pointStyle),
          pointRadius: styles.map((style) => style.pointRadius),
          pointHoverRadius: styles.map((style) => style.pointHoverRadius),
          pointBackgroundColor: styles.map((style) => style.pointBackgroundColor),
          pointBorderColor: styles.map((style) => style.pointBorderColor),
          pointBorderWidth: styles.map((style) => style.pointBorderWidth),
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
            text: step.unit,
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
          displayColors: false,
          callbacks: {
            title: (items) => {
              const point = points[items[0]?.dataIndex ?? -1];
              return point === undefined ? '' : buildTooltipTitle(step, point);
            },
            label: (item) => {
              const point = points[item.dataIndex];
              return point === undefined ? [] : buildTooltipLines(runId, planName, step, point);
            },
          },
        },
        annotation: {
          annotations: buildToleranceAnnotations(step),
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
      onClick: (_event: ChartEvent, elements: ActiveElement[]) => {
        const element = elements[0];
        if (element === undefined) {
          return;
        }

        const point = points[element.index];
        if (point === undefined) {
          return;
        }

        onPointSelected({
          logicalStepId: step.logicalStepId,
          sampleIndex: point.sampleIndex,
        });
      },
      onHover: (event: ChartEvent, elements: ActiveElement[]) => {
        const target = event.native?.target;
        if (target instanceof HTMLCanvasElement) {
          target.style.cursor = elements.length > 0 ? 'pointer' : 'default';
        }
      },
    },
  };
}
