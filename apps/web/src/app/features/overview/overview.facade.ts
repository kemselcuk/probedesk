import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, map, of, switchMap } from 'rxjs';
import { HttpErrorNormalizer, type ApiErrorView } from '../../core/http/http-error-normalizer';
import { AnalyticsApi, type Overview, type OverviewQuery } from './analytics-api';

@Injectable()
export class OverviewFacade {
  private readonly api = inject(AnalyticsApi);
  private readonly errors = inject(HttpErrorNormalizer);
  private readonly queries = new Subject<OverviewQuery | null>();
  readonly data = signal<Overview | null>(null);
  readonly loading = signal(false);
  readonly error = signal<ApiErrorView | null>(null);
  constructor() {
    this.queries
      .pipe(
        switchMap((query) => {
          if (!query) {
            this.loading.set(false);
            return of({ data: null, error: null });
          }
          this.loading.set(true);
          this.error.set(null);
          this.data.set(null);
          return this.api.overview(query).pipe(
            map((data) => ({ data, error: null })),
            catchError((error: unknown) => of({ data: null, error: this.errors.normalize(error) })),
          );
        }),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe(({ data, error }) => {
        this.data.set(data);
        this.error.set(error);
        this.loading.set(false);
      });
  }
  load(query: OverviewQuery): void {
    this.queries.next(query);
  }
  clear(): void {
    this.queries.next(null);
  }
}
