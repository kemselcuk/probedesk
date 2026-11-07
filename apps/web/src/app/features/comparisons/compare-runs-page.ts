import { RunDeviceMetadata } from '../runs/run-device-metadata';
import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { map } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { LoadingState } from '../../shared/ui/loading-state/loading-state';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { RunStatusBadge } from '../runs/run-status-badge';
import { runStatusView, scenarioLabel } from '../runs/run-status';
import type { RunHistoryItem } from '../runs/runs-api.types';
import {
  isTerminalStatus,
  runOptionLabel,
  runOptionState,
  validateCompareQuery,
  validateCompareSelection,
  type CompareSelectionValidation,
} from './compare-selection';
import { ComparisonsFacade } from './comparisons.facade';
import { ComparisonStepCard } from './comparison-step-card';
import type { ComparisonStepView } from './comparison-view';
import {
  buildComparisonStepViews,
  comparisonCounts,
  runDataNote,
  runPartialChip,
  scenarioNote,
  versionNote,
} from './comparison-view';
import type { ComparisonResult } from './comparisons-api.types';

interface ComparisonPair {
  readonly leftRunId: string;
  readonly rightRunId: string;
}

interface RunCard {
  readonly key: 'left' | 'right';
  readonly label: 'Left run' | 'Right run';
  readonly run: ComparisonResult['leftRun'];
}

interface SelectionDraft {
  readonly leftRunId: string;
  readonly rightRunId: string;
}

/**
 * Compare Runs screen.
 *
 * The URL query string owns the pair, so refresh, Back, and a shared deep link
 * open the same comparison. Rule matching, changed fields, stored outcomes, and
 * every tolerance verdict come from GET /api/comparisons; this screen never
 * recomputes them. The API remains the final validator for terminal status,
 * distinct runs, and the single-plan rule.
 */
