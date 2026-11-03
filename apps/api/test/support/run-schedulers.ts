import type { RunScheduler, RunTimer } from '../../src/runs/run-scheduler.js';

type SchedulerMode = 'auto' | 'paused';

interface PendingTimer {
  readonly delayMs: number;
  readonly dueMs: number;
  readonly callback: () => void;
  handle: ReturnType<typeof setTimeout> | null;
  cancelled: boolean;
}

const BASE_EPOCH_MS = Date.parse('2026-01-01T00:00:00.000Z');

/**
 * Deterministic scheduler/clock for integration tests.
 *
 * In `auto` mode timers fire on the next event-loop turn but the reported clock
 * advances by the full requested delay, so elapsedMs and event timestamps keep
 * their production meaning without a real wait. In `paused` mode timers are
 * held until `releasePending()`, which lets a test commit a terminal status
 * before any executor write.
 */
export class ControlledRunScheduler implements RunScheduler {
  private mode: SchedulerMode;
  private epochMs = BASE_EPOCH_MS;
  private monotonic = 0;
  private readonly pending = new Set<PendingTimer>();

  constructor(mode: SchedulerMode = 'auto') {
    this.mode = mode;
  }

  setMode(mode: SchedulerMode): void {
    this.mode = mode;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  now(): Date {
    return new Date(this.epochMs);
  }

  monotonicMs(): number {
    return this.monotonic;
  }

  setTimeout(callback: () => void, delayMs: number): RunTimer {
    const timer: PendingTimer = {
      delayMs,
      dueMs: this.monotonic + delayMs,
      callback,
      handle: null,
      cancelled: false,
    };
    this.pending.add(timer);

    if (this.mode === 'auto') {
      timer.handle = setTimeout(() => {
        if (timer.cancelled) {
          return;
        }
        this.pending.delete(timer);
        this.advance(delayMs);
        callback();
      }, 0);
    }

    return {
      cancel: () => {
        if (timer.cancelled) {
          return;
        }
        timer.cancelled = true;
        if (timer.handle !== null) {
          clearTimeout(timer.handle);
        }
        this.pending.delete(timer);
      },
    };
  }

  /** Fires every currently held timer in due order, advancing the fake clock. */
  releasePending(): void {
    const held = [...this.pending]
      .filter((timer) => !timer.cancelled)
      .sort((left, right) => left.dueMs - right.dueMs);

    for (const timer of held) {
      if (timer.cancelled) {
        continue;
      }
      this.pending.delete(timer);
      this.advance(timer.delayMs);
      timer.callback();
    }
  }

  dispose(): void {
    for (const timer of this.pending) {
      timer.cancelled = true;
      if (timer.handle !== null) {
        clearTimeout(timer.handle);
      }
    }
    this.pending.clear();
  }

  private advance(delayMs: number): void {
    this.epochMs += delayMs;
    this.monotonic += delayMs;
  }
}
