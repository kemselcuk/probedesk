import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, map, of, switchMap } from 'rxjs';
import { HttpErrorNormalizer, type ApiErrorView } from '../../core/http/http-error-normalizer';
import { ReportsApi, type RunReport } from './reports-api';
@Injectable()
export class ReportFacade {
  private readonly api = inject(ReportsApi);
  private readonly errors = inject(HttpErrorNormalizer);
  private readonly requests = new Subject<string | null>();
  readonly data = signal<RunReport | null>(null);
  readonly loading = signal(false);
  readonly error = signal<ApiErrorView | null>(null);
  constructor() {
    this.requests
      .pipe(
        switchMap((id) => {
          this.data.set(null);
          this.error.set(null);
          this.loading.set(id !== null);
          if (!id) return of({ data: null, error: null });
          return this.api.report(id).pipe(
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
  load(id: string | null): void {
    this.requests.next(id);
  }
}
