import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, Observable, catchError, finalize, of, tap, throwError } from 'rxjs';
import { ApiErrorView, HttpErrorNormalizer } from '../../core/http/http-error-normalizer';
import { PlansApi } from './plans-api';
import type {
  CreatePlanRequest,
  DeviceProfile,
  PlanDetail,
  PlanSummary,
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

  createPlan(request: CreatePlanRequest): Observable<string> {
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
        this.planState.update((plan) => {
          if (plan === null || plan.draft === null) {
            return plan;
          }

          return {
            ...plan,
            draft: {
              ...plan.draft,
              editRevision: result.editRevision,
              name: request.name,
              steps: result.steps ?? plan.draft.steps,
            },
          };
        });
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
}
