import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { NotificationService } from '../../shared/notifications/notification.service';
import { CopyPlanDialog, type CopyPlanDialogData } from './copy-plan-dialog';
import type { CopyPlanResponse } from './plans-api.types';

@Component({
  selector: 'app-copy-plan-button',
  imports: [MatButtonModule],
  template: `@if (compact()) {
      <button
        mat-icon-button
        type="button"
        [disabled]="opened()"
        (click)="open()"
        aria-label="Copy as new plan"
        title="Copy as new plan"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          aria-hidden="true"
        >
          <rect x="8" y="8" width="12" height="13" rx="2" />
          <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
        </svg>
      </button>
    } @else {
      <button mat-button type="button" [disabled]="opened()" (click)="open()">
        Copy as new plan
      </button>
    }`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CopyPlanButton {
  readonly versionId = input.required<string>();
  readonly compact = input(false);
  protected readonly opened = signal(false);
  private readonly dialogs = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);

  protected open(): void {
    if (this.opened()) return;
    this.opened.set(true);
    this.dialogs
      .open<CopyPlanDialog, CopyPlanDialogData, CopyPlanResponse>(CopyPlanDialog, {
        data: { versionId: this.versionId() },
        width: '32rem',
        maxWidth: 'calc(100vw - 32px)',
        autoFocus: 'dialog',
        restoreFocus: true,
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        this.opened.set(false);
        if (result !== undefined) {
          this.notifications.success('Independent plan draft created.');
          void this.router.navigate(['/plans', result.planId, 'edit']);
        }
      });
  }
}
