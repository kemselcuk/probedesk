import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, Observable, catchError, finalize, of, tap, throwError } from 'rxjs';
import { ApiErrorView, HttpErrorNormalizer } from '../../core/http/http-error-normalizer';
import { PlansApi } from './plans-api';
import type {
  CreatePlanRequest,
  DeviceProfile,
  PlanDetail,
  PlanDraft,
  PlanSummary,
  PublishedRevision,
  PublishedVersionListItem,
  SaveDraftRequest,
  SaveDraftResult,
} from './plans-api.types';

export type PlansRequestStatus = 'idle' | 'loading' | 'loaded' | 'error';

/**
 * RxJS facade for the plan screens.
 *
 * Screens never call HTTP directly. The facade owns loading, error and pending
 * state as signals while the request lifecycle stays in RxJS.
 */
@Injectable({ providedIn: 'root' })
export class PlansFacade {
  private versionsSequence = 0;
  private versionSequence = 0;
  private readonly api = inject(PlansApi);
  private readonly errorNormalizer = inject(HttpErrorNormalizer);
  private readonly destroyRef = inject(DestroyRef);

  private readonly plansState = signal<readonly PlanSummary[]>([]);
  private readonly plansStatusState = signal<PlansRequestStatus>('idle');
  private readonly plansErrorState = signal<ApiErrorView | null>(null);

  private readonly profilesState = signal<readonly DeviceProfile[]>([]);
  private readonly profilesStatusState = signal<PlansRequestStatus>('idle');
  private readonly profilesErrorState = signal<ApiErrorView | null>(null);

  private readonly createPendingState = signal(false);
  private readonly createErrorState = signal<ApiErrorView | null>(null);

  private readonly planState = signal<PlanDetail | null>(null);
  private readonly planStatusState = signal<PlansRequestStatus>('idle');
  private readonly planErrorState = signal<ApiErrorView | null>(null);

  private readonly savePendingState = signal(false);
  private readonly saveErrorState = signal<ApiErrorView | null>(null);

  private readonly versionsState = signal<readonly PublishedVersionListItem[]>([]);
  private readonly versionsStatusState = signal<PlansRequestStatus>('idle');
  private readonly versionsErrorState = signal<ApiErrorView | null>(null);
  private versionsPlanId: string | null = null;

  private readonly versionState = signal<PublishedRevision | null>(null);
  private readonly versionStatusState = signal<PlansRequestStatus>('idle');
  private readonly versionErrorState = signal<ApiErrorView | null>(null);
  private versionId: string | null = null;

  private readonly publishPendingState = signal(false);
  private readonly publishErrorState = signal<ApiErrorView | null>(null);

  private readonly createDraftPendingState = signal(false);
  private readonly createDraftErrorState = signal<ApiErrorView | null>(null);

  readonly plans = this.plansState.asReadonly();
  readonly plansStatus = this.plansStatusState.asReadonly();
  readonly plansError = this.plansErrorState.asReadonly();

  readonly profiles = this.profilesState.asReadonly();
  readonly profilesStatus = this.profilesStatusState.asReadonly();
  readonly profilesError = this.profilesErrorState.asReadonly();

  readonly createPending = this.createPendingState.asReadonly();
  readonly createError = this.createErrorState.asReadonly();

  readonly plan = this.planState.asReadonly();
  readonly planStatus = this.planStatusState.asReadonly();
  readonly planError = this.planErrorState.asReadonly();

  readonly savePending = this.savePendingState.asReadonly();
  readonly saveError = this.saveErrorState.asReadonly();

  readonly versions = this.versionsState.asReadonly();
  readonly versionsStatus = this.versionsStatusState.asReadonly();
  readonly versionsError = this.versionsErrorState.asReadonly();

  readonly version = this.versionState.asReadonly();
  readonly versionStatus = this.versionStatusState.asReadonly();
  readonly versionError = this.versionErrorState.asReadonly();

  readonly publishPending = this.publishPendingState.asReadonly();
  readonly publishError = this.publishErrorState.asReadonly();

  readonly createDraftPending = this.createDraftPendingState.asReadonly();
  readonly createDraftError = this.createDraftErrorState.asReadonly();

