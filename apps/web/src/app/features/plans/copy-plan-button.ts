import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ViewContainerRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { NavigationEnd, Router } from '@angular/router';
import { filter, takeUntil } from 'rxjs';
import { NotificationService } from '../../shared/notifications/notification.service';
import { CopyPlanDialog, type CopyPlanDialogData } from './copy-plan-dialog';
import type { CopyPlanResponse } from './plans-api.types';
import { PlanCopyActions } from './plan-copy-actions';

@Component({
  selector: 'app-copy-plan-button',
  imports: [MatButtonModule],
  template: `@if (compact()) {
      <button
        mat-icon-button
        type="button"
        [disabled]="opened()"
        (click)="open()"
        [attr.aria-label]="'Copy ' + sourceLabel() + ' as a new plan'"
        [title]="'Copy ' + sourceLabel() + ' as a new plan'"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          aria-hidden="true"
          focusable="false"
        >
          <rect x="8" y="8" width="12" height="13" rx="2" />
          <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
        </svg>
      </button>
    } @else {
      <button
        mat-button
        type="button"
        [disabled]="opened()"
        (click)="open()"
        [attr.aria-label]="'Copy ' + sourceLabel() + ' as a new plan'"
      >
        Copy as new plan
      </button>
    }`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CopyPlanButton {
  readonly versionId = input.required<string>();
  readonly compact = input(false);
  readonly sourceLabel = input('published plan');
  protected readonly opened = signal(false);
  private readonly dialogs = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);
  private readonly actions = inject(PlanCopyActions);
  private readonly viewContainerRef = inject(ViewContainerRef);

  protected open(): void {
    if (this.opened() || this.dialogs.getDialogById('copy-plan-dialog')) return;
    this.opened.set(true);
    const sourceId = this.versionId();
    const ref = this.dialogs.open<CopyPlanDialog, CopyPlanDialogData, CopyPlanResponse>(
      CopyPlanDialog,
      {
        id: 'copy-plan-dialog',
        data: { versionId: sourceId },
        viewContainerRef: this.viewContainerRef,
        width: '32rem',
        maxWidth: 'calc(100vw - 32px)',
        autoFocus: 'dialog',
        restoreFocus: true,
        closeOnNavigation: false,
        ariaLabelledBy: 'copy-plan-title',
        ariaDescribedBy: 'copy-plan-description',
      },
    );
    const unregister = this.destroyRef.onDestroy(() => ref.close());
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntil(ref.afterClosed()),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => ref.close());
    ref
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        unregister();
        this.opened.set(false);
        if (result !== undefined) {
          this.actions.acknowledge(sourceId, result.planId);
          this.notifications.success('Independent plan draft created.');
          void this.router.navigate(['/plans', result.planId, 'edit']);
        }
      });
  }
}
