import { InjectionToken } from '@angular/core';
import { Chart } from 'chart.js';
import { registerChartJs } from './chart-js.setup';
import type {
  MeasurementChartConfig,
  MeasurementChartDebug,
  MeasurementChartFactory,
  MeasurementChartHandle,
  MeasurementChartPoint,
} from './measurement-chart.types';

/**
 * Production Chart.js boundary.
 *
 * Construction is isolated here so component tests can provide a fake factory
 * and assert the configuration without a canvas. Chart.js is still the only
 * renderer in the browser; this is not a mock in production code.
 */
export class ChartJsMeasurementChartFactory implements MeasurementChartFactory {
  create(canvas: HTMLCanvasElement, config: MeasurementChartConfig): MeasurementChartHandle {
    registerChartJs();

    const context = canvas.getContext('2d');
    if (context === null) {
      throw new Error('A 2D canvas context is required to render a measurement chart.');
    }

    const chart = new Chart<'line', MeasurementChartPoint[], number>(context, config);

    return {
      update(nextConfig: MeasurementChartConfig): void {
        chart.data = nextConfig.data;
        chart.options = nextConfig.options ?? {};
        chart.update('none');
      },
      resetZoom(): void {
        chart.resetZoom('none');
      },
      resize(): void {
        chart.resize();
      },
      destroy(): void {
        chart.destroy();
      },
      debug: createDebug(chart),
    };
  }
}

function createDebug(
  chart: Chart<'line', MeasurementChartPoint[], number>,
): MeasurementChartDebug {
  function points(): readonly MeasurementChartPoint[] {
    return chart.data.datasets[0]?.data ?? [];
  }

  return {
    pointPixel(sampleIndex) {
      const index = points().findIndex((point) => point.sampleIndex === sampleIndex);
      if (index < 0) {
        return null;
      }

      const element = chart.getDatasetMeta(0).data[index];
      if (element === undefined) {
        return null;
      }

      const position = element as unknown as { x: number; y: number };
      return { x: position.x, y: position.y };
    },
    snapshot() {
      const data = points();
      const xAxis = chart.scales['x'];
      const minimum = xAxis === undefined ? null : xAxis.min;
      const maximum = xAxis === undefined ? null : xAxis.max;
      const dataXs = data.map((point) => point.x);
      const tooltip = chart.tooltip;
      const dataPoints = tooltip?.dataPoints ?? [];
      const activeDataIndex = dataPoints[0]?.dataIndex;
      const activePoint =
        activeDataIndex === undefined ? undefined : data[activeDataIndex];
      const hasTooltip = tooltip !== undefined && tooltip !== null;

      return {
        sampleCount: data.length,
        visibleSampleCount:
          minimum === null || maximum === null
            ? data.length
            : dataXs.filter((x) => x >= minimum && x <= maximum).length,
        dataMin: dataXs.length === 0 ? null : Math.min(...dataXs),
        dataMax: dataXs.length === 0 ? null : Math.max(...dataXs),
        xMin: minimum,
        xMax: maximum,
        zoomed: chart.isZoomedOrPanned(),
        tooltip:
          !hasTooltip
            ? null
            : {
                opacity: tooltip.opacity,
                title: [...(tooltip.title ?? [])],
                body: (tooltip.body ?? []).flatMap((item) => [
                  ...(item.before ?? []),
                  ...(item.lines ?? []),
                  ...(item.after ?? []),
                ]),
                sampleIndex: activePoint?.sampleIndex ?? null,
              },
      };
    },
  };
}

/** Injection boundary used by `MeasurementChart`; tests override this token. */
export const MEASUREMENT_CHART_FACTORY = new InjectionToken<MeasurementChartFactory>(
  'MEASUREMENT_CHART_FACTORY',
  {
    providedIn: 'root',
    factory: () => new ChartJsMeasurementChartFactory(),
  },
);
