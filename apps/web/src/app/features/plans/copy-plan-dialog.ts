import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { PlanCopyFacade } from './plan-copy.facade';
import { trimmedMaxLength, trimmedRequired } from './plan-draft-form';
import type { CopyPlanResponse } from './plans-api.types';

export interface CopyPlanDialogData {
  readonly versionId: string;
}

@Component({
  selector: 'app-copy-plan-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  providers: [PlanCopyFacade],
  template: `
    <h2 mat-dialog-title id="copy-plan-title">Copy as new plan</h2>
    <form [formGroup]="form" (ngSubmit)="submit()">
      <mat-dialog-content>
        @if (facade.sourceLoading()) {
          <p role="status">Loading the published source…</p>
        } @else if (facade.sourceError(); as error) {
          <div role="alert">
            <p>{{ error.message }}</p>
            @if (error.requestId) {
              <p class="request-id">Request ID: {{ error.requestId }}</p>
            }
            <button mat-stroked-button type="button" (click)="retrySource()">Try again</button>
          </div>
        } @else if (facade.source(); as source) {
          <p class="source">
            <strong>{{ source.name }}</strong> · Version {{ source.versionNumber }}
          </p>
          <p id="copy-plan-description">
            This creates an independent draft with the published steps. The source plan and its run
            history stay unchanged.
          </p>
          <mat-form-field appearance="outline">
            <mat-label>New plan name</mat-label>
            <input
              matInput
              id="copy-plan-name"
              formControlName="name"
              autocomplete="off"
              [readonly]="facade.pending()"
            />
            <mat-hint>Up to 100 characters.</mat-hint>
            @if (form.controls.name.hasError('required')) {
              <mat-error>Enter a plan name.</mat-error>
            } @else if (form.controls.name.hasError('maxlength')) {
              <mat-error>Use at most 100 characters.</mat-error>
            }
          </mat-form-field>
          @if (facade.error(); as error) {
            <div class="inline-error" role="alert">
              <p>{{ error.message }}</p>
              @for (field of error.fieldErrors; track $index) {
                <p>{{ field.message }}</p>
              }
              @if (error.requestId) {
                <p class="request-id">Request ID: {{ error.requestId }}</p>
              }
            </div>
          }
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" [disabled]="facade.pending()" (click)="cancel()">
          Cancel
        </button>
        <button
          mat-flat-button
          type="submit"
          [disabled]="!facade.source() || facade.pending()"
          [attr.aria-busy]="facade.pending()"
        >
          {{ facade.pending() ? 'Creating copy…' : 'Create independent draft' }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    :host {
      display: block;
    }
    mat-dialog-content {
      padding-top: var(--pd-space-2);
    }
    p {
      margin: 0 0 var(--pd-space-3);
      font-size: var(--pd-font-body-size);
      line-height: var(--pd-font-body-relaxed-line);
      color: var(--pd-text-secondary);
      overflow-wrap: anywhere;
    }
    strong {
      color: var(--pd-text);
    }
    mat-form-field {
      width: 100%;
      margin-top: var(--pd-space-2);
    }
    .inline-error {
      margin-top: var(--pd-space-3);
      padding: var(--pd-space-3);
      border-radius: var(--pd-radius-control);
      background: var(--pd-danger-bg);
    }
    .inline-error p {
      color: var(--pd-danger);
    }
    .inline-error p:last-child {
      margin-bottom: 0;
    }
    .request-id {
      font-size: var(--pd-font-meta-size);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CopyPlanDialog {
  protected readonly facade = inject(PlanCopyFacade);
  private readonly data = inject<CopyPlanDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<CopyPlanDialog, CopyPlanResponse>);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly form = inject(NonNullableFormBuilder).group({
    name: ['', [trimmedRequired, trimmedMaxLength(100)]],
  });

  constructor() {
    this.facade.loadSource(this.data.versionId);
    effect(() => {
      const name = this.facade.initialName();
      if (name) this.form.controls.name.setValue(name);
    });
    effect(() => {
      this.ref.disableClose = this.facade.pending();
    });
    effect(() => {
      const result = this.facade.result();
      if (result !== null) this.ref.close(result);
    });
    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.facade.clearError());
  }

  protected retrySource(): void {
    this.facade.loadSource(this.data.versionId);
  }
  protected cancel(): void {
    if (!this.facade.pending()) this.ref.close();
  }
  protected submit(): void {
    this.form.markAllAsTouched();
    if (this.form.valid) this.facade.submit(this.form.getRawValue().name);
  }
}
