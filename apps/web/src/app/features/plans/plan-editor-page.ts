import { DecimalPipe } from '@angular/common';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
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
import {
  AbstractControl,
  FormArray,
  FormControl,
  FormGroupDirective,
  NgForm,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { ErrorStateMatcher } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Observable, map } from 'rxjs';
import type { ApiErrorView } from '../../core/http/http-error-normalizer';
import { NotificationService } from '../../shared/notifications/notification.service';
import { ErrorState } from '../../shared/ui/error-state/error-state';
import { LoadingState } from '../../shared/ui/loading-state/loading-state';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { DiscardChangesDialog } from './discard-changes-dialog';
import {
  MAX_DECIMALS,
  MAX_DRAFT_STEPS,
  MAX_NOMINAL_DURATION_MS,
  MAX_TOTAL_SAMPLES,
  MAX_TOLERANCE,
  MIN_TOLERANCE,
  StepFormControls,
  StepFormGroup,
  createStepFormGroup,
  draftFingerprint,
  formatDuration,
  nominalTotals,
  planTotalsValidator,
  stepLimitValidator,
  toSaveDraftStep,
  trimmedMaxLength,
  trimmedRequired,
} from './plan-draft-form';
import type { PlanDetail, PlanStep, SaveDraftResult } from './plans-api.types';
import { PlansFacade } from './plans.facade';
import { PendingChangesAware } from './unsaved-changes.guard';

interface ValidationItem {
  readonly key: string;
  readonly text: string;
}

/**
 * Shows the maximum field error state for the cross-field minimum/maximum rule
 * even though the error lives on the step group rather than the max control.
 */
class MaximumErrorStateMatcher implements ErrorStateMatcher {
  isErrorState(
    control: FormControl<string | null> | null,
    form: FormGroupDirective | NgForm | null,
  ): boolean {
    if (control === null) {
      return false;
    }

    const interacted = control.touched || control.dirty || form?.submitted === true;
    return (
      interacted &&
      (control.invalid || control.parent?.hasError('minimumGreaterThanMaximum') === true)
    );
  }
}

