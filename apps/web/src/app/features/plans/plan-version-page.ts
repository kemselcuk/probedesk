import { DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  afterNextRender,
  computed,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthFacade } from '../../core/auth/auth.facade';
import { NotificationService } from '../../shared/notifications/notification.service';
import { ErrorState } from '../../shared/ui/error-state/error-state';
import { LoadingState } from '../../shared/ui/loading-state/loading-state';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import {
  formatDuration,
  nominalTotals,
} from './plan-draft-form';
import { createDraftErrorGuidance } from './plan-error-guidance';
import type { PlanErrorGuidance } from './plan-error-guidance';
import type { PlanStep } from './plans-api.types';
import { PlansFacade } from './plans.facade';

/**
 * Read-only view of one immutable published revision.
 *
 * The screen deliberately contains no form controls. The only write action is
 * "Start new draft" for a Planner, and it creates a separate draft through
 * POST /api/plans/:id/drafts instead of modifying this version.
 */
@Component({
  selector: 'app-plan-version-page',
  imports: [
    DatePipe,
    DecimalPipe,
    ErrorState,
    LoadingState,
    MatButtonModule,
    MatCardModule,
    PageHeader,
    RouterLink,
  ],
  templateUrl: './plan-version-page.html',
  styleUrl: './plan-version-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlanVersionPage {
  protected readonly facade = inject(PlansFacade);
  protected readonly auth = inject(AuthFacade);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  protected readonly planId = this.route.snapshot.paramMap.get('planId') ?? '';
  protected readonly versionId = this.route.snapshot.paramMap.get('versionId') ?? '';
  protected readonly formatDuration = formatDuration;

  protected readonly isPlanner = computed(() => this.auth.role() === 'PLANNER');
  protected readonly publisher = computed(
    () =>
      this.facade.versions().find((version) => version.id === this.versionId)?.publishedBy ??
      null,
  );
  protected readonly hasOpenDraft = computed(() => (this.facade.plan()?.draft ?? null) !== null);
  protected readonly openDraftRevision = computed(
    () => this.facade.plan()?.draft?.editRevision ?? null,
  );

  protected readonly totals = computed(() => {
    const version = this.facade.version();
    if (version === null) {
      return null;
    }

    return nominalTotals(version.steps.map(toTotalsStep));
  });

  protected readonly headerSubtitle = computed(() => {
    const version = this.facade.version();
    return version === null
      ? 'Read-only, immutable published plan content.'
      : `Version ${version.versionNumber} · ${version.name}`;
  });

  protected readonly canStartNewDraft = computed(
    () =>
      this.isPlanner() &&
      this.facade.planStatus() === 'loaded' &&
      !this.hasOpenDraft() &&
      this.facade.version() !== null &&
      this.facade.createDraftError() === null &&
      !this.facade.createDraftPending(),
  );

  protected readonly createDraftError = computed<PlanErrorGuidance | null>(() => {
    const error = this.facade.createDraftError();
    return error === null ? null : createDraftErrorGuidance(error);
  });

  protected readonly createDraftErrorRequestId = computed(
    () => this.facade.createDraftError()?.requestId ?? null,
  );

  protected readonly createDraftConflictRevision = computed(
    () => this.facade.createDraftError()?.currentRevision ?? null,
  );

  constructor() {
    this.facade
      .loadVersion(this.versionId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => undefined });

    this.facade
      .loadVersions(this.planId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => undefined });

    if (this.isPlanner()) {
      this.facade
        .loadPlan(this.planId)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({ error: () => undefined });
    }
  }

  protected retryVersion(): void {
    this.facade
      .loadVersion(this.versionId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => undefined });
  }

  protected retryPlanState(): void {
    this.facade.clearCreateDraftError();
    this.facade
      .loadPlan(this.planId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => undefined });
  }

  protected retryVersions(): void {
    this.facade
      .loadVersions(this.planId, true)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => undefined });
  }

  protected startNewDraft(): void {
    if (!this.canStartNewDraft()) {
      return;
    }

    const versionNumber = this.facade.version()?.versionNumber ?? 0;
    this.facade
      .createDraft(this.planId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.notifications.success(
            `New draft created from version ${versionNumber}.`,
          );
          void this.router.navigate(['/plans', this.planId, 'edit']);
        },
        error: () => this.focusAfterRender('draft-create-error-panel'),
      });
  }

  private focusAfterRender(elementId: string): void {
    afterNextRender(() => document.getElementById(elementId)?.focus(), { injector: this.injector });
  }
}

function toTotalsStep(step: PlanStep): PlanStep & { readonly clientId: string } {
  return { ...step, clientId: step.logicalStepId };
}
