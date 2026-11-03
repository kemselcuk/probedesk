import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, tap, throwError } from 'rxjs';
import {
  ApiErrorView,
  HttpErrorNormalizer,
} from '../../core/http/http-error-normalizer';
import { RunsApi } from './runs-api';
import type {
  RunHistoryItem,
  RunHistoryPage,
  RunHistoryQuery,
} from './runs-api.types';

export type RunHistoryRequestStatus = 'idle' | 'loading' | 'loaded' | 'error';

/**
 * RxJS facade for the paginated run history.
 *
 * Every read gets a local sequence number. A response for an older filter,
 * search, or page selection is discarded before it can touch a signal, so a
 * slow response can never overwrite the rows of a newer selection. The facade
 * stores summary rows only; measurement arrays never enter this state.
 */
@Injectable({ providedIn: 'root' })
export class RunHistoryFacade {
  private readonly api = inject(RunsApi);
  private readonly errorNormalizer = inject(HttpErrorNormalizer);

  private readonly statusState = signal<RunHistoryRequestStatus>('idle');
  private readonly itemsState = signal<readonly RunHistoryItem[]>([]);
  private readonly pageState = signal(1);
  private readonly limitState = signal(20);
  private readonly totalState = signal(0);
  private readonly totalPagesState = signal(0);
  private readonly errorState = signal<ApiErrorView | null>(null);

  private requestSequence = 0;

  readonly status = this.statusState.asReadonly();
  readonly items = this.itemsState.asReadonly();
  readonly page = this.pageState.asReadonly();
  readonly limit = this.limitState.asReadonly();
  readonly total = this.totalState.asReadonly();
  readonly totalPages = this.totalPagesState.asReadonly();
  readonly error = this.errorState.asReadonly();

  /**
   * Loads one page. Any response that is not the most recent call is ignored,
   * including its failure state. The caller subscribes for side effects.
   */
  loadHistory(query: RunHistoryQuery): Observable<RunHistoryPage> {
    this.requestSequence += 1;
    const requestSequence = this.requestSequence;

    this.statusState.set('loading');
    this.errorState.set(null);
    this.itemsState.set([]);

    return this.api.listRuns(query).pipe(
      tap((page) => {
        if (!this.isCurrentRequest(requestSequence)) {
          return;
        }

        this.itemsState.set(page.items);
        this.pageState.set(page.page);
        this.limitState.set(page.limit);
        this.totalState.set(page.total);
        this.totalPagesState.set(page.totalPages);
        this.statusState.set('loaded');
        this.errorState.set(null);
      }),
      catchError((error: unknown) => {
        if (this.isCurrentRequest(requestSequence)) {
          this.itemsState.set([]);
          this.totalState.set(0);
          this.totalPagesState.set(0);
          this.statusState.set('error');
          this.errorState.set(this.errorNormalizer.normalize(error));
        }

        return throwError(() => error);
      }),
    );
  }

  private isCurrentRequest(requestSequence: number): boolean {
    return this.requestSequence === requestSequence;
  }
}