@Component({
  selector: 'app-plan-editor-page',
  imports: [
    DecimalPipe,
    DragDropModule,
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
  templateUrl: './plan-editor-page.html',
  styleUrl: './plan-editor-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlanEditorPage implements PendingChangesAware {
  protected readonly facade = inject(PlansFacade);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(MatDialog);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly formBuilder = inject(NonNullableFormBuilder);

  protected readonly planId = this.route.snapshot.paramMap.get('planId') ?? '';
  protected readonly maxSteps = MAX_DRAFT_STEPS;
  protected readonly maxTotalSamples = MAX_TOTAL_SAMPLES;
  protected readonly maxNominalDurationMs = MAX_NOMINAL_DURATION_MS;
  protected readonly maximumErrorStateMatcher = new MaximumErrorStateMatcher();
  protected readonly formatDuration = formatDuration;

  protected readonly form = this.formBuilder.group({
    name: this.formBuilder.control('', [trimmedRequired, trimmedMaxLength(100)]),
    steps: this.formBuilder.array<StepFormGroup>([], {
      validators: [planTotalsValidator, stepLimitValidator],
    }),
  });

  protected readonly formRevision = signal(0);
  protected readonly submitAttempted = signal(false);
  protected readonly dirty = signal(false);
  protected readonly expectedRevision = signal<number | null>(null);
  protected readonly showReloadConfirm = signal(false);
  protected readonly moveAnnouncement = signal('');

  private clientSequence = 0;
  private submittedClientIds: readonly string[] = [];

  protected readonly stepCount = computed(() => {
    this.formRevision();
    return this.steps.length;
  });

  protected readonly canAddStep = computed(() => {
    this.formRevision();
    return this.steps.length < MAX_DRAFT_STEPS;
  });

  protected readonly totals = computed(() => {
    this.formRevision();
    return nominalTotals(this.steps.getRawValue());
  });

  protected readonly totalSamplesExceeded = computed(
    () => this.totals().totalSamples > MAX_TOTAL_SAMPLES,
  );
  protected readonly totalDurationExceeded = computed(
    () => this.totals().totalDurationMs > MAX_NOMINAL_DURATION_MS,
  );

  protected readonly validationItems = computed<readonly ValidationItem[]>(() => {
    this.formRevision();
    this.submitAttempted();
    const items: ValidationItem[] = [];

    if (this.form.controls.name.invalid) {
      items.push({
        key: 'plan-name',
        text: `Plan name: ${this.fieldError(this.form.controls.name, 'Plan name')}`,
      });
    }

    this.steps.controls.forEach((step, index) => {
      const prefix = `Step ${index + 1}`;
      const fields: readonly [keyof StepFormControls, string][] = [
        ['name', 'Step name'],
        ['unit', 'Unit'],
        ['minimum', 'Minimum'],
        ['maximum', 'Maximum'],
        ['sampleCount', 'Sample count'],
        ['intervalMs', 'Interval'],
      ];

      for (const [field, label] of fields) {
        const control = step.controls[field];
        if (control.invalid) {
          items.push({
            key: `${index}-${field}`,
            text: `${prefix} ${label.toLowerCase()}: ${this.fieldError(control, label)}`,
          });
        }
      }

      if (step.hasError('minimumGreaterThanMaximum')) {
        items.push({
          key: `${index}-range`,
          text: `${prefix}: ${this.rangeErrorMessage()}`,
        });
      }
    });

    const arrayErrors = this.steps.errors ?? {};
    if (arrayErrors['stepLimit'] !== undefined) {
      items.push({
        key: 'step-limit',
        text: `A draft can contain at most ${MAX_DRAFT_STEPS} steps.`,
      });
    }

    if (this.totalSamplesExceeded()) {
      items.push({
        key: 'total-samples',
        text: `A plan can contain at most ${MAX_TOTAL_SAMPLES.toLocaleString('en-US')} samples.`,
      });
    }

    if (this.totalDurationExceeded()) {
      items.push({
        key: 'total-duration',
        text: `Nominal duration must not exceed ${formatDuration(MAX_NOMINAL_DURATION_MS)}.`,
      });
    }

    return items;
  });

  protected readonly headerSubtitle = computed(() => {
    this.formRevision();
    const editedName = this.form.controls.name.value.trim();
    if (editedName.length > 0) {
      return editedName;
    }

    return this.facade.plan()?.name ?? 'Edit the ordered measurement steps of a draft.';
  });

  protected readonly profileName = computed(
    () => this.facade.plan()?.profile?.name ?? 'Device profile unavailable',
  );

  protected readonly latestVersion = computed(
    () => this.facade.plan()?.latestPublishedVersion ?? null,
  );

  protected readonly planErrorMessage = computed(() => {
    const error = this.facade.planError();
    if (error === null) {
      return 'The plan could not be loaded.';
    }

    if (error.status === 404) {
      return 'This plan was not found or is not available to your role.';
    }

    if (error.status === 403) {
      return 'Your role cannot open the plan editor.';
    }

    return error.message;
  });

  protected readonly saveErrorMessage = computed(() => {
    const error = this.facade.saveError();
    return error?.message ?? 'The draft could not be saved.';
  });

  protected readonly saveErrorRequestId = computed(
    () => this.facade.saveError()?.requestId ?? null,
  );

  constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.formRevision.update((revision) => revision + 1);
      this.dirty.set(this.form.dirty);
      this.clearServerErrors();
    });

    this.loadPlan();
  }

  protected get steps(): FormArray<StepFormGroup> {
    return this.form.controls.steps;
  }

  protected reloadPlan(): void {
    this.showReloadConfirm.set(false);
    this.loadPlan();
  }

  protected addStep(): void {
    if (this.steps.length >= MAX_DRAFT_STEPS) {
      return;
    }

    const clientId = this.nextClientId();
    const step = createStepFormGroup(this.formBuilder, {
      clientId,
      logicalStepId: '',
    });

    this.steps.push(step);
    this.markEdited();
    this.moveAnnouncement.set(`Step ${this.steps.length} added.`);
    this.focusAfterRender(`step-name-${clientId}`);
  }

  protected removeStep(index: number): void {
    if (index < 0 || index >= this.steps.length) {
      return;
    }

    this.steps.removeAt(index);
    this.markEdited();
    this.moveAnnouncement.set(`Step ${index + 1} removed. ${this.steps.length} steps remain.`);

    if (this.steps.length === 0) {
      this.focusAfterRender('add-step-button');
      return;
    }

    const focusIndex = Math.min(index, this.steps.length - 1);
    const clientId = this.steps.at(focusIndex).controls.clientId.value;
    this.focusAfterRender(`step-heading-${clientId}`);
  }

  protected moveStep(from: number, to: number): void {
    if (from < 0 || from >= this.steps.length || to < 0 || to >= this.steps.length || from === to) {
      return;
    }

    const step = this.steps.at(from);
    const clientId = step.controls.clientId.value;
    this.steps.removeAt(from);
    this.steps.insert(to, step);
    this.markEdited();
    this.moveAnnouncement.set(`Step moved to position ${to + 1} of ${this.steps.length}.`);
    this.focusAfterRender(`step-heading-${clientId}`);
  }

  protected dropStep(event: CdkDragDrop<StepFormGroup[]>): void {
    this.moveStep(event.previousIndex, event.currentIndex);
  }

  protected save(): void {
    const revision = this.expectedRevision();
    if (revision === null || this.facade.savePending()) {
      return;
    }

    this.submitAttempted.set(true);
    if (this.form.invalid) {
      this.focusAfterRender('validation-summary');
      return;
    }

    const value = this.form.getRawValue();
    this.submittedClientIds = this.steps.controls.map((step) => step.controls.clientId.value);
    const submittedFingerprint = draftFingerprint(value.name, value.steps);

    this.facade
      .saveDraft(this.planId, {
        name: value.name.trim(),
        expectedRevision: revision,
        steps: value.steps.map(toSaveDraftStep),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) =>
          this.handleSaveSuccess(result, this.submittedClientIds, submittedFingerprint),
        error: () => this.handleSaveError(),
      });
  }

  canLeave(): boolean | Observable<boolean> {
    if (!this.form.dirty && !this.facade.savePending()) {
      return true;
    }

    return this.dialog
      .open<DiscardChangesDialog, void, boolean>(DiscardChangesDialog, {
        ariaLabelledBy: 'discard-changes-title',
        autoFocus: 'first-tabbable',
        restoreFocus: true,
        width: '460px',
      })
      .afterClosed()
      .pipe(map((discard) => discard === true));
  }

  protected askReload(): void {
    this.showReloadConfirm.set(true);
    this.focusAfterRender('confirm-reload-button');
  }

  protected cancelReload(): void {
    this.showReloadConfirm.set(false);
    this.focusAfterRender('reload-draft-button');
  }

  protected visibleError(control: AbstractControl): boolean {
    return control.invalid && (control.touched || this.submitAttempted());
  }

  protected maximumVisible(step: StepFormGroup): boolean {
    const maximum = step.controls.maximum;
    return (
      (maximum.invalid || step.hasError('minimumGreaterThanMaximum')) &&
      (maximum.touched || maximum.dirty || this.submitAttempted())
    );
  }

  protected fieldError(control: AbstractControl, label: string): string {
    const errors: ValidationErrors = control.errors ?? {};

    if (errors['required'] === true) {
      return `${label} is required.`;
    }

    const maxlength = errors['maxlength'] as { requiredLength?: number } | undefined;
    if (maxlength !== undefined) {
      return `${label} must be at most ${maxlength.requiredLength ?? 0} characters.`;
    }

    if (errors['decimalFormat'] === true) {
      return 'Enter a decimal number using digits and a dot.';
    }

    if (errors['decimalPlaces'] !== undefined) {
      return `Use at most ${MAX_DECIMALS} decimal places.`;
    }

    if (errors['decimalRange'] !== undefined) {
      return `Enter a value between ${MIN_TOLERANCE} and ${MAX_TOLERANCE}.`;
    }

    const min = errors['min'] as { min?: number } | undefined;
    if (min !== undefined) {
      return `${label} must be at least ${min.min ?? 0}.`;
    }

    const max = errors['max'] as { max?: number } | undefined;
    if (max !== undefined) {
      return `${label} must be at most ${max.max ?? 0}.`;
    }

    if (errors['integer'] === true) {
      return `${label} must be a whole number.`;
    }

    const server = errors['server'];
    return typeof server === 'string' ? server : 'Enter a valid value.';
  }

  protected rangeErrorMessage(): string {
    return 'Maximum must be greater than or equal to minimum.';
  }

  protected stepErrorSummary(step: StepFormGroup): string | null {
    if (!step.invalid || (!step.touched && !this.submitAttempted())) {
      return null;
    }

    const fields: string[] = [];
    if (step.controls.name.invalid) {
      fields.push('step name');
    }
    if (step.controls.unit.invalid) {
      fields.push('unit');
    }
    if (step.controls.minimum.invalid) {
      fields.push('minimum');
    }
    if (step.controls.maximum.invalid) {
      fields.push('maximum');
    }
    if (step.controls.sampleCount.invalid) {
      fields.push('sample count');
    }
    if (step.controls.intervalMs.invalid) {
      fields.push('interval');
    }
    if (step.hasError('minimumGreaterThanMaximum')) {
      fields.push('minimum/maximum relation');
    }

    return fields.length === 0
      ? 'This step has an invalid value.'
      : `This step has errors: ${fields.join(', ')}.`;
  }

  protected stepDuration(step: StepFormGroup): string {
    const sampleCount = step.controls.sampleCount.value;
    const intervalMs = step.controls.intervalMs.value;
    return Number.isInteger(sampleCount) && Number.isInteger(intervalMs)
      ? formatDuration(sampleCount * intervalMs)
      : '—';
  }

  protected stepSampleLabel(step: StepFormGroup): string {
    const sampleCount = step.controls.sampleCount.value;
    return Number.isInteger(sampleCount)
      ? `${sampleCount.toLocaleString('en-US')} samples`
      : 'Sample count invalid';
  }

  protected stepName(step: StepFormGroup): string {
    const name = step.controls.name.value.trim();
    return name.length === 0 ? 'Untitled step' : name;
  }

  private loadPlan(): void {
    this.facade
      .loadPlan(this.planId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (plan) => this.applyLoadedPlan(plan),
        error: () => undefined,
      });
  }

  private applyLoadedPlan(plan: PlanDetail): void {
    this.steps.clear({ emitEvent: false });
    this.form.controls.name.setValue(plan.draft?.name ?? plan.name, {
      emitEvent: false,
    });

    for (const step of plan.draft?.steps ?? []) {
      this.steps.push(this.createLoadedStep(step), { emitEvent: false });
    }

    this.expectedRevision.set(plan.draft?.editRevision ?? null);
    this.form.markAsPristine();
    this.form.markAsUntouched();
    this.dirty.set(false);
    this.submitAttempted.set(false);
    this.showReloadConfirm.set(false);
    this.facade.clearSaveError();
    this.moveAnnouncement.set('');
    this.formRevision.update((revision) => revision + 1);
  }

  private createLoadedStep(step: PlanStep): StepFormGroup {
    return createStepFormGroup(this.formBuilder, {
      clientId:
        step.logicalStepId.length > 0 ? `loaded-${step.logicalStepId}` : this.nextClientId(),
      logicalStepId: step.logicalStepId,
      name: step.name,
      unit: step.unit,
      minimum: step.minimum,
      maximum: step.maximum,
      sampleCount: step.sampleCount,
      intervalMs: step.intervalMs,
    });
  }

  private handleSaveSuccess(
    result: SaveDraftResult,
    submittedClientIds: readonly string[],
    submittedFingerprint: string,
  ): void {
    const ids = result.steps?.map((step) => step.logicalStepId) ?? result.logicalStepIds ?? [];

    ids.forEach((logicalStepId, index) => {
      if (logicalStepId.length === 0) {
        return;
      }

      const clientId = submittedClientIds[index];
      if (clientId === undefined) {
        return;
      }

      const step = this.findStep(clientId);
      step?.controls.logicalStepId.setValue(logicalStepId, { emitEvent: false });
    });

    this.expectedRevision.set(result.editRevision);

    const current = this.form.getRawValue();
    const unchanged = draftFingerprint(current.name, current.steps) === submittedFingerprint;
    if (unchanged) {
      this.form.markAsPristine();
      this.dirty.set(false);
    }

    this.formRevision.update((revision) => revision + 1);
    this.notifications.success(
      unchanged ? 'Draft saved.' : 'Draft saved. Edits made during the save are not saved yet.',
    );
  }

  private handleSaveError(): void {
    this.formRevision.update((revision) => revision + 1);

    const saveError: ApiErrorView | null = this.facade.saveError();
    if (saveError === null) {
      return;
    }

    if (this.facade.draftConflict()) {
      this.notifications.error('This draft changed in another session. Your input has been kept.');
      this.focusAfterRender('save-error-panel');
      return;
    }

    this.applyServerFieldErrors(saveError.fieldErrors);
    this.notifications.error(saveError.message);
    this.focusAfterRender('save-error-panel');
  }

  private applyServerFieldErrors(fieldErrors: ApiErrorView['fieldErrors']): void {
    for (const fieldError of fieldErrors) {
      if (fieldError.path === 'name') {
        this.setServerError(this.form.controls.name, fieldError.message);
        continue;
      }

      const match = /^steps\.(\d+)\.([A-Za-z]+)$/.exec(fieldError.path);
      if (match === null) {
        continue;
      }

      const submittedIndex = Number(match[1]);
      const field = match[2];
      const clientId = this.submittedClientIds[submittedIndex];
      if (clientId === undefined) {
        continue;
      }

      const step = this.findStep(clientId);
      const control = step === null ? null : this.stepControl(step, field);
      if (control !== null) {
        this.setServerError(control, fieldError.message);
      }
    }
  }

  private stepControl(step: StepFormGroup, field: string): AbstractControl | null {
    switch (field) {
      case 'name':
        return step.controls.name;
      case 'unit':
        return step.controls.unit;
      case 'minimum':
        return step.controls.minimum;
      case 'maximum':
        return step.controls.maximum;
      case 'sampleCount':
        return step.controls.sampleCount;
      case 'intervalMs':
        return step.controls.intervalMs;
      default:
        return null;
    }
  }

  private setServerError(control: AbstractControl, message: string): void {
    control.setErrors({ ...control.errors, server: message });
    control.markAsTouched();
  }

  private clearServerErrors(): void {
    this.clearServerError(this.form.controls.name);
    for (const step of this.steps.controls) {
      for (const control of [
        step.controls.name,
        step.controls.unit,
        step.controls.minimum,
        step.controls.maximum,
        step.controls.sampleCount,
        step.controls.intervalMs,
      ]) {
        this.clearServerError(control);
      }
    }
  }

  private clearServerError(control: AbstractControl): void {
    if (!control.hasError('server')) {
      return;
    }

    const errors: ValidationErrors = { ...control.errors };
    delete errors['server'];
    control.setErrors(Object.keys(errors).length > 0 ? errors : null);
  }

  private findStep(clientId: string): StepFormGroup | null {
    return this.steps.controls.find((step) => step.controls.clientId.value === clientId) ?? null;
  }

  private nextClientId(): string {
    this.clientSequence += 1;
    return `new-${this.clientSequence}`;
  }

  private markEdited(): void {
    this.form.markAsDirty();
    this.dirty.set(true);
    this.formRevision.update((revision) => revision + 1);
  }

  private focusAfterRender(elementId: string): void {
    afterNextRender(() => document.getElementById(elementId)?.focus(), { injector: this.injector });
  }
}