@Component({
  selector: 'app-compare-runs-page',
  imports: [
    RunDeviceMetadata,
    ComparisonStepCard,
    DatePipe,
    EmptyState,
    LoadingState,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    PageHeader,
    ReactiveFormsModule,
    RouterLink,
    RunStatusBadge,
  ],
  templateUrl: './compare-runs-page.html',
  styleUrl: './compare-runs-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompareRunsPage {
  protected readonly comparisons = inject(ComparisonsFacade);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly formBuilder = inject(NonNullableFormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  private readonly pairState = signal<ComparisonPair | null>(null);
  private readonly linkErrorState = signal<string | null>(null);
  private readonly selectionOpenState = signal(false);
  protected readonly announcement = signal('');
  protected readonly selectedStepKey = signal<string | null>(null);

  protected readonly activePair = this.pairState.asReadonly();
  protected readonly linkError = this.linkErrorState.asReadonly();
  protected readonly selectionOpen = this.selectionOpenState.asReadonly();

  protected readonly selectionForm = this.formBuilder.group({
    leftRunId: '',
    rightRunId: '',
  });
  protected readonly draft = toSignal(
    this.selectionForm.valueChanges.pipe(
      map((value) => ({
        leftRunId: value.leftRunId ?? '',
        rightRunId: value.rightRunId ?? '',
      })),
    ),
    { initialValue: this.selectionForm.getRawValue() satisfies SelectionDraft },
  );

  protected readonly result = this.comparisons.result;
  protected readonly error = this.comparisons.error;
  protected readonly loading = computed(() => this.comparisons.status() === 'loading');
  protected readonly loaded = computed(() => this.comparisons.status() === 'loaded');

  protected readonly stepViews = computed(() => {
    const result = this.result();
    return result === null ? [] : buildComparisonStepViews(result);
  });
  protected readonly counts = computed(() => {
    const result = this.result();
    return result === null
      ? { matched: 0, added: 0, removed: 0, changedFields: 0 }
      : comparisonCounts(result);
  });

  protected readonly defaultStepKey = computed(() => this.stepViews()[0]?.key ?? null);

  protected isStepActive(view: ComparisonStepView): boolean {
    return (this.selectedStepKey() ?? this.defaultStepKey()) === view.key;
  }

  protected selectStep(view: ComparisonStepView): void {
    this.selectedStepKey.set(view.key);
    const target = document.getElementById(`comparison-step-${view.key}`);
    if (typeof target?.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'start' });
    }
  }

  protected presenceLabel(view: ComparisonStepView): string {
    switch (view.presence) {
      case 'matched':
        return 'Shared';
      case 'added':
        return 'Right only';
      case 'removed':
        return 'Left only';
    }
  }
  protected readonly runCards = computed<RunCard[]>(() => {
    const result = this.result();
    if (result === null) {
      return [];
    }

    return [
      { key: 'left', label: 'Left run', run: result.leftRun },
      { key: 'right', label: 'Right run', run: result.rightRun },
    ];
  });
  protected readonly version = computed(() => {
    const result = this.result();
    return result === null ? null : versionNote(result);
  });
  protected readonly scenarioDifference = computed(() => {
    const result = this.result();
    return result === null ? null : scenarioNote(result.leftRun, result.rightRun);
  });

  protected readonly subtitle = computed(() => {
    if (this.loading()) {
      return 'Loading both recorded runs and their stored rule snapshots.';
    }

    const result = this.result();
    if (result !== null) {
      return `${result.leftRun.planName} · ${this.counts().matched} shared ${this.counts().matched === 1 ? 'step' : 'steps'}; versions stay separate.`;
    }

    return 'Choose two terminal runs of the same plan.';
  });

  protected readonly errorHeading = computed(() => {
    const failure = this.error();
    if (failure === null) {
      return 'The comparison could not be loaded';
    }

    if (failure.status === 401) {
      return 'Your session has expired';
    }
    if (failure.status === 403) {
      return 'You cannot compare runs';
    }
    if (failure.status === 404) {
      return 'One of the runs was not found';
    }
    if (failure.code === 'RUN_NOT_TERMINAL') {
      return 'A running run cannot be compared';
    }
    if (failure.code === 'COMPARISON_PLAN_MISMATCH') {
      return 'The runs belong to different plans';
    }
    if (failure.status === 400) {
      return 'The comparison request was rejected';
    }
    if (failure.code === 'MALFORMED_API_RESPONSE') {
      return 'The comparison response was not valid';
    }

    return 'The comparison could not be loaded';
  });

  protected readonly errorMessage = computed(() => {
    const failure = this.error();
    if (failure === null) {
      return '';
    }

    if (failure.status === 401) {
      return 'Sign in again, then reopen this comparison link. No comparison result is shown from an unauthenticated request.';
    }
    if (failure.status === 403) {
      return 'Your role cannot read these runs. Comparison needs the same read access as Run History.';
    }
    if (failure.status === 404) {
      return 'The server does not have one of the selected runs, or your role cannot read it. Check both ids or choose the runs again.';
    }
    if (failure.code === 'RUN_NOT_TERMINAL') {
      return 'One of the selected runs is still RUNNING. Only COMPLETED, CANCELLED, INTERRUPTED, and ERROR runs can be compared. Open the run until it finishes, then retry.';
    }
    if (failure.code === 'COMPARISON_PLAN_MISMATCH') {
      return 'The selected runs belong to different plans. Choose two runs of the same plan; using different versions of that plan is allowed.';
    }
    if (failure.status === 400) {
      return `${failure.message} Check both run ids and choose the pair again.`;
    }
    if (failure.code === 'MALFORMED_API_RESPONSE') {
      return `${failure.message} Nothing was filled in with a zero or a guessed result.`;
    }

    return `${failure.message} The stored comparison was not changed.`;
  });

  protected readonly canRetry = computed(() => {
    const failure = this.error();
    if (failure === null) {
      return false;
    }

    return (
      failure.kind === 'network' ||
      failure.kind === 'unknown' ||
      failure.status === null ||
      (failure.status !== null && failure.status >= 500) ||
      failure.code === 'MALFORMED_API_RESPONSE'
    );
  });

  protected readonly showChooseRunsAction = computed(() => {
    const failure = this.error();
    return (
      failure !== null &&
      failure.status !== 401 &&
      failure.status !== 403 &&
      failure.status !== null
    );
  });

  protected readonly isUnauthenticated = computed(() => this.error()?.status === 401);

  protected readonly runOptions = this.comparisons.runOptions;
  protected readonly runOptionsTotal = this.comparisons.runOptionsTotal;
  protected readonly runOptionsLoading = computed(
    () => this.comparisons.runOptionsStatus() === 'loading',
  );
  protected readonly runOptionsError = this.comparisons.runOptionsError;

  protected readonly draftValidation = computed<CompareSelectionValidation>(() => {
    const value = this.draft();
    const left = this.findRun(value.leftRunId);
    const right = this.findRun(value.rightRunId);

    if (value.leftRunId.length === 0 || value.rightRunId.length === 0) {
      return {
        valid: false,
        left,
        right,
        reason: 'Choose one run for each side before comparing.',
      };
    }

    if (value.leftRunId === value.rightRunId) {
      return {
        valid: false,
        left,
        right,
        reason: 'A run cannot be compared with itself. Choose two different runs.',
      };
    }

    if (left !== null && right !== null) {
      return validateCompareSelection([left, right]);
    }

    if (left !== null && !isTerminalStatus(left.status)) {
      return {
        valid: false,
        left,
        right,
        reason: 'The selected left run is still RUNNING. Wait until it reaches a terminal state.',
      };
    }

    if (right !== null && !isTerminalStatus(right.status)) {
      return {
        valid: false,
        left,
        right,
        reason: 'The selected right run is still RUNNING. Wait until it reaches a terminal state.',
      };
    }

    return { valid: true, left, right, reason: null };
  });

  protected readonly canApplySelection = computed(
    () =>
      this.draftValidation().valid &&
      this.draft().leftRunId.length > 0 &&
      this.draft().rightRunId.length > 0,
  );

  protected readonly draftNotice = computed(() => {
    const value = this.draft();
    if (value.leftRunId.length === 0 || value.rightRunId.length === 0) {
      return null;
    }

    const leftKnown = this.findRun(value.leftRunId) !== null;
    const rightKnown = this.findRun(value.rightRunId) !== null;
    if (leftKnown && rightKnown) {
      return null;
    }

    return 'At least one selected run is not in the latest 100 runs. The server will still validate the ids; a missing run returns a clear error.';
  });

  protected readonly scenario = scenarioLabel;
  protected readonly optionLabel = runOptionLabel;
  protected readonly optionState = runOptionState;
  protected readonly partialChip = runPartialChip;
  protected readonly dataNote = runDataNote;

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const leftValue = params.get('leftRunId') ?? '';
      const rightValue = params.get('rightRunId') ?? '';

      this.selectionForm.setValue({ leftRunId: leftValue, rightRunId: rightValue });
      this.linkErrorState.set(null);
      const validation = validateCompareQuery(leftValue, rightValue);

      if (validation.kind === 'ready') {
        this.pairState.set({
          leftRunId: validation.leftRunId,
          rightRunId: validation.rightRunId,
        });
        this.selectionOpenState.set(false);
        this.loadComparison(validation.leftRunId, validation.rightRunId);
        return;
      }

      this.pairState.set(null);
      this.comparisons.clear();
      this.selectionOpenState.set(true);
      if (validation.kind === 'invalid') {
        this.linkErrorState.set(validation.message);
      }
      this.comparisons.ensureRunOptions();
    });
  }

  protected openSelectionPanel(): void {
    this.selectionOpenState.set(true);
    this.comparisons.ensureRunOptions();
    this.announcement.set(
      'Run selection opened. Choose two terminal runs of the same plan, then compare.',
    );
  }

  protected closeSelectionPanel(): void {
    this.selectionOpenState.set(false);
    this.syncFormFromPair();
  }

  protected applySelection(): void {
    if (!this.canApplySelection()) {
      this.announcement.set(
        this.draftValidation().reason ?? 'Choose two terminal runs of the same plan.',
      );
      return;
    }

    const value = this.draft();
    this.selectionOpenState.set(false);
    void this.navigateToPair(value.leftRunId, value.rightRunId);
  }

  protected clearComparison(): void {
    this.pairState.set(null);
    this.linkErrorState.set(null);
    this.selectionOpenState.set(false);
    this.selectionForm.setValue({ leftRunId: '', rightRunId: '' });
    this.comparisons.clear();
    this.announcement.set('The comparison and its run selection were cleared.');
    void this.router.navigate(['/compare']);
  }

  protected swapSides(): void {
    const pair = this.activePair();
    if (pair === null) {
      return;
    }

    this.announcement.set('The left and right runs were swapped.');
    void this.navigateToPair(pair.rightRunId, pair.leftRunId);
  }

  protected retry(): void {
    const pair = this.activePair();
    if (pair === null) {
      return;
    }

    this.loadComparison(pair.leftRunId, pair.rightRunId);
  }

  protected retryRunOptions(): void {
    this.comparisons.loadRunOptions().subscribe({ error: () => undefined });
  }

  protected onLeftChange(): void {
    const left = this.findRun(this.selectionForm.controls.leftRunId.value);
    const right = this.findRun(this.selectionForm.controls.rightRunId.value);
    if (left !== null && right !== null && left.planId !== right.planId) {
      this.selectionForm.controls.rightRunId.setValue('');
    }
  }

  protected onRightChange(): void {
    const left = this.findRun(this.selectionForm.controls.leftRunId.value);
    const right = this.findRun(this.selectionForm.controls.rightRunId.value);
    if (left !== null && right !== null && left.planId !== right.planId) {
      this.selectionForm.controls.leftRunId.setValue('');
    }
  }

  protected isOptionDisabled(run: RunHistoryItem, otherRunId: string): boolean {
    if (!isTerminalStatus(run.status) || run.id === otherRunId) {
      return true;
    }

    const other = this.findRun(otherRunId);
    return other !== null && other.planId !== run.planId;
  }

  protected unknownDraftRun(side: 'left' | 'right'): string | null {
    const value =
      side === 'left'
        ? this.selectionForm.controls.leftRunId.value
        : this.selectionForm.controls.rightRunId.value;
    if (value.length === 0 || this.findRun(value) !== null) {
      return null;
    }

    return value;
  }

  protected statusDetail(run: ComparisonResult['leftRun']): string {
    return runStatusView(run.status, run.outcome).detail;
  }

  private navigateToPair(leftRunId: string, rightRunId: string): Promise<boolean> {
    return this.router.navigate(['/compare'], {
      queryParams: { leftRunId, rightRunId },
    });
  }

  private loadComparison(leftRunId: string, rightRunId: string): void {
    this.comparisons
      .load(leftRunId, rightRunId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.announcement.set(
            `Comparison loaded: left version ${result.leftRun.versionNumber}, right version ${result.rightRun.versionNumber}.`,
          );
        },
        error: () => undefined,
      });
  }

  private syncFormFromPair(): void {
    const pair = this.activePair();
    this.selectionForm.setValue({
      leftRunId: pair?.leftRunId ?? '',
      rightRunId: pair?.rightRunId ?? '',
    });
  }

  private findRun(runId: string): RunHistoryItem | null {
    return this.runOptions().find((run) => run.id === runId) ?? null;
  }
}
