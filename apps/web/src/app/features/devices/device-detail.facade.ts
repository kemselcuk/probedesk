import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, map, of, switchMap } from 'rxjs';
import { HttpErrorNormalizer, type ApiErrorView } from '../../core/http/http-error-normalizer';
import { DevicesApi, type Device } from './devices-api';

@Injectable()
export class DeviceDetailFacade {
  private readonly api = inject(DevicesApi);
  private readonly errors = inject(HttpErrorNormalizer);
  private readonly ids = new Subject<string>();
  readonly device = signal<Device | null>(null);
  readonly loading = signal(false);
  readonly error = signal<ApiErrorView | null>(null);
  constructor() {
    this.ids
      .pipe(
        switchMap((id) => {
          this.device.set(null);
          this.error.set(null);
          this.loading.set(true);
          return this.api.get(id).pipe(
            map((device) => ({ device, error: null })),
            catchError((error: unknown) =>
              of({ device: null, error: this.errors.normalize(error) }),
            ),
          );
        }),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe(({ device, error }) => {
        this.device.set(device);
        this.error.set(error);
        this.loading.set(false);
      });
  }
  load(id: string): void {
    this.ids.next(id);
  }
}