  readonly draftConflict = computed(() => {
    const error = this.saveErrorState();
    return error !== null && error.status === 409 && error.code === 'DRAFT_CONFLICT';
  });

  /** Loads the role-aware list. Calling it again refreshes the visible rows. */
  loadPlans(): void {
    if (this.plansStatusState() === 'loading') {
      return;
    }

    this.plansStatusState.set('loading');
    this.plansErrorState.set(null);

    this.api
      .listPlans()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (plans) => {
          this.plansState.set(plans);
          this.plansStatusState.set('loaded');
        },
        error: (error: unknown) => {
          this.plansStatusState.set('error');
          this.plansErrorState.set(this.errorNormalizer.normalize(error));
        },
      });
  }

  /**
   * Loads the single device profile list. The observable is returned so the
   * caller can select the first profile once the response arrives.
   */
  loadProfiles(): Observable<readonly DeviceProfile[]> {
    if (this.profilesStatusState() === 'loaded') {
      return of(this.profilesState());
    }

    if (this.profilesStatusState() === 'loading') {
      return of(this.profilesState());
    }

    this.profilesStatusState.set('loading');
    this.profilesErrorState.set(null);

    return this.api.listDeviceProfiles().pipe(
      tap((profiles) => {
        this.profilesState.set(profiles);
        this.profilesStatusState.set('loaded');
      }),
      catchError((error: unknown) => {
        this.profilesStatusState.set('error');
        this.profilesErrorState.set(this.errorNormalizer.normalize(error));
        return throwError(() => error);
      }),
      finalize(() => {
        if (this.profilesStatusState() === 'loading') {
          // A cancelled subscription must not leave the dialog permanently
          // disabled; the next open starts a fresh request.
          this.profilesStatusState.set('idle');
        }
      }),
    );
  }

  createPlan(request: CreatePlanRequest): Observable<PlanDetail> {
    if (this.createPendingState()) {
      return EMPTY;
    }

    this.createPendingState.set(true);
    this.createErrorState.set(null);

    return this.api.createPlan(request).pipe(
      catchError((error: unknown) => {
        this.createErrorState.set(this.errorNormalizer.normalize(error));
        return throwError(() => error);
      }),
      finalize(() => this.createPendingState.set(false)),
    );
  }

  clearCreateError(): void {
    this.createErrorState.set(null);
  }

  /** Loads a plan with its open draft for the editor. */
  loadPlan(planId: string): Observable<PlanDetail> {
    this.planStatusState.set('loading');
    this.planErrorState.set(null);
    this.planState.set(null);
    this.publishErrorState.set(null);
    this.createDraftErrorState.set(null);

    return this.api.getPlan(planId).pipe(
      tap((plan) => {
        this.planState.set(plan);
        this.planStatusState.set('loaded');
      }),
      catchError((error: unknown) => {
        this.planStatusState.set('error');
        this.planErrorState.set(this.errorNormalizer.normalize(error));
        return throwError(() => error);
      }),
    );
  }

  saveDraft(planId: string, request: SaveDraftRequest): Observable<SaveDraftResult> {
    if (this.savePendingState()) {
      return EMPTY;
    }

    this.savePendingState.set(true);
    this.saveErrorState.set(null);

    return this.api.saveDraft(planId, request).pipe(
      tap((result) => {
        this.planState.update((plan) =>
          plan === null
            ? plan
            : {
                ...plan,
                name: result.name,
                draft: result,
              },
        );
      }),
      catchError((error: unknown) => {
        this.saveErrorState.set(this.errorNormalizer.normalize(error));
        return throwError(() => error);
      }),
      finalize(() => this.savePendingState.set(false)),
    );
  }

  clearSaveError(): void {
    this.saveErrorState.set(null);
  }

  /**
   * Loads published versions newest first. The list is cached per plan unless
   * `force` asks for the post-publish refresh.
   */
  loadVersions(planId: string, force = false): Observable<readonly PublishedVersionListItem[]> {
    if (this.versionsPlanId !== planId) {
      this.versionsState.set([]);
      this.versionsStatusState.set('idle');
      this.versionsErrorState.set(null);
      this.versionsPlanId = planId;
    }

    if (this.versionsStatusState() === 'loading' && this.versionsPlanId === planId) {
      return of(this.versionsState());
    }

    if (!force && this.versionsStatusState() === 'loaded') {
      return of(this.versionsState());
    }

    const sequence = ++this.versionsSequence;
    this.versionsStatusState.set('loading');
    this.versionsErrorState.set(null);

    return this.api.listVersions(planId).pipe(
      tap((versions) => {
        if (sequence !== this.versionsSequence || this.versionsPlanId !== planId) return;
        this.versionsState.set(versions);
        this.versionsStatusState.set('loaded');
      }),
      catchError((error: unknown) => {
        if (sequence !== this.versionsSequence || this.versionsPlanId !== planId)
          return throwError(() => error);
        this.versionsStatusState.set('error');
        this.versionsErrorState.set(this.errorNormalizer.normalize(error));
        return throwError(() => error);
      }),
      finalize(() => {
        if (
          sequence === this.versionsSequence &&
          this.versionsPlanId === planId &&
          this.versionsStatusState() === 'loading'
        )
          this.versionsStatusState.set('idle');
      }),
    );
  }

  /** Loads one immutable published revision for the read-only screen. */
  loadVersion(versionId: string): Observable<PublishedRevision> {
    if (this.versionStatusState() === 'loading' && this.versionId === versionId) {
      const current = this.versionState();
      return current === null ? EMPTY : of(current);
    }

    if (this.versionStatusState() === 'loaded' && this.versionId === versionId) {
      const current = this.versionState();
      if (current !== null) {
        return of(current);
      }
    }

    const sequence = ++this.versionSequence;
    this.versionId = versionId;
    this.versionState.set(null);
    this.versionStatusState.set('loading');
    this.versionErrorState.set(null);

    return this.api.getVersion(versionId).pipe(
      tap((version) => {
        if (sequence !== this.versionSequence || this.versionId !== versionId) return;
        this.versionState.set(version);
        this.versionStatusState.set('loaded');
      }),
      catchError((error: unknown) => {
        if (sequence !== this.versionSequence || this.versionId !== versionId)
          return throwError(() => error);
        this.versionStatusState.set('error');
        this.versionErrorState.set(this.errorNormalizer.normalize(error));
        return throwError(() => error);
      }),
      finalize(() => {
        if (
          sequence === this.versionSequence &&
          this.versionId === versionId &&
          this.versionStatusState() === 'loading'
        )
          this.versionStatusState.set('idle');
      }),
    );
  }

  publishDraft(planId: string, expectedRevision: number): Observable<PublishedRevision> {
    if (this.publishPendingState()) {
      return EMPTY;
    }

    this.publishPendingState.set(true);
    this.publishErrorState.set(null);
    this.saveErrorState.set(null);

    return this.api.publishDraft(planId, { expectedRevision }).pipe(
      tap((published) => {
        this.planState.update((plan) =>
          plan === null
            ? plan
            : {
                ...plan,
                name: published.name,
                latestPublishedVersion: {
                  id: published.id,
                  versionNumber: published.versionNumber,
                  publishedAt: published.publishedAt,
                },
                published,
                draft: null,
              },
        );
      }),
      catchError((error: unknown) => {
        this.publishErrorState.set(this.errorNormalizer.normalize(error));
        return throwError(() => error);
      }),
      finalize(() => this.publishPendingState.set(false)),
    );
  }

  clearPublishError(): void {
    this.publishErrorState.set(null);
  }

  /** Creates a draft from the latest published version and adopts it as open. */
  createDraft(planId: string): Observable<PlanDraft> {
    if (this.createDraftPendingState()) {
      return EMPTY;
    }

    this.createDraftPendingState.set(true);
    this.createDraftErrorState.set(null);
    this.publishErrorState.set(null);

    return this.api.createDraft(planId).pipe(
      tap((draft) => {
        this.planState.update((plan) =>
          plan === null
            ? plan
            : {
                ...plan,
                name: draft.name,
                draft,
              },
        );
      }),
      catchError((error: unknown) => {
        this.createDraftErrorState.set(this.errorNormalizer.normalize(error));
        return throwError(() => error);
      }),
      finalize(() => this.createDraftPendingState.set(false)),
    );
  }

  clearCreateDraftError(): void {
    this.createDraftErrorState.set(null);
  }
}
