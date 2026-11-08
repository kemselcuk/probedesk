import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, map, of, switchMap } from 'rxjs';
import { HttpErrorNormalizer, type ApiErrorView } from '../../core/http/http-error-normalizer';
import { DevicesApi, type DevicePage, type DeviceQuery } from './devices-api';

/** Each list owns its request stream; switching filters cancels the older request. */
@Injectable()
export class DevicesFacade {
  private readonly api = inject(DevicesApi);
  private readonly errors = inject(HttpErrorNormalizer);
  private readonly queries = new Subject<DeviceQuery>();
  readonly page = signal<DevicePage | null>(null);
  readonly loading = signal(false);
  readonly error = signal<ApiErrorView | null>(null);

  constructor() {
    this.queries
      .pipe(
        switchMap((query) => {
          this.loading.set(true);
          this.error.set(null);
          this.page.set(null);
          return this.api.list(query).pipe(
            map((page) => ({ page, error: null })),
            catchError((error: unknown) => of({ page: null, error: this.errors.normalize(error) })),
          );
        }),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe(({ page, error }) => {
        this.page.set(page);
        this.error.set(error);
        this.loading.set(false);
      });
  }

  load(query: DeviceQuery): void {
    this.queries.next(query);
  }
}
