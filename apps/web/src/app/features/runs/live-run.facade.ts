import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import {
  ApiErrorView,
  HttpErrorNormalizer,
} from '../../core/http/http-error-normalizer';
import type { RunConnectionState } from '../../core/runs/run-events.service';
import { RunEventsService } from '../../core/runs/run-events.service';
import type { RunSnapshot } from './runs-api.types';
import { RunsApi } from './runs-api';
import {
  applyRunEvent,
  isTerminalRunStatus,
  mergeRunSnapshot,
} from './live-run.reducer';
import type { LiveRunState } from './live-run.reducer';

export type LiveRunLoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

/** One row of the recent-measurements table, joined with its step rules. */
export interface RecentLiveMeasurement {
  readonly stepPosition: number;
  readonly stepName: string;
  readonly unit: string;
  readonly sampleIndex: number;
  readonly value: string;
  readonly isWithinTolerance: boolean;
  readonly elapsedMs: number;
  readonly recordedAt: string;
}

const RECENT_MEASUREMENT_LIMIT = 20;

/**
 * Live run facade: snapshot loading, the SSE merge, reconnect reconciliation,
 * and server-confirmed cancellation.
 *
 * The facade is provided by the Live Run screen, so leaving the route destroys
 * its subscriptions (and therefore the EventSource) without touching the run.
 * It never derives a verdict, tolerance flag, average, or statistic; those are
 * rendered exactly as the backend sends them.
 */
@Injectable()
export class LiveRunFacade {
  private readonly api = inject(RunsApi);
  private readonly events = inject(RunEventsService);
  private readonly errorNormalizer = inject(HttpErrorNormalizer);
  private readonly destroyRef = inject(DestroyRef);

  private readonly snapshotState = signal<RunSnapshot | null>(null);
  private readonly loadStatusState = signal<LiveRunLoadStatus>('idle');
  private readonly loadErrorState = signal<ApiErrorView | null>(null);
  private readonly connectionState = signal<RunConnectionState>('disconnected');
  private readonly streamErrorState = signal<string | null>(null);
  private readonly finalizingState = signal(false);
  private readonly cancelPendingState = signal(false);
  private readonly cancelErrorState = signal<ApiErrorView | null>(null);

  private runId: string | null = null;
  private cursor = 0;
  private requestSequence = 0;
  private terminalHandled = false;
  private reconciling = false;
  private streamSubscription: Subscription | null = null;

  readonly snapshot = this.snapshotState.asReadonly();
  readonly loadStatus = this.loadStatusState.asReadonly();
  readonly loadError = this.loadErrorState.asReadonly();
  readonly connection = this.connectionState.asReadonly();
  readonly streamError = this.streamErrorState.asReadonly();
  readonly finalizing = this.finalizingState.asReadonly();
  readonly cancelPending = this.cancelPendingState.asReadonly();
  readonly cancelError = this.cancelErrorState.asReadonly();

  readonly isTerminal = computed(() => {
    const run = this.snapshot();
    return run !== null && isTerminalRunStatus(run.status);
  });

  readonly isRunning = computed(() => this.snapshot()?.status === 'RUNNING');

  readonly progressPercent = computed(() => {
    const run = this.snapshot();
    if (run === null || run.expectedSampleCount === 0) {
      return null;
    }

    return Math.min(
      100,
      Math.round((run.recordedSampleCount / run.expectedSampleCount) * 100),
    );
  });

  /**
   * Newest recorded samples for the accessible live table. The full sample
   * arrays stay in `snapshot`; this only limits the visual tail.
   */
  readonly recentMeasurements = computed<readonly RecentLiveMeasurement[]>(() => {
    const run = this.snapshot();
    if (run === null) {
      return [];
    }

    return run.steps
      .flatMap((step) =>
        step.measurements.map((measurement) => ({
          stepPosition: step.position,
          stepName: step.name,
          unit: step.unit,
          sampleIndex: measurement.sampleIndex,
          value: measurement.value,
          isWithinTolerance: measurement.isWithinTolerance,
          elapsedMs: measurement.elapsedMs,
          recordedAt: measurement.recordedAt,
        })),
      )
      .sort(
        (left, right) =>
          Date.parse(right.recordedAt) - Date.parse(left.recordedAt) ||
          right.sampleIndex - left.sampleIndex ||
          right.stepPosition - left.stepPosition,
      )
      .slice(0, RECENT_MEASUREMENT_LIMIT);
  });

