import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';

export interface PublishConfirmData {
  readonly planName: string;
  readonly stepCount: number;
}

/**
 * Confirmation for the irreversible publish action.
 *
 * Publishing closes the draft and creates an immutable version, so "Keep
 * editing" receives initial focus. Escape and the close action never publish.
 */
@Component({
  selector: 'app-publish-confirm-dialog',
  imports: [MatButtonModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title id="publish-confirm-title">Publish this draft?</h2>
    <mat-dialog-content>
      <p id="publish-confirm-description">
        <strong>{{ data.planName }}</strong> will be published with
        {{ data.stepCount }} {{ data.stepCount === 1 ? 'step' : 'steps' }}.
      </p>
      <p>
        Only the last saved draft is published. The draft will close and the new version cannot be
        edited. To change it later, start a new draft from the published version.
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" cdkFocusInitial (click)="close(false)">Keep editing</button>
      <button mat-flat-button type="button" (click)="close(true)">Publish version</button>
    </mat-dialog-actions>
  `,
  styles: `
    :host {
      display: block;
      max-width: 520px;
    }

    p {
      margin: 0 0 12px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
    }

    p:last-child {
      margin-bottom: 0;
    }

    strong {
      color: var(--mat-sys-on-surface);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublishConfirmDialog {
  protected readonly data = inject<PublishConfirmData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<PublishConfirmDialog, boolean>);

  protected close(publish: boolean): void {
    this.dialogRef.close(publish);
  }
}
