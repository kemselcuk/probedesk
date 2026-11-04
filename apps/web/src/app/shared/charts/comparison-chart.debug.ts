import type { MeasurementChartDebug } from './measurement-chart.types';

/**
 * Opt-in registry for the real-canvas comparison verification (P6/P7).
 *
 * Enabled only when the verification browser sets
 * `window.__probedeskChartDebug = true` before the application boots. Product
 * runs never enable it.
 */
export interface ComparisonChartDebugEntry {
  readonly canvas: HTMLCanvasElement;
  readonly leftVersionNumber: number;
  readonly rightVersionNumber: number;
  readonly leftStepName: string;
  readonly rightStepName: string;
  readonly debug: MeasurementChartDebug;
}

interface ComparisonChartDebugGlobal {
  __probedeskChartDebug?: boolean;
  __probedeskComparisonCharts?: ComparisonChartDebugEntry[];
}

function debugGlobal(): ComparisonChartDebugGlobal {
  return globalThis as unknown as ComparisonChartDebugGlobal;
}

export function isComparisonChartDebugEnabled(): boolean {
  return debugGlobal().__probedeskChartDebug === true;
}

export function registerComparisonChartDebugEntry(
  entry: ComparisonChartDebugEntry,
): void {
  const target = debugGlobal();
  const entries = target.__probedeskComparisonCharts ?? [];
  target.__probedeskComparisonCharts = [...entries, entry];
}

export function unregisterComparisonChartDebugEntry(
  entry: ComparisonChartDebugEntry,
): void {
  const target = debugGlobal();
  const entries = target.__probedeskComparisonCharts;
  if (entries === undefined) {
    return;
  }

  target.__probedeskComparisonCharts = entries.filter(
    (candidate) => candidate !== entry,
  );
}
