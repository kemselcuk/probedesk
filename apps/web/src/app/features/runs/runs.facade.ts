import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { EMPTY, Observable, catchError, finalize, throwError, tap } from 'rxjs';
import {
  ApiErrorView,
  HttpErrorNormalizer,
} from '../../core/http/http-error-normalizer';
import { RunsApi } from './runs-api';
import type {
  RunSnapshot,
  RunStartResponse,
  StartRunRequest,
} from './runs-api.types';

/**
 * The normalized failure of POST /api/runs plus the one safe detail the start
 * screen needs: the id of the run that is already active.
 */
export interface RunStartErrorView {
  readonly error: ApiErrorView;
  readonly activeRunId: string | null;
}

export type RunsRequestStatus = 'idle' | 'loading' | 'loaded' | 'error';

/**
 * RxJS facade for the run start, detail, refresh, and cancel actions.
 *
 * The facade owns pending and failure state as signals. A second start while
 * one is pending returns EMPTY, so the component cannot create two requests.
 *
 * Snapshot reads are ordered by a local request sequence. A response that
 * belongs to an older selection or an older refresh is discarded, so a slow
 * response can never overwrite the run currently on screen. A cancel response
 * invalidates every snapshot read that started before it.
 */
@Injectable({ providedIn: 'root' })
export class RunsFacade {
  private readonly api = inject(RunsApi);
  private readonly errorNormalizer = inject(HttpErrorNormalizer);

  private readonly startPendingState = signal(false);
  private readonly startErrorState = signal<RunStartErrorView | null>(null);

  private readonly snapshotState = signal<RunSnapshot | null>(null);
  private readonly snapshotStatusState = signal<RunsRequestStatus>('idle');
  private readonly snapshotErrorState = signal<ApiErrorView | null>(null);
  private readonly refreshingState = signal(false);
  private readonly refreshErrorState = signal<ApiErrorView | null>(null);

  private readonly cancelPendingState = signal(false);
  private readonly cancelErrorState = signal<ApiErrorView | null>(null);

  private snapshotRunId: string | null = null;
  private snapshotRequestSequence = 0;

  readonly startPending = this.startPendingState.asReadonly();
  readonly startError = this.startErrorState.asReadonly();

  readonly snapshot = this.snapshotState.asReadonly();
  readonly snapshotStatus = this.snapshotStatusState.asReadonly();
  readonly snapshotError = this.snapshotErrorState.asReadonly();
  readonly refreshing = this.refreshingState.asReadonly();
  readonly refreshError = this.refreshErrorState.asReadonly();

  readonly cancelPending = this.cancelPendingState.asReadonly();
  readonly cancelError = this.cancelErrorState.asReadonly();

  startRun(request: StartRunRequest, idempotencyKey: string): Observable<RunStartResponse> {
    if (this.startPendingState()) {
      return EMPTY;
    }

    this.startPendingState.set(true);
    this.startErrorState.set(null);

    return this.api.startRun(request, idempotencyKey).pipe(
      catchError((error: unknown) => {
        this.startErrorState.set({
          error: this.errorNormalizer.normalize(error),
          activeRunId: readActiveRunId(error),
        });
        return throwError(() => error);
      }),
      finalize(() => this.startPendingState.set(false)),
    );
  }

  clearStartError(): void {
    this.startErrorState.set(null);
  }

  /**
   * Loads one run snapshot. `refresh` keeps the current snapshot visible while
   * the request is in flight and reports failure separately, so a transient
   * refresh failure never blanks an already loaded run.
   */
  loadRun(
    runId: string,
    options: { readonly refresh?: boolean } = {},
  ): Observable<RunSnapshot> {
    const canRefresh =
      options.refresh === true &&
      this.snapshotRunId === runId &&
      this.snapshotState() !== null;

    this.snapshotRequestSequence += 1;
    const requestSequence = this.snapshotRequestSequence;
    this.snapshotRunId = runId;
    this.cancelErrorState.set(null);

    if (canRefresh) {
      this.refreshingState.set(true);
      this.refreshErrorState.set(null);
    } else {
      this.refreshingState.set(false);
      this.snapshotState.set(null);
      this.snapshotStatusState.set('loading');
      this.snapshotErrorState.set(null);
      this.refreshErrorState.set(null);
    }

    return this.api.getRun(runId).pipe(
      tap((snapshot) => {
        if (!this.isCurrentSnapshotRequest(requestSequence, runId)) {
          return;
        }

        this.snapshotState.set(snapshot);
        this.snapshotStatusState.set('loaded');
        this.snapshotErrorState.set(null);
        this.refreshErrorState.set(null);
      }),
      catchError((error: unknown) => {
        if (this.isCurrentSnapshotRequest(requestSequence, runId)) {
          const view = this.errorNormalizer.normalize(error);
          if (canRefresh) {
            this.refreshErrorState.set(view);
          } else {
            this.snapshotStatusState.set('error');
            this.snapshotErrorState.set(view);
          }
        }

        return throwError(() => error);
      }),
      finalize(() => {
        if (canRefresh && this.isCurrentSnapshotRequest(requestSequence, runId)) {
          this.refreshingState.set(false);
        }
      }),
    );
  }

  refreshRun(runId: string): Observable<RunSnapshot> {
    return this.loadRun(runId, { refresh: true });
  }

  /**
   * Sends the cancellation request. The returned snapshot is the server's
   * state and is adopted only after a successful response; no local terminal
   * state is written while the request is pending.
   */
  cancelRun(runId: string): Observable<RunSnapshot> {
    if (this.cancelPendingState()) {
      return EMPTY;
    }

    this.cancelPendingState.set(true);
    this.cancelErrorState.set(null);

    return this.api.cancelRun(runId).pipe(
      tap((snapshot) => {
        if (this.snapshotRunId !== runId) {
          return;
        }

        // Any snapshot read that started before the cancel response is older
        // than the terminal state and must not be applied afterwards.
        this.snapshotRequestSequence += 1;
        this.refreshingState.set(false);
        this.snapshotState.set(snapshot);
        this.snapshotStatusState.set('loaded');
        this.snapshotErrorState.set(null);
        this.refreshErrorState.set(null);
      }),
      catchError((error: unknown) => {
        if (this.snapshotRunId === runId) {
          this.cancelErrorState.set(this.errorNormalizer.normalize(error));
        }
        return throwError(() => error);
      }),
      finalize(() => this.cancelPendingState.set(false)),
    );
  }

  clearCancelError(): void {
    this.cancelErrorState.set(null);
  }

  private isCurrentSnapshotRequest(requestSequence: number, runId: string): boolean {
    return (
      this.snapshotRequestSequence === requestSequence &&
      this.snapshotRunId === runId
    );
  }
}

/**
 * Reads only `details.activeRunId` from a 409 response. Every other detail stays
 * out of the UI; the value is used solely as a link target.
 */
function readActiveRunId(error: unknown): string | null {
  if (!(error instanceof HttpErrorResponse)) {
    return null;
  }

  const body = asRecord(error.error);
  const details = body === null ? null : asRecord(body['details']);
  const activeRunId = details === null ? null : details['activeRunId'];

  return typeof activeRunId === 'string' && activeRunId.length > 0 ? activeRunId : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
