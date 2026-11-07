import { DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EMPTY, Observable, catchError, merge, switchMap } from 'rxjs';
import { AuthFacade } from '../../core/auth/auth.facade';
import { NotificationService } from '../../shared/notifications/notification.service';
import { ErrorState } from '../../shared/ui/error-state/error-state';
import { LoadingState } from '../../shared/ui/loading-state/loading-state';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { formatDuration, nominalTotals } from './plan-draft-form';
import { createDraftErrorGuidance } from './plan-error-guidance';
import type { PlanErrorGuidance } from './plan-error-guidance';
import type { PlanStep } from './plans-api.types';
import { PlansFacade } from './plans.facade';
import { CopyPlanButton } from './copy-plan-button';

/**
 * Read-only view of one immutable published revision.
 *
 * The screen contains no editable published fields. Planner actions create a
 * new version draft or copy this version into an independent plan.
 */
@Component({
  selector: 'app-plan-version-page',
  imports: [
    CopyPlanButton,
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

  protected readonly deviceContext = signal('');
  private readonly routeState = signal(this.route.snapshot.paramMap);
  protected get planId(): string {
    return this.routeState().get('planId') ?? '';
  }
  protected get versionId(): string {
    return this.routeState().get('versionId') ?? '';
  }
  protected readonly formatDuration = formatDuration;

  protected readonly isPlanner = computed(() => this.auth.role() === 'PLANNER');
  protected readonly isOperator = computed(() => this.auth.role() === 'OPERATOR');
  protected readonly publisher = computed(
    () =>
      this.facade.versions().find((version) => version.id === this.versionId)?.publishedBy ?? null,
  );
  /** The route's plan and the loaded version must describe the same plan. */
  protected readonly versionPlanMismatch = computed(() => {
    const version = this.facade.version();
    return version !== null && version.planId !== this.planId;
  });
  protected readonly latestPublishedVersion = computed(() => {
    const versions = this.facade.versions();
    if (versions.length === 0) {
      return null;
    }

    return versions.reduce((latest, version) =>
      version.versionNumber > latest.versionNumber ? version : latest,
    );
  });
  protected readonly isLatestPublishedVersion = computed(
    () => this.facade.version()?.id === this.latestPublishedVersion()?.id,
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

  protected readonly headerTitle = computed(() => {
    const version = this.facade.version();
    return version === null || version.planId !== this.planId ? 'Published Plan' : version.name;
  });

  protected readonly headerSubtitle = computed(() => {
    const version = this.facade.version();
    if (version === null || version.planId !== this.planId) {
      return 'Read-only, immutable published plan content.';
    }

    return `Version ${version.versionNumber} · Read-only published plan`;
  });

  protected readonly canStartNewDraft = computed(
    () =>
      this.isPlanner() &&
      this.facade.planStatus() === 'loaded' &&
      this.facade.versionsStatus() === 'loaded' &&
      !this.hasOpenDraft() &&
      this.facade.version() !== null &&
      this.isLatestPublishedVersion() &&
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
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = params.get('deviceId') ?? '';
      this.deviceContext.set(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : '',
      );
    });
    this.route.paramMap
      .pipe(
        switchMap((params) => {
          this.routeState.set(params);
          const requests: Observable<unknown>[] = [
            this.facade.loadVersion(this.versionId).pipe(catchError(() => EMPTY)),
            this.facade.loadVersions(this.planId).pipe(catchError(() => EMPTY)),
          ];
          if (this.isPlanner())
            requests.push(this.facade.loadPlan(this.planId).pipe(catchError(() => EMPTY)));
          return merge(...requests);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
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
          this.notifications.success(`New draft created from version ${versionNumber}.`);
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
