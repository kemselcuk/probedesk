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
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthFacade } from '../../core/auth/auth.facade';
import { NotificationService } from '../../shared/notifications/notification.service';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { ErrorState } from '../../shared/ui/error-state/error-state';
import { LoadingState } from '../../shared/ui/loading-state/loading-state';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { trimmedMaxLength, trimmedRequired } from './plan-draft-form';
import type { DeviceProfile } from './plans-api.types';
import { PlansFacade } from './plans.facade';

@Component({
  selector: 'app-plans-list-page',
  imports: [
    EmptyState,
    ErrorState,
    LoadingState,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    PageHeader,
    ReactiveFormsModule,
    RouterLink,
  ],
  templateUrl: './plans-list-page.html',
  styleUrl: './plans-list-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlansListPage {
  protected readonly facade = inject(PlansFacade);
  protected readonly auth = inject(AuthFacade);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  protected readonly isPlanner = computed(() => this.auth.role() === 'PLANNER');
  protected readonly createOpen = signal(false);
  protected readonly createAttempted = signal(false);

  protected readonly createForm = inject(NonNullableFormBuilder).group({
    name: ['', [trimmedRequired, trimmedMaxLength(100)]],
    profileId: ['', [Validators.required]],
  });

  protected readonly plansErrorMessage = computed(() => {
    const error = this.facade.plansError();
    if (error === null) {
      return 'The test plan list could not be loaded.';
    }

    if (error.status === 403) {
      return 'Your role cannot read the test plan list.';
    }

    return error.message;
  });

  protected readonly profilesErrorMessage = computed(() => {
    const error = this.facade.profilesError();
    return error?.message ?? 'The device profiles could not be loaded.';
  });

  protected readonly createErrorMessage = computed(() => {
    const error = this.facade.createError();
    return error?.message ?? 'The plan could not be created.';
  });

  protected readonly createErrorRequestId = computed(
    () => this.facade.createError()?.requestId ?? null,
  );

  constructor() {
    this.facade.loadPlans();

    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      if (params.get('create') !== '1' || !this.isPlanner()) {
        return;
      }

      this.openCreate();
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { create: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    });

    this.createForm.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.clearCreateServerErrors());
  }

  protected reloadPlans(): void {
    this.facade.loadPlans();
  }

  protected toggleCreate(): void {
    if (this.createOpen()) {
      this.closeCreate();
      return;
    }

    this.openCreate();
  }

  protected openCreate(): void {
    if (!this.isPlanner()) {
      return;
    }

    this.createOpen.set(true);
    this.createAttempted.set(false);
    this.createForm.reset({ name: '', profileId: '' });
    this.facade.clearCreateError();
    this.loadProfiles();
    this.focusAfterRender('create-plan-name');
  }

  protected closeCreate(): void {
    this.createOpen.set(false);
    this.createAttempted.set(false);
    this.createForm.reset({ name: '', profileId: '' });
    this.facade.clearCreateError();
  }

  protected retryProfiles(): void {
    this.loadProfiles();
  }

  protected submitCreate(): void {
    this.createAttempted.set(true);
    this.createForm.markAllAsTouched();

    if (
      this.facade.createPending() ||
      this.createForm.invalid ||
      this.facade.profiles().length === 0
    ) {
      return;
    }

    const value = this.createForm.getRawValue();
    this.facade
      .createPlan({ name: value.name.trim(), profileId: value.profileId })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (planId) => {
          this.notifications.success('Plan created. Add the first measurement step.');
          this.createOpen.set(false);
          void this.router.navigate(['/plans', planId, 'edit']);
        },
        error: () => this.applyCreateFieldErrors(),
      });
  }

  protected createNameServerError(): string | null {
    return readServerError(this.createForm.controls.name.getError('server'));
  }

  protected createProfileServerError(): string | null {
    return readServerError(this.createForm.controls.profileId.getError('server'));
  }

  protected profileLabel(profile: DeviceProfile): string {
    return `${profile.name} (${profile.code})`;
  }

  private loadProfiles(): void {
    this.facade
      .loadProfiles()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (profiles) => {
          if (this.createForm.controls.profileId.value === '' && profiles.length > 0) {
            this.createForm.controls.profileId.setValue(profiles[0].id);
          }
        },
        error: () => undefined,
      });
  }

  private applyCreateFieldErrors(): void {
    const fieldErrors = this.facade.createError()?.fieldErrors ?? [];

    for (const fieldError of fieldErrors) {
      this.applyServerError(fieldError.path, fieldError.message);
    }

    if (fieldErrors.length > 0) {
      this.createForm.markAllAsTouched();
    }
  }

  private applyServerError(path: string, message: string): void {
    const control =
      path === 'name'
        ? this.createForm.controls.name
        : path === 'profileId'
          ? this.createForm.controls.profileId
          : null;

    if (control !== null) {
      control.setErrors({ ...control.errors, server: message });
    }
  }

  private clearCreateServerErrors(): void {
    for (const control of [this.createForm.controls.name, this.createForm.controls.profileId]) {
      if (control.hasError('server')) {
        const errors: Record<string, unknown> = { ...control.errors };
        delete errors['server'];
        control.setErrors(Object.keys(errors).length > 0 ? errors : null);
      }
    }
  }

  private focusAfterRender(elementId: string): void {
    afterNextRender(() => document.getElementById(elementId)?.focus(), { injector: this.injector });
  }
}

function readServerError(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