  /** Loads a run snapshot and opens the live stream from its cursor. */
  load(runId: string): void {
    this.stopStream();
    this.runId = runId;
    this.cursor = 0;
    this.terminalHandled = false;
    this.reconciling = false;
    this.snapshotState.set(null);
    this.loadStatusState.set('loading');
    this.loadErrorState.set(null);
    this.streamErrorState.set(null);
    this.finalizingState.set(false);
    this.cancelPendingState.set(false);
    this.cancelErrorState.set(null);
    this.connectionState.set('disconnected');

    this.requestSequence += 1;
    const request = this.requestSequence;

    this.api
      .getRun(runId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (snapshot) => {
          if (!this.isCurrentRequest(request, runId)) {
            return;
          }

          this.snapshotState.set(mergeRunSnapshot(null, snapshot));
          this.cursor = snapshot.lastEventSequence;
          this.loadStatusState.set('loaded');
          this.loadErrorState.set(null);

          if (isTerminalRunStatus(snapshot.status)) {
            this.terminalHandled = true;
            this.connectionState.set('disconnected');
            return;
          }

          this.openStream();
        },
        error: (error: unknown) => {
          if (!this.isCurrentRequest(request, runId)) {
            return;
          }

          this.loadStatusState.set('error');
          this.loadErrorState.set(this.errorNormalizer.normalize(error));
          this.connectionState.set('disconnected');
        },
      });
  }

  /** Retries after a failed snapshot or an exhausted reconnect. */
  retry(): void {
    const runId = this.runId;
    if (runId === null) {
      return;
    }

    this.load(runId);
  }

  /**
   * Sends the cancellation request. No local terminal state is written until
   * the server returns the stored snapshot; a failure keeps the run visible as
   * RUNNING and surfaces the server error.
   */
  cancel(): void {
    const runId = this.runId;
    const run = this.snapshot();
    if (
      runId === null ||
      run === null ||
      run.status !== 'RUNNING' ||
      this.cancelPendingState()
    ) {
      return;
    }

    this.cancelPendingState.set(true);
    this.cancelErrorState.set(null);

    this.api
      .cancelRun(runId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (snapshot) => {
          if (this.runId !== runId) {
            return;
          }

          this.cancelPendingState.set(false);
          this.snapshotState.set(mergeRunSnapshot(this.snapshot(), snapshot));
          this.cursor = Math.max(this.cursor, snapshot.lastEventSequence);

          if (isTerminalRunStatus(snapshot.status)) {
            this.terminalHandled = true;
            this.stopStream();
            this.connectionState.set('disconnected');
          }
        },
        error: (error: unknown) => {
          this.cancelPendingState.set(false);
          if (this.runId === runId) {
            this.cancelErrorState.set(this.errorNormalizer.normalize(error));
          }
        },
      });
  }

  clearCancelError(): void {
    this.cancelErrorState.set(null);
  }

  private openStream(): void {
    const runId = this.runId;
    if (
      runId === null ||
      this.terminalHandled ||
      !this.isRunning()
    ) {
      return;
    }

    this.stopStream();
    this.streamErrorState.set(null);
    this.connectionState.set('connecting');

    this.streamSubscription = this.events
      .connect(runId, this.cursor)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (update) => {
          if (this.runId !== runId) {
            return;
          }

          if (update.type === 'connection') {
            this.connectionState.set(update.state);
            return;
          }

          if (update.type === 'error') {
            this.streamErrorState.set(update.message);
            this.refreshAfterStreamFailure();
            return;
          }

          this.handleRunEvent(update.event);
        },
      });
  }

  private handleRunEvent(event: Parameters<typeof applyRunEvent>[1]): void {
    const run = this.snapshot();
    if (run === null) {
      return;
    }

    const current: LiveRunState = {
      run,
      lastEventSequence: this.cursor,
    };
    const result = applyRunEvent(current, event);

    if (result.kind === 'applied') {
      this.snapshotState.set(result.state.run);
      this.cursor = result.state.lastEventSequence;

      if (event.type === 'run.completed') {
        this.finishTerminal();
      } else if (
        event.type === 'run.cancelled' ||
        event.type === 'run.interrupted' ||
        event.type === 'run.errored'
      ) {
        this.finishTerminal();
      }

      return;
    }

    if (result.kind === 'gap') {
      this.reconcileGap();
    }
  }

  /**
   * A forward sequence gap means the client missed committed events. The only
   * safe recovery is a fresh snapshot; the stream is reopened from the new
   * snapshot cursor, so no event is guessed or applied twice.
   */
  private reconcileGap(): void {
    const runId = this.runId;
    if (runId === null || this.reconciling) {
      return;
    }

    this.reconciling = true;
    this.stopStream();
    this.connectionState.set('reconnecting');
    this.streamErrorState.set(
      'The live stream skipped an event. Reloading the server snapshot before continuing.',
    );

    this.requestSequence += 1;
    const request = this.requestSequence;

    this.api
      .getRun(runId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (snapshot) => {
          if (!this.isCurrentRequest(request, runId)) {
            return;
          }

          this.reconciling = false;
          this.snapshotState.set(
            mergeRunSnapshot(this.snapshot(), snapshot),
          );
          // Never move the applied cursor backwards. A snapshot read can race
          // the stream; resuming from the higher applied cursor replays only
          // events the reducer has not seen (duplicates are ignored).
          this.cursor = Math.max(this.cursor, snapshot.lastEventSequence);
          this.streamErrorState.set(null);

          if (isTerminalRunStatus(snapshot.status)) {
            this.terminalHandled = true;
            this.connectionState.set('disconnected');
            return;
          }

          // The stream was stopped before the snapshot request. Reopening with
          // the applied cursor restarts the transport at exactly this cursor,
          // even if another consumer kept a session with a further cursor.
          this.openStream();
        },
        error: (error: unknown) => {
          if (!this.isCurrentRequest(request, runId)) {
            return;
          }

          this.reconciling = false;
          this.connectionState.set('disconnected');
          this.streamErrorState.set(
            `${this.errorNormalizer.normalize(error).message} Live updates are stopped.`,
          );
        },
      });
  }

  private finishTerminal(): void {
    if (this.terminalHandled) {
      return;
    }

    this.terminalHandled = true;
    this.stopStream();
    this.connectionState.set('disconnected');
    this.finalizeSnapshot();
  }

  /**
   * The terminal event carries counters and the verdict but not every step
   * transition. One final snapshot fills the cancelled/interrupted step
   * statuses; it is never used to reopen the stream.
   */
  private finalizeSnapshot(): void {
    const runId = this.runId;
    if (runId === null) {
      return;
    }

    this.finalizingState.set(true);
    this.requestSequence += 1;
    const request = this.requestSequence;

    this.api
      .getRun(runId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (snapshot) => {
          if (!this.isCurrentRequest(request, runId)) {
            return;
          }

          this.finalizingState.set(false);
          this.snapshotState.set(mergeRunSnapshot(this.snapshot(), snapshot));
          this.cursor = Math.max(this.cursor, snapshot.lastEventSequence);
        },
        error: (error: unknown) => {
          if (!this.isCurrentRequest(request, runId)) {
            return;
          }

          this.finalizingState.set(false);
          this.streamErrorState.set(
            `${this.errorNormalizer.normalize(error).message} The terminal event is shown; the final step snapshot could not be loaded.`,
          );
        },
      });
  }

  /**
   * After a lost stream (retry exhaustion or a protocol error) the screen keeps
   * the last state and asks for one fresh snapshot. It does not silently
   * reconnect, so a broken payload cannot loop forever.
   */
  private refreshAfterStreamFailure(): void {
    const runId = this.runId;
    if (runId === null || this.terminalHandled || this.reconciling) {
      return;
    }

    this.reconciling = true;
    this.requestSequence += 1;
    const request = this.requestSequence;

    this.api
      .getRun(runId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (snapshot) => {
          if (!this.isCurrentRequest(request, runId)) {
            return;
          }

          this.reconciling = false;
          this.snapshotState.set(mergeRunSnapshot(this.snapshot(), snapshot));
          this.cursor = Math.max(this.cursor, snapshot.lastEventSequence);

          if (isTerminalRunStatus(snapshot.status)) {
            this.terminalHandled = true;
            this.connectionState.set('disconnected');
          }
        },
        error: () => {
          this.reconciling = false;
          this.connectionState.set('disconnected');
        },
      });
  }

  private stopStream(): void {
    this.streamSubscription?.unsubscribe();
    this.streamSubscription = null;
  }

  private isCurrentRequest(request: number, runId: string): boolean {
    return this.requestSequence === request && this.runId === runId;
  }
}
