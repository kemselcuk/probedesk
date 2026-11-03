import { Chart, LinearScale, LineController, LineElement, PointElement, Tooltip } from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';
import zoomPlugin from 'chartjs-plugin-zoom';

let registered = false;

/**
 * The single Chart.js registration point for the whole web application.
 *
 * Controllers, scales, and the annotation/zoom plugins are registered exactly
 * once. Feature code must never call `Chart.register` itself; it constructs
 * charts through `ChartJsMeasurementChartFactory`, which calls this function.
 */
export function registerChartJs(): void {
  if (registered) {
    return;
  }

  Chart.register(
    LineController,
    LineElement,
    PointElement,
    LinearScale,
    Tooltip,
    annotationPlugin,
    zoomPlugin,
  );

  registered = true;
}
