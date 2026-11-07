import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, map, of, switchMap } from 'rxjs';
import { HttpErrorNormalizer } from '../../core/http/http-error-normalizer';
import { DevicesApi, type Device } from './devices-api';

@Injectable()
export class DevicePickerFacade {
  private readonly api = inject(DevicesApi);
  private readonly errors = inject(HttpErrorNormalizer);
  private readonly selection = new Subject<{ id: string; profileId: string }>();
  readonly device = signal<Device | null>(null);
  readonly checking = signal(false);
  readonly error = signal<string | null>(null);
  constructor() {
    this.selection
      .pipe(
        switchMap(({ id, profileId }) => {
          this.device.set(null);
          this.error.set(null);
          this.checking.set(!!id);
          if (!id) return of({ device: null, error: null });
          return this.api.get(id).pipe(
            map((device) => ({
              device,
              error: device.archivedAt
                ? 'This device is archived. Choose another device or explicitly select No device.'
                : device.deviceProfileId.toLowerCase() !== profileId.toLowerCase()
                  ? 'This device belongs to another profile. Choose a compatible device or select No device.'
                  : null,
            })),
            catchError((error: unknown) =>
              of({ device: null, error: this.errors.normalize(error).message }),
            ),
          );
        }),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe(({ device, error }) => {
        this.device.set(device);
        this.error.set(error);
        this.checking.set(false);
      });
  }
  check(id: string, profileId: string): void {
    this.selection.next({ id, profileId });
  }
}
