import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { HttpErrorNormalizer, type ApiErrorView } from '../../core/http/http-error-normalizer';
import { PlansApi } from '../plans/plans-api';
import type { DeviceProfile } from '../plans/plans-api.types';
import { DevicesApi, type Device } from './devices-api';

export function deviceTextLength(max: number, required = true) {
  return (control: AbstractControl<string>): ValidationErrors | null => {
    const length = Array.from(control.value.trim()).length;
    return required && length === 0
      ? { required: true }
      : length > max
        ? { maxlength: true }
        : null;
  };
}

@Component({
  selector: 'app-device-editor-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ source() ? 'Edit device' : 'New device' }}</h2>
    <form [formGroup]="form" (ngSubmit)="save()">
      <mat-dialog-content>
        <p>
          Device names and serial numbers are copied into new runs. Existing run history keeps its
          recorded values.
        </p>
        @if (!source()) {
          <mat-form-field appearance="outline">
            <mat-label>Device profile</mat-label>
            <mat-select formControlName="deviceProfileId" id="device-profile">
              @for (profile of profiles(); track profile.id) {
                <mat-option class="pd-select-option" [value]="profile.id">{{
                  profile.name
                }}</mat-option>
              }
            </mat-select>
            <mat-error>Select a device profile.</mat-error>
          </mat-form-field>
          @if (profilesLoading()) {
            <p role="status">Loading device profiles…</p>
          }
          @if (profilesError()) {
            <p role="alert">{{ profilesError() }}</p>
            <button mat-stroked-button type="button" (click)="loadProfiles()">
              Retry profiles
            </button>
          }
        } @else {
          <p>Device profile is fixed for this device.</p>
        }
        <mat-form-field appearance="outline">
          <mat-label>Device name</mat-label>
          <input matInput id="device-name" formControlName="name" autocomplete="off" />
          <mat-error>{{ fieldMessage('name', 'Enter a name of 1–100 characters.') }}</mat-error>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Serial number</mat-label>
          <input matInput id="device-serial" formControlName="serialNumber" autocomplete="off" />
          <mat-hint>1–100 ASCII letters, digits and ._:/-; case-insensitive identity.</mat-hint>
          <mat-error>{{
            fieldMessage('serialNumber', 'Use 1–100 ASCII letters, digits and ._:/-.')
          }}</mat-error>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Description (optional)</mat-label>
          <textarea
            matInput
            id="device-description"
            formControlName="description"
            rows="3"
          ></textarea>
          <mat-error>{{ fieldMessage('description', 'Use at most 500 characters.') }}</mat-error>
        </mat-form-field>
        @if (error(); as failure) {
          <div role="alert">
            <p>{{ failure.message }}</p>
            @if (failure.requestId) {
              <p class="request-id">Request ID: {{ failure.requestId }}</p>
            }
            @if (failure.code === 'DEVICE_CONFLICT') {
              <p>
                This device changed elsewhere. Load the current device and review its values before
                saving again.
              </p>
              <button mat-stroked-button type="button" (click)="reloadDevice()">
                Load current device
              </button>
            }
          </div>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" [disabled]="pending()" (click)="close()">Cancel</button>
        <button
          mat-flat-button
          type="submit"
          [disabled]="pending() || profilesLoading() || (!source() && profiles().length === 0)"
          [attr.aria-busy]="pending()"
        >
          {{ pending() ? 'Saving…' : 'Save device' }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    :host {
      display: block;
    }
    mat-form-field {
      width: 100%;
      margin-bottom: var(--pd-space-2);
    }
    p {
      margin: 0 0 var(--pd-space-3);
      line-height: var(--pd-font-body-relaxed-line);
      overflow-wrap: anywhere;
    }
    mat-dialog-content {
      padding-top: var(--pd-space-2);
    }
    .request-id {
      font-size: var(--pd-font-meta-size);
      color: var(--pd-text-secondary);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeviceEditorDialog {
  private readonly initial = inject<Device | null>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<DeviceEditorDialog, Device>>(MatDialogRef);
  private readonly api = inject(DevicesApi);
  private readonly plans = inject(PlansApi);
  private readonly normalizer = inject(HttpErrorNormalizer);
  private readonly destroyRef = inject(DestroyRef);
  readonly source = signal(this.initial);
  readonly pending = signal(false);
  readonly error = signal<ApiErrorView | null>(null);
  readonly profiles = signal<readonly DeviceProfile[]>([]);
  readonly profilesLoading = signal(false);
  readonly profilesError = signal<string | null>(null);
  readonly form = inject(NonNullableFormBuilder).group({
    name: [this.initial?.name ?? '', deviceTextLength(100)],
    serialNumber: [
      this.initial?.serialNumber ?? '',
      [deviceTextLength(100), Validators.pattern(/^\s*[A-Za-z0-9._:/-]+\s*$/)],
    ],
    description: [this.initial?.description ?? '', deviceTextLength(500, false)],
    deviceProfileId: [this.initial?.deviceProfileId ?? '', Validators.required],
  });

  constructor() {
    if (!this.initial) this.loadProfiles();
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      for (const control of Object.values(this.form.controls)) {
        if (control.hasError('server')) {
          const { server: _server, ...remaining } = control.errors ?? {};
          control.setErrors(Object.keys(remaining).length ? remaining : null);
        }
      }
    });
  }

  loadProfiles(): void {
    if (this.profilesLoading()) return;
    this.profilesLoading.set(true);
    this.profilesError.set(null);
    this.plans
      .listDeviceProfiles()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (profiles) => {
          this.profiles.set(profiles);
          this.profilesLoading.set(false);
          if (profiles.length === 1) this.form.controls.deviceProfileId.setValue(profiles[0].id);
        },
        error: (error: unknown) => {
          this.profilesLoading.set(false);
          this.profilesError.set(this.normalizer.normalize(error).message);
        },
      });
  }

  save(): void {
    this.form.markAllAsTouched();
    if (this.pending() || this.form.invalid) return;
    const value = this.form.getRawValue();
    const source = this.source();
    this.setPending(true);
    this.error.set(null);
    const fields = {
      name: value.name.trim(),
      serialNumber: value.serialNumber.trim(),
      description: value.description.trim() || null,
    };
    const request = source
      ? this.api.update(source.id, { ...fields, expectedRevision: source.editRevision })
      : this.api.create({ ...fields, deviceProfileId: value.deviceProfileId });
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (device) => this.ref.close(device),
      error: (error: unknown) => {
        this.setPending(false);
        const failure = this.normalizer.normalize(error);
        this.error.set(failure);
        for (const field of failure.fieldErrors) {
          const control = this.form.get(field.path);
          if (control) control.setErrors({ ...control.errors, server: field.message });
        }
      },
    });
  }

  reloadDevice(): void {
    const source = this.source();
    if (!source || this.pending()) return;
    this.setPending(true);
    this.api
      .get(source.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (device) => {
          this.source.set(device);
          this.form.reset({
            name: device.name,
            serialNumber: device.serialNumber,
            description: device.description ?? '',
            deviceProfileId: device.deviceProfileId,
          });
          this.error.set(null);
          this.setPending(false);
        },
        error: (error: unknown) => {
          this.error.set(this.normalizer.normalize(error));
          this.setPending(false);
        },
      });
  }

  fieldMessage(field: 'name' | 'serialNumber' | 'description', fallback: string): string {
    const message: unknown = this.form.controls[field].getError('server');
    return typeof message === 'string' ? message : fallback;
  }
  close(): void {
    if (!this.pending()) this.ref.close();
  }
  private setPending(pending: boolean): void {
    this.pending.set(pending);
    this.ref.disableClose = pending;
    if (pending) this.form.disable({ emitEvent: false });
    else this.form.enable({ emitEvent: false });
  }
}
