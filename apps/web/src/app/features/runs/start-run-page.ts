import { DecimalPipe } from '@angular/common';
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
import { AbstractControl, NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthFacade } from '../../core/auth/auth.facade';
import { ErrorState } from '../../shared/ui/error-state/error-state';
import { LoadingState } from '../../shared/ui/loading-state/loading-state';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { formatDuration, nominalTotals } from '../plans/plan-draft-form';
import type { PlanStep } from '../plans/plans-api.types';
import { PlansFacade } from '../plans/plans.facade';
import {
  RunStartAttempt,
  applyScenarioValidation,
  buildStartRunRequest,
  createRunStartForm,
  generateSeed,
} from './run-start-form';
import type { RunScenario } from './runs-api.types';
import { RunsFacade } from './runs.facade';

@Component({
  selector: 'app-start-run-page',
  imports: [
    DecimalPipe,
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
  templateUrl: './start-run-page.html',
  styleUrl: './start-run-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StartRunPage {
  protected readonly plans = inject(PlansFacade);
  protected readonly runs = inject(RunsFacade);
  protected readonly auth = inject(AuthFacade);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  protected readonly versionId = this.route.snapshot.queryParamMap.get('versionId') ?? '';
  protected readonly missingVersionId = computed(() => this.versionId.trim().length === 0);
  protected readonly form = createRunStartForm(inject(NonNullableFormBuilder));
  protected readonly scenario = signal<RunScenario>('NORMAL');
  protected readonly formRevision = signal(0);
  protected readonly formatDuration = formatDuration;
  protected readonly isOperator = computed(() => this.auth.role() === 'OPERATOR');

  private readonly attempt = new RunStartAttempt();

  protected readonly totals = computed(() => {
    const version = this.plans.version();
    if (version === null) {
      return null;
    }

    return nominalTotals(version.steps.map(toTotalsStep));
  });

  protected readonly startFailure = this.runs.startError;

  protected readonly canSubmit = computed(() => {
    this.formRevision();
    // A server field error changes form validity without a value change, so the
    // failure signal is a dependency here as well.
    this.startFailure();
    return (
      this.isOperator() &&
      this.plans.versionStatus() === 'loaded' &&
      this.plans.version() !== null &&
      this.form.valid &&
      !this.runs.startPending()
    );
  });

  protected readonly isActiveRunConflict = computed(
    () => this.startFailure()?.error.code === 'RUN_ALREADY_ACTIVE',
  );
  protected readonly activeRunId = computed(() => this.startFailure()?.activeRunId ?? null);
  protected readonly isUnauthenticated = computed(
    () => this.startFailure()?.error.status === 401,
  );
  protected readonly isForbidden = computed(() => this.startFailure()?.error.status === 403);

  protected readonly startErrorHeading = computed(() => {
    const failure = this.startFailure();
    if (failure === null) {
      return 'The run could not be started';
    }

    if (failure.error.code === 'RUN_ALREADY_ACTIVE') {
      return 'Another run is already active';
    }

    if (failure.error.code === 'IDEMPOTENCY_CONFLICT') {
      return 'This start attempt was already used';
    }

    if (failure.error.status === 401) {
      return 'Your session has expired';
    }

    if (failure.error.status === 403) {
      return 'You cannot start a run';
    }

    return 'The run could not be started';
  });

  protected readonly startErrorMessage = computed(() => {
    const failure = this.startFailure();
    if (failure === null) {
      return '';
    }

    if (failure.error.code === 'RUN_ALREADY_ACTIVE') {
      return 'Only one run can be active at a time. Open the active run, or wait until it finishes and try again.';
    }

    if (failure.error.code === 'IDEMPOTENCY_CONFLICT') {
      return 'This idempotency key was already used with a different request. Change the scenario or settings to start a new attempt, or reload the page.';
    }

    if (failure.error.status === 401) {
      return 'Sign in again to start a run. Your form values have not been sent as a successful start.';
    }

    if (failure.error.status === 403) {
      return 'Starting a run requires the Operator role. If you are an Operator, reload the page and try again so a fresh CSRF token is used.';
    }

    return failure.error.message;
  });

  constructor() {
    this.runs.clearStartError();

    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.formRevision.update((revision) => revision + 1);
      this.clearServerErrors();
      this.syncScenarioState();
    });

    if (!this.missingVersionId()) {
      this.loadVersion();
    }
  }

  protected retryVersion(): void {
    this.loadVersion();
  }

  protected generateSeedValue(): void {
    const seed = this.form.controls.seed;
    seed.setValue(generateSeed());
    seed.markAsDirty();
    seed.markAsTouched();
  }

  protected submit(): void {
    if (!this.canSubmit()) {
      return;
    }

    const version = this.plans.version();
    if (version === null) {
      return;
    }

    const request = buildStartRunRequest(version.id, this.form.getRawValue());
    const idempotencyKey = this.attempt.keyFor(request);

    this.runs
      .startRun(request, idempotencyKey)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.attempt.reset();
          // A fresh start is RUNNING and belongs on the live screen. A 200
          // replay of an already-terminal run opens its immutable details.
          void this.router.navigate(
            result.status === 'RUNNING'
              ? ['/runs', result.runId, 'live']
              : ['/runs', result.runId],
          );
        },
        error: () => {
          this.applyFieldErrors();
          this.focusAfterRender('start-run-error-panel');
        },
      });
  }

  protected seedServerError(): string | null {
    return readServerError(this.form.controls.seed.getError('server'));
  }

  protected seedFailureStepServerError(): string | null {
    return readServerError(this.form.controls.failureStepId.getError('server'));
  }

  protected probabilityServerError(): string | null {
    return readServerError(this.form.controls.errorProbability.getError('server'));
  }

  protected scenarioServerError(): string | null {
    return readServerError(this.form.controls.scenario.getError('server'));
  }

  private loadVersion(): void {
    if (this.versionId.trim().length === 0) {
      return;
    }

    this.plans
      .loadVersion(this.versionId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => undefined });
  }

  /**
   * Applies the scenario-specific validators and clears the fields that do not
   * belong to the new scenario. Guarded so the recursive value change from
   * clearing a field does not run the transition twice.
   */
  private syncScenarioState(): void {
    const next = this.form.controls.scenario.value;
    if (next === this.scenario()) {
      return;
    }

    this.scenario.set(next);

    if (next !== 'FORCED_FAILURE') {
      this.form.controls.failureStepId.setValue('');
    }

    if (next !== 'RANDOM') {
      this.form.controls.errorProbability.setValue('');
    }

    applyScenarioValidation(this.form, next);
  }

  private applyFieldErrors(): void {
    const fieldErrors = this.startFailure()?.error.fieldErrors ?? [];

    for (const fieldError of fieldErrors) {
      const control = this.controlForPath(fieldError.path);
      if (control !== null) {
        control.setErrors({ ...control.errors, server: fieldError.message });
      }
    }

    if (fieldErrors.length > 0) {
      this.form.markAllAsTouched();
    }
  }

  private controlForPath(path: string): AbstractControl | null {
    switch (path) {
      case 'scenario':
        return this.form.controls.scenario;
      case 'seed':
        return this.form.controls.seed;
      case 'failureStepId':
        return this.form.controls.failureStepId;
      case 'errorProbability':
        return this.form.controls.errorProbability;
      default:
        return null;
    }
  }

  private clearServerErrors(): void {
    const controls: readonly AbstractControl[] = [
      this.form.controls.scenario,
      this.form.controls.seed,
      this.form.controls.failureStepId,
      this.form.controls.errorProbability,
    ];

    for (const control of controls) {
      if (!control.hasError('server')) {
        continue;
      }

      const errors: Record<string, unknown> = { ...control.errors };
      delete errors['server'];
      control.setErrors(Object.keys(errors).length > 0 ? errors : null);
    }
  }

  private focusAfterRender(elementId: string): void {
    afterNextRender(() => document.getElementById(elementId)?.focus(), {
      injector: this.injector,
    });
  }
}

function toTotalsStep(step: PlanStep): PlanStep & { readonly clientId: string } {
  return { ...step, clientId: step.logicalStepId };
}

function readServerError(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
