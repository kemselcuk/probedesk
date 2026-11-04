import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import {
  ApiErrorView,
  HttpErrorNormalizer,
} from '../../core/http/http-error-normalizer';
import type { RunConnectionState } from '../../core/runs/run-events.service';
import { RunEventsService } from '../../core/runs/run-events.service';
import { isTerminalRunEventType } from '../../core/runs/run-event.types';
import type { RunSnapshot } from './runs-api.types';
import { RunsApi } from './runs-api';
import { LIVE_CHART_SCHEDULER } from './live-chart-scheduler';
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
 * The terminal event does not carry every step transition. The final snapshot
 * is the only authoritative source for CANCELLED/NOT_RUN/INTERRUPTED step
 * states, so a transient GET failure gets a few bounded retries before the
 * screen qualifies the remaining RUNNING/PENDING rows as unavailable.
 */
const FINAL_SNAPSHOT_ATTEMPTS = 3;

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
  private readonly chartScheduler = inject(LIVE_CHART_SCHEDULER);

  private readonly snapshotState = signal<RunSnapshot | null>(null);
  private readonly chartSnapshotState = signal<RunSnapshot | null>(null);
  private readonly loadStatusState = signal<LiveRunLoadStatus>('idle');
  private readonly loadErrorState = signal<ApiErrorView | null>(null);
  private readonly connectionState = signal<RunConnectionState>('disconnected');
  private readonly streamErrorState = signal<string | null>(null);
  private readonly finalizingState = signal(false);
  private readonly finalStepStateUnavailableState = signal(false);
  private readonly finalStepStateErrorState = signal<string | null>(null);
  private readonly cancelPendingState = signal(false);
  private readonly cancelErrorState = signal<ApiErrorView | null>(null);

  private runId: string | null = null;
  private cursor = 0;
  private requestSequence = 0;
  private terminalHandled = false;
  private reconciling = false;
  private streamSubscription: Subscription | null = null;
  private visualHandle: number | null = null;

  readonly snapshot = this.snapshotState.asReadonly();
  /**
   * Throttled copy of `snapshot` used only for drawing. The store above already
   * contains every sample; this signal lags by at most one animation frame (or
   * 16 ms) so a fast stream cannot force a chart re-render per event.
   */
  readonly chartSnapshot = this.chartSnapshotState.asReadonly();
  readonly loadStatus = this.loadStatusState.asReadonly();
  readonly loadError = this.loadErrorState.asReadonly();
  readonly connection = this.connectionState.asReadonly();
  readonly streamError = this.streamErrorState.asReadonly();
  readonly finalizing = this.finalizingState.asReadonly();
  readonly finalStepStateUnavailable = this.finalStepStateUnavailableState.asReadonly();
  readonly finalStepStateError = this.finalStepStateErrorState.asReadonly();
  readonly cancelPending = this.cancelPendingState.asReadonly();
  readonly cancelError = this.cancelErrorState.asReadonly();

  readonly isTerminal = computed(() => {
    const run = this.snapshot();
    return run !== null && isTerminalRunStatus(run.status);
  });

  constructor() {
    this.destroyRef.onDestroy(() => this.cancelVisualUpdate());
  }

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
    this.cancelVisualUpdate();
    // Route ids are case-insensitive; the API and committed events use the
    // canonical lowercase form. Keep one canonical key for snapshot requests,
    // stream matching and request-race checks.
    const canonicalRunId = runId.toLowerCase();
    this.runId = canonicalRunId;
    this.cursor = 0;
    this.terminalHandled = false;
    this.reconciling = false;
    this.snapshotState.set(null);
    this.chartSnapshotState.set(null);
    this.loadStatusState.set('loading');
    this.loadErrorState.set(null);
    this.streamErrorState.set(null);
    this.finalizingState.set(false);
    this.finalStepStateUnavailableState.set(false);
    this.finalStepStateErrorState.set(null);
    this.cancelPendingState.set(false);
    this.cancelErrorState.set(null);
    this.connectionState.set('disconnected');

    this.requestSequence += 1;
    const request = this.requestSequence;

    this.api
      .getRun(canonicalRunId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (snapshot) => {
          if (!this.isCurrentRequest(request, canonicalRunId)) {
            return;
          }

          // The stored snapshot is the authority for the canonical id used by
          // the SSE envelope comparison.
          this.runId = snapshot.id.toLowerCase();
          this.publishSnapshot(mergeRunSnapshot(null, snapshot), true);
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
          if (!this.isCurrentRequest(request, canonicalRunId)) {
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
          this.publishSnapshot(
            mergeRunSnapshot(this.snapshot(), snapshot),
            true,
          );
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
      const terminalEvent = isTerminalRunEventType(event.type);
      this.publishSnapshot(result.state.run, terminalEvent);
      this.cursor = result.state.lastEventSequence;

      if (terminalEvent) {
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
          this.publishSnapshot(
            mergeRunSnapshot(this.snapshot(), snapshot),
            true,
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
   * statuses; it is never used to reopen the stream. A transient read failure
   * is retried a bounded number of times. If every attempt fails, the terminal
   * run state is kept and the remaining RUNNING/PENDING rows are marked
   * unavailable rather than presented as current truth.
   */
  private finalizeSnapshot(): void {
    const runId = this.runId;
    if (runId === null) {
      return;
    }

    this.finalizingState.set(true);
    this.finalStepStateUnavailableState.set(false);
    this.finalStepStateErrorState.set(null);
    this.requestSequence += 1;
    const request = this.requestSequence;

    this.fetchFinalSnapshot(runId, request, FINAL_SNAPSHOT_ATTEMPTS);
  }

  private fetchFinalSnapshot(
    runId: string,
    request: number,
    attemptsLeft: number,
  ): void {
    this.api
      .getRun(runId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (snapshot) => {
          if (!this.isCurrentRequest(request, runId)) {
            return;
          }

          this.finalizingState.set(false);
          this.finalStepStateUnavailableState.set(false);
          this.finalStepStateErrorState.set(null);
          this.publishSnapshot(
            mergeRunSnapshot(this.snapshot(), snapshot),
            true,
          );
          this.cursor = Math.max(this.cursor, snapshot.lastEventSequence);
        },
        error: (error: unknown) => {
          if (!this.isCurrentRequest(request, runId)) {
            return;
          }

          if (attemptsLeft > 1) {
            this.fetchFinalSnapshot(runId, request, attemptsLeft - 1);
            return;
          }

          this.finalizingState.set(false);
          this.finalStepStateUnavailableState.set(true);
          this.finalStepStateErrorState.set(
            `${this.errorNormalizer.normalize(error).message} The terminal run state is final, but the final step detail could not be loaded after ${FINAL_SNAPSHOT_ATTEMPTS} attempts. Steps that were still running or pending are marked unavailable, not current progress.`,
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
          this.publishSnapshot(
            mergeRunSnapshot(this.snapshot(), snapshot),
            true,
          );
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

  /**
   * Writes the authoritative store immediately, then either flushes the chart
   * copy now (initial load, reconciliation, terminal, cancel) or schedules one
   * grouped update. A burst of events coalesces into the latest complete
   * snapshot, so no sample can be skipped between visual frames.
   */
  private publishSnapshot(run: RunSnapshot, immediate: boolean): void {
    this.snapshotState.set(run);
    if (immediate) {
      this.flushVisualUpdate();
      return;
    }

    this.scheduleVisualUpdate();
  }

  private scheduleVisualUpdate(): void {
    if (this.visualHandle !== null) {
      return;
    }

    this.visualHandle = this.chartScheduler.request(() => {
      this.visualHandle = null;
      this.flushVisualUpdate();
    });
  }

  private flushVisualUpdate(): void {
    this.cancelVisualUpdate();
    const run = this.snapshotState();
    if (run !== null) {
      this.chartSnapshotState.set(run);
    }
  }

  private cancelVisualUpdate(): void {
    if (this.visualHandle === null) {
      return;
    }

    this.chartScheduler.cancel(this.visualHandle);
    this.visualHandle = null;
  }

  private stopStream(): void {
    this.streamSubscription?.unsubscribe();
    this.streamSubscription = null;
  }

  private isCurrentRequest(request: number, runId: string): boolean {
    return this.requestSequence === request && this.runId === runId;
  }
}
