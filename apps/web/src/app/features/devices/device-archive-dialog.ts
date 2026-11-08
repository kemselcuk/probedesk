import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { HttpErrorNormalizer, type ApiErrorView } from '../../core/http/http-error-normalizer';
import { DevicesApi, type Device } from './devices-api';

@Component({
  selector: 'app-device-archive-dialog',
  imports: [MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>{{ device.archivedAt ? 'Restore device?' : 'Archive device?' }}</h2>
    <mat-dialog-content>
      <p>
        <strong>{{ device.name }}</strong> · {{ device.serialNumber }}
      </p>
      <p>
        {{
          device.archivedAt
            ? 'Restoring makes this device available for new runs again.'
            : 'Archiving removes this device from new run selection. Existing runs and their recorded device values remain available.'
        }}
      </p>
      @if (error(); as failure) {
        <div role="alert">
          <p>{{ failure.message }}</p>
          @if (failure.code === 'DEVICE_CONFLICT') {
            <p>Close this dialog and refresh the device before trying again.</p>
          }
          @if (failure.requestId) {
            <p>Request ID: {{ failure.requestId }}</p>
          }
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" [disabled]="pending()" (click)="close()">Cancel</button>
      <button
        mat-flat-button
        type="button"
        [disabled]="pending() || error()?.code === 'DEVICE_CONFLICT'"
        [attr.aria-busy]="pending()"
        (click)="confirm()"
      >
        {{ pending() ? 'Saving…' : device.archivedAt ? 'Restore device' : 'Archive device' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    p {
      margin: 0 0 var(--pd-space-3);
      line-height: var(--pd-font-body-relaxed-line);
      overflow-wrap: anywhere;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeviceArchiveDialog {
  readonly device = inject<Device>(MAT_DIALOG_DATA);
  readonly pending = signal(false);
  readonly error = signal<ApiErrorView | null>(null);
  private readonly api = inject(DevicesApi);
  private readonly ref = inject<MatDialogRef<DeviceArchiveDialog, Device>>(MatDialogRef);
  private readonly errors = inject(HttpErrorNormalizer);
  private readonly destroyRef = inject(DestroyRef);
  confirm(): void {
    if (this.pending() || this.error()?.code === 'DEVICE_CONFLICT') return;
    this.pending.set(true);
    this.error.set(null);
    this.ref.disableClose = true;
    this.api
      .setArchived(this.device, this.device.archivedAt === null)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (device) => this.ref.close(device),
        error: (error: unknown) => {
          this.pending.set(false);
          this.ref.disableClose = false;
          this.error.set(this.errors.normalize(error));
        },
      });
  }
  close(): void {
    if (!this.pending()) this.ref.close();
  }
}
