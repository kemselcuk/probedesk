import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, tap, throwError } from 'rxjs';
import {
  ApiErrorView,
  HttpErrorNormalizer,
} from '../../core/http/http-error-normalizer';
import { RunsApi } from '../runs/runs-api';
import type { RunHistoryItem, RunHistoryPage } from '../runs/runs-api.types';
import { ComparisonsApi } from './comparisons-api';
import type { ComparisonResult } from './comparisons-api.types';

export type ComparisonRequestStatus = 'idle' | 'loading' | 'loaded' | 'error';

/** Recent runs offered by the Compare Runs selection panel. */
const RUN_OPTIONS_QUERY = { page: 1, limit: 100 } as const;

/**
 * RxJS facade for the comparison read and its run picker.
 *
 * Both reads carry a local sequence number. A late response for an older pair
 * or an older option list is discarded before it can touch a signal. The
 * facade never derives a verdict and never fills a missing run or step; the
 * API response and its error body remain the source of truth.
 */
@Injectable({ providedIn: 'root' })
export class ComparisonsFacade {
  private readonly api = inject(ComparisonsApi);
  private readonly runsApi = inject(RunsApi);
  private readonly errorNormalizer = inject(HttpErrorNormalizer);

  private readonly resultState = signal<ComparisonResult | null>(null);
  private readonly statusState = signal<ComparisonRequestStatus>('idle');
  private readonly errorState = signal<ApiErrorView | null>(null);

  private readonly runOptionsState = signal<readonly RunHistoryItem[]>([]);
  private readonly runOptionsTotalState = signal(0);
  private readonly runOptionsStatusState = signal<ComparisonRequestStatus>('idle');
  private readonly runOptionsErrorState = signal<ApiErrorView | null>(null);

  private requestSequence = 0;
  private runOptionsSequence = 0;

  readonly result = this.resultState.asReadonly();
  readonly status = this.statusState.asReadonly();
  readonly error = this.errorState.asReadonly();

  readonly runOptions = this.runOptionsState.asReadonly();
  readonly runOptionsTotal = this.runOptionsTotalState.asReadonly();
  readonly runOptionsStatus = this.runOptionsStatusState.asReadonly();
  readonly runOptionsError = this.runOptionsErrorState.asReadonly();

  load(leftRunId: string, rightRunId: string): Observable<ComparisonResult> {
    this.requestSequence += 1;
    const requestSequence = this.requestSequence;

    this.resultState.set(null);
    this.statusState.set('loading');
    this.errorState.set(null);

    return this.api.getComparison(leftRunId, rightRunId).pipe(
      tap((result) => {
        if (!this.isCurrentRequest(requestSequence)) {
          return;
        }

        this.resultState.set(result);
        this.statusState.set('loaded');
        this.errorState.set(null);
      }),
      catchError((error: unknown) => {
        if (this.isCurrentRequest(requestSequence)) {
          this.resultState.set(null);
          this.statusState.set('error');
          this.errorState.set(this.errorNormalizer.normalize(error));
        }

        return throwError(() => error);
      }),
    );
  }

  /**
   * Clears the displayed comparison and invalidates an in-flight read. The
   * Compare screen calls this when the URL no longer names a valid pair.
   */
  clear(): void {
    this.requestSequence += 1;
    this.resultState.set(null);
    this.statusState.set('idle');
    this.errorState.set(null);
  }

  /**
   * Loads the recent-run list used to change the pair. Running runs are kept
   * in the response and disabled by the screen; the facade does not hide them.
   */
  loadRunOptions(): Observable<RunHistoryPage> {
    this.runOptionsSequence += 1;
    const requestSequence = this.runOptionsSequence;

    this.runOptionsStatusState.set('loading');
    this.runOptionsErrorState.set(null);

    return this.runsApi.listRuns(RUN_OPTIONS_QUERY).pipe(
      tap((page) => {
        if (!this.isCurrentRunOptionsRequest(requestSequence)) {
          return;
        }

        this.runOptionsState.set(page.items);
        this.runOptionsTotalState.set(page.total);
        this.runOptionsStatusState.set('loaded');
        this.runOptionsErrorState.set(null);
      }),
      catchError((error: unknown) => {
        if (this.isCurrentRunOptionsRequest(requestSequence)) {
          this.runOptionsState.set([]);
          this.runOptionsTotalState.set(0);
          this.runOptionsStatusState.set('error');
          this.runOptionsErrorState.set(this.errorNormalizer.normalize(error));
        }

        return throwError(() => error);
      }),
    );
  }

  /** Loads options once; an already loaded list is reused. */
  ensureRunOptions(): void {
    const status = this.runOptionsStatusState();
    if (status === 'loaded' || status === 'loading') {
      return;
    }

    this.loadRunOptions().subscribe({ error: () => undefined });
  }

  private isCurrentRequest(requestSequence: number): boolean {
    return this.requestSequence === requestSequence;
  }

  private isCurrentRunOptionsRequest(requestSequence: number): boolean {
    return this.runOptionsSequence === requestSequence;
  }
}
