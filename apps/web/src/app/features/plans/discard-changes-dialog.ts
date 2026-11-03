import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';

/**
 * Accessible confirmation shown by the plan editor route guard.
 *
 * "Keep editing" receives initial focus, so pressing Enter or Escape never
 * discards work by accident.
 */
@Component({
  selector: 'app-discard-changes-dialog',
  imports: [MatButtonModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title id="discard-changes-title">Leave without saving?</h2>
    <mat-dialog-content>
      <p>
        This draft has local changes that have not been saved. If you leave now, those changes will
        be lost. A save that is already in progress may still complete on the server.
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" cdkFocusInitial (click)="close(false)">Keep editing</button>
      <button mat-flat-button type="button" class="discard-button" (click)="close(true)">
        Discard changes
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    :host {
      display: block;
      max-width: 460px;
    }

    p {
      margin: 0;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
    }

    .discard-button {
      --mat-button-filled-container-color: var(--mat-sys-error);
      --mat-button-filled-label-text-color: var(--mat-sys-on-error);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiscardChangesDialog {
  private readonly dialogRef = inject(MatDialogRef<DiscardChangesDialog, boolean>);

  protected close(discard: boolean): void {
    this.dialogRef.close(discard);
  }
}
