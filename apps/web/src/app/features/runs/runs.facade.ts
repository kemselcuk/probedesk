import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { EMPTY, Observable, catchError, finalize, throwError } from 'rxjs';
import {
  ApiErrorView,
  HttpErrorNormalizer,
} from '../../core/http/http-error-normalizer';
import { RunsApi } from './runs-api';
import type { RunStartResponse, StartRunRequest } from './runs-api.types';

/**
 * The normalized failure of POST /api/runs plus the one safe detail the start
 * screen needs: the id of the run that is already active.
 */
export interface RunStartErrorView {
  readonly error: ApiErrorView;
  readonly activeRunId: string | null;
}

/**
 * RxJS facade for the run start action.
 *
 * The facade owns pending and failure state as signals. A second start while
 * one is pending returns EMPTY, so the component cannot create two requests.
 */
@Injectable({ providedIn: 'root' })
export class RunsFacade {
  private readonly api = inject(RunsApi);
  private readonly errorNormalizer = inject(HttpErrorNormalizer);

  private readonly startPendingState = signal(false);
  private readonly startErrorState = signal<RunStartErrorView | null>(null);

  readonly startPending = this.startPendingState.asReadonly();
  readonly startError = this.startErrorState.asReadonly();

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
