import type { MeasurementChartDebug } from './measurement-chart.types';

/**
 * Opt-in registry for the real-canvas verification script (P5-06).
 *
 * The flag is set by the verification browser before the application boots.
 * Normal product runs never enable it, so no debug API is reachable from the
 * app itself. Tests use the fake chart factory instead of this registry.
 */
export interface MeasurementChartDebugEntry {
  readonly canvas: HTMLCanvasElement;
  readonly runStepId: string;
  readonly logicalStepId: string;
  readonly stepName: string;
  readonly unit: string;
  readonly debug: MeasurementChartDebug;
}

interface ChartDebugGlobal {
  __probedeskChartDebug?: boolean;
  __probedeskCharts?: MeasurementChartDebugEntry[];
}

function debugGlobal(): ChartDebugGlobal {
  return globalThis as unknown as ChartDebugGlobal;
}

export function isChartDebugEnabled(): boolean {
  return debugGlobal().__probedeskChartDebug === true;
}

export function registerChartDebugEntry(entry: MeasurementChartDebugEntry): void {
  const target = debugGlobal();
  const entries = target.__probedeskCharts ?? [];
  target.__probedeskCharts = [...entries, entry];
}

export function unregisterChartDebugEntry(
  entry: MeasurementChartDebugEntry,
): void {
  const target = debugGlobal();
  const entries = target.__probedeskCharts;
  if (entries === undefined) {
    return;
  }

  target.__probedeskCharts = entries.filter((candidate) => candidate !== entry);
}
