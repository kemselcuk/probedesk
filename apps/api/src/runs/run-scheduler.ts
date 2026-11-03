import { Injectable } from '@nestjs/common';
import { performance } from 'node:perf_hooks';

/** A cancellable timer; cancelling an already-fired timer is safe. */
export interface RunTimer {
  cancel(): void;
}

/**
 * The execution seam for timers and time. Production uses real timers and the
 * wall/monotonic clocks; tests inject a deterministic implementation so a run
 * can be exercised without waiting for its nominal duration.
 */
export interface RunScheduler {
  /** Real UTC time written to timestamps and event payloads. */
  now(): Date;
  /** Monotonic milliseconds used for the non-negative `elapsedMs` column. */
  monotonicMs(): number;
  setTimeout(callback: () => void, delayMs: number): RunTimer;
}

/** Injection token so tests can replace the production scheduler. */
export const RUN_SCHEDULER = Symbol('RUN_SCHEDULER');

@Injectable()
export class RealRunScheduler implements RunScheduler {
  now(): Date {
    return new Date();
  }

  monotonicMs(): number {
    return performance.now();
  }

  setTimeout(callback: () => void, delayMs: number): RunTimer {
    const handle = setTimeout(callback, delayMs);
    let cancelled = false;

    return {
      cancel: () => {
        if (cancelled) {
          return;
        }
        cancelled = true;
        clearTimeout(handle);
      },
    };
  }
}
