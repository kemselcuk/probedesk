import type { LiveChartScheduler } from '../live-chart-scheduler';

/**
 * Deterministic scheduler for TestBed. Nothing is flushed until the test
 * calls `flush()`, which makes the data/render split observable.
 */
export class FakeLiveChartScheduler implements LiveChartScheduler {
  readonly pending = new Map<number, () => void>();
  requestCount = 0;
  cancelCount = 0;
  private nextHandle = 1;

  request(callback: () => void): number {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.requestCount += 1;
    this.pending.set(handle, callback);
    return handle;
  }

  cancel(handle: number): void {
    this.cancelCount += 1;
    this.pending.delete(handle);
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  flush(): void {
    const callbacks = [...this.pending.values()];
    this.pending.clear();
    for (const callback of callbacks) {
      callback();
    }
  }
}
