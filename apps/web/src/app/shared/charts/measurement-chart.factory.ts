import { InjectionToken } from '@angular/core';
import { Chart } from 'chart.js';
import { registerChartJs } from './chart-js.setup';
import type {
  MeasurementChartConfig,
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
    };
  }
}

/** Injection boundary used by `MeasurementChart`; tests override this token. */
export const MEASUREMENT_CHART_FACTORY = new InjectionToken<MeasurementChartFactory>(
  'MEASUREMENT_CHART_FACTORY',
  {
    providedIn: 'root',
    factory: () => new ChartJsMeasurementChartFactory(),
  },
);
