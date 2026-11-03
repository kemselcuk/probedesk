import { InjectionToken } from '@angular/core';

/**
 * Schedules the visual chart flush for live measurements.
 *
 * The run store applies every SSE event immediately. Chart re-render only
 * needs to happen once per frame (or one short interval); delaying the visual
 * copy must never delay or drop the data copy. Tests provide a manual
 * implementation so a burst of events can be verified without waiting for a
 * real animation frame.
 */
export interface LiveChartScheduler {
  request(callback: () => void): number;
  cancel(handle: number): void;
}

const hasAnimationFrame =
  typeof requestAnimationFrame === 'function' &&
  typeof cancelAnimationFrame === 'function';

const browserScheduler: LiveChartScheduler = {
  request(callback) {
    if (hasAnimationFrame) {
      return requestAnimationFrame(callback);
    }

    return setTimeout(callback, 16) as unknown as number;
  },
  cancel(handle) {
    if (hasAnimationFrame) {
      cancelAnimationFrame(handle);
      return;
    }

    clearTimeout(handle);
  },
};

/** Default visual scheduler: one animation frame, or a short 16 ms interval. */
export const LIVE_CHART_SCHEDULER = new InjectionToken<LiveChartScheduler>(
  'LIVE_CHART_SCHEDULER',
  {
    providedIn: 'root',
    factory: () => browserScheduler,
  },
);
