import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';

export interface CancelRunDialogData {
  readonly planName: string;
  readonly versionNumber: number;
  readonly recordedSampleCount: number;
  readonly expectedSampleCount: number;
}

/**
 * Confirmation for stopping a running run.
 *
 * The dialog never cancels anything itself. "Keep running" receives initial
 * focus so Enter and Escape do not stop the run by accident, and the screen
 * waits for the server response before it shows a terminal state.
 */
@Component({
  selector: 'app-cancel-run-dialog',
  imports: [MatButtonModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title id="cancel-run-title">Cancel this run?</h2>
    <mat-dialog-content>
      <p id="cancel-run-description">
        <strong>{{ data.planName }}</strong> version {{ data.versionNumber }} is running.
        {{ data.recordedSampleCount }} of {{ data.expectedSampleCount }} expected samples have been
        recorded so far.
      </p>
      <p>
        The run stops only after the server confirms the cancellation. Samples that were already
        recorded and completed steps stay in the record. Steps that have not started will not run.
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" id="cancel-run-keep" cdkFocusInitial (click)="close(false)">
        Keep running
      </button>
      <button mat-flat-button type="button" id="cancel-run-confirm" (click)="close(true)">
        Cancel run
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    :host {
      display: block;
      max-width: 33rem;
    }

    p {
      margin: 0 0 12px;
      color: var(--pd-text-secondary);
      font-size: var(--pd-font-body-size);
      line-height: var(--pd-font-body-relaxed-line);
    }

    p:last-child {
      margin-bottom: 0;
    }

    strong {
      color: var(--pd-text);
    }

    #cancel-run-confirm {
      --mat-button-filled-container-color: var(--pd-danger);
      --mat-button-filled-label-text-color: #ffffff;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CancelRunDialog {
  protected readonly data = inject<CancelRunDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<CancelRunDialog, boolean>);

  protected close(cancel: boolean): void {
    this.dialogRef.close(cancel);
  }
}
