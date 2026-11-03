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
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthFacade } from '../../core/auth/auth.facade';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { ErrorState } from '../../shared/ui/error-state/error-state';
import { LoadingState } from '../../shared/ui/loading-state/loading-state';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { CancelRunDialog } from './cancel-run-dialog';
import type { CancelRunDialogData } from './cancel-run-dialog';
import { buildRerunRequest } from './run-rerun';
import { RunStartAttempt } from './run-start-form';
import {
  isPartialResult,
  isStoppedAfterAllSamples,
  progressLabel,
  runStatusLabel,
  runStatusView,
  scenarioLabel,
  stepOutcomeLabel,
  stepStatusLabel,
} from './run-status';
import { RunStatusBadge } from './run-status-badge';
import type { StartRunRequest } from './runs-api.types';
import { RunsFacade } from './runs.facade';

interface FirstFailureView {
  readonly stepPosition: number;
  readonly stepName: string;
  readonly unit: string;
  readonly sampleIndex: number;
  readonly value: string | null;
}

/**
 * One recorded run, read from the server snapshot.
 *
 * The screen never derives a verdict, tolerance flag, or average. It renders
 * the stored step rules, counters, statistics, and measurements; a null
 * statistic is shown as unavailable instead of a fake zero. Cancelling waits
 * for the server response and refreshing can never replace a newer selection
 * with an older response.
 */
@Component({
  selector: 'app-run-details-page',
  imports: [
    DatePipe,
    DecimalPipe,
    EmptyState,
    ErrorState,
    LoadingState,
    MatButtonModule,
    MatCardModule,
    PageHeader,
    RouterLink,
    RunStatusBadge,
  ],
  templateUrl: './run-details-page.html',
  styleUrl: './run-details-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RunDetailsPage {
  protected readonly runs = inject(RunsFacade);
  protected readonly auth = inject(AuthFacade);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  protected readonly runId = signal(this.route.snapshot.paramMap.get('runId') ?? '');
  protected readonly missingRunId = computed(() => this.runId().trim().length === 0);
  protected readonly isOperator = computed(() => this.auth.role() === 'OPERATOR');
  protected readonly snapshot = this.runs.snapshot;
  protected readonly loadStatus = this.runs.snapshotStatus;
  protected readonly loadError = this.runs.snapshotError;
  protected readonly refreshError = this.runs.refreshError;
  protected readonly startFailure = this.runs.startError;
  protected readonly cancelFailure = this.runs.cancelError;
  protected readonly announcement = signal('');

  protected readonly statusView = computed(() => {
    const run = this.snapshot();
    return run === null ? null : runStatusView(run.status, run.outcome);
  });

  protected readonly isRunning = computed(() => this.snapshot()?.status === 'RUNNING');
  protected readonly isTerminal = computed(() => {
    const run = this.snapshot();
    return run !== null && run.status !== 'RUNNING';
  });

  protected readonly partialResults = computed(() => {
    const run = this.snapshot();
    return run !== null && isPartialResult(run);
  });

  protected readonly stoppedAfterAllSamples = computed(() => {
    const run = this.snapshot();
    return run !== null && isStoppedAfterAllSamples(run);
  });

  protected readonly progressPercent = computed(() => {
    const run = this.snapshot();
    if (run === null || run.expectedSampleCount === 0) {
      return null;
    }

    return Math.min(100, Math.round((run.recordedSampleCount / run.expectedSampleCount) * 100));
  });

  /** Sum of the stored per-step violation counters; never recomputed from samples. */
  protected readonly totalOutOfTolerance = computed(() => {
    const run = this.snapshot();
    return run === null
      ? 0
      : run.steps.reduce((total, step) => total + step.outOfToleranceCount, 0);
  });

  /**
   * The earliest stored first-failure index in step order, with the recorded
   * value when that sample is present in the snapshot. A missing measurement is
   * reported as unavailable rather than shown as a zero.
   */
  protected readonly firstFailure = computed<FirstFailureView | null>(() => {
    const run = this.snapshot();
    if (run === null) {
      return null;
    }

    for (const step of run.steps) {
      if (step.firstFailureSampleIndex === null) {
        continue;
      }

      const sampleIndex = step.firstFailureSampleIndex;
      const measurement = step.measurements.find((entry) => entry.sampleIndex === sampleIndex);

      return {
        stepPosition: step.position,
        stepName: step.name,
        unit: step.unit,
        sampleIndex,
        value: measurement?.value ?? null,
      };
    }

    return null;
  });

  protected readonly missingSampleCount = computed(() => {
    const run = this.snapshot();
    if (run === null) {
      return 0;
    }

    return Math.max(0, run.expectedSampleCount - run.recordedSampleCount);
  });

  protected readonly missingSamplePercent = computed(() => {
    const run = this.snapshot();
    if (run === null || run.expectedSampleCount === 0) {
      return null;
    }

    return Math.round((this.missingSampleCount() / run.expectedSampleCount) * 100);
  });

  protected readonly headerSubtitle = computed(() => {
    const run = this.snapshot();
    if (run === null) {
      return 'Review the recorded rules, samples, and outcome.';
    }

    return `${run.planName} · Version ${run.versionNumber} · ${runStatusLabel(run.status, run.outcome)}`;
  });

  protected readonly failureStepName = computed(() => {
    const run = this.snapshot();
    if (run === null || run.failureStepId === null) {
      return null;
    }

    const step = run.steps.find((entry) => entry.logicalStepId === run.failureStepId);
    return step === undefined
      ? `Unknown step (${run.failureStepId})`
      : `${step.name} (${step.unit})`;
  });

  protected readonly showCancelAction = computed(
    () => this.isOperator() && this.isRunning(),
  );

  protected readonly canCancel = computed(
    () =>
      this.showCancelAction() &&
      this.snapshot() !== null &&
      !this.runs.cancelPending(),
  );

  protected readonly showRunAgain = computed(
    () => this.isOperator() && this.isTerminal(),
  );

  protected readonly canRunAgain = computed(
    () =>
      this.showRunAgain() &&
      this.snapshot() !== null &&
      !this.runs.startPending(),
  );

  protected readonly isActiveRunConflict = computed(
    () => this.startFailure()?.error.code === 'RUN_ALREADY_ACTIVE',
  );
  protected readonly activeRunId = computed(() => this.startFailure()?.activeRunId ?? null);
  protected readonly isUnauthenticated = computed(
    () => this.startFailure()?.error.status === 401,
  );
  protected readonly isStartForbidden = computed(
    () => this.startFailure()?.error.status === 403,
  );
  protected readonly startFieldErrors = computed(
    () => this.startFailure()?.error.fieldErrors ?? [],
  );

  protected readonly startErrorHeading = computed(() => {
    const failure = this.startFailure();
    if (failure === null) {
      return 'The new run could not be started';
    }

    if (failure.error.code === 'RUN_ALREADY_ACTIVE') {
      return 'Another run is already active';
    }

    if (failure.error.code === 'IDEMPOTENCY_CONFLICT') {
      return 'This Run Again attempt was already used';
    }

    if (failure.error.status === 401) {
      return 'Your session has expired';
    }

    if (failure.error.status === 403) {
      return 'You cannot start a run';
    }

    return 'The new run could not be started';
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
      return 'This request key was already used with a different request. Choose Run again to send the same settings with a new key.';
    }

    if (failure.error.status === 401) {
      return 'Sign in again to start another run. The recorded run on this page has not changed.';
    }

    if (failure.error.status === 403) {
      return 'Starting a run requires the Operator role and a valid CSRF token. If you are an Operator, reload the page and try again.';
    }

    return `${failure.error.message} The recorded run on this page has not changed.`;
  });

  protected readonly cancelErrorHeading = computed(() => {
    const failure = this.cancelFailure();
    if (failure === null) {
      return 'The cancellation was not confirmed';
    }

    if (failure.status === 401) {
      return 'Your session has expired';
    }

    if (failure.status === 403) {
      return 'You cannot cancel this run';
    }

    if (failure.status === 404) {
      return 'The run was not found';
    }

    return 'The cancellation was not confirmed';
  });

  protected readonly cancelErrorMessage = computed(() => {
    const failure = this.cancelFailure();
    if (failure === null) {
      return '';
    }

    if (failure.status === 401) {
      return 'The run was not shown as cancelled. Sign in again and refresh the snapshot to see the server state.';
    }

    if (failure.status === 403) {
      return 'The run was not shown as cancelled. Cancelling requires the Operator role and a valid CSRF token; reload the page and try again.';
    }

    if (failure.status === 404) {
      return 'The server does not have this run. Refresh the snapshot to see whether it is still available.';
    }

    return `${failure.message} The run was not shown as cancelled; the last server snapshot is still displayed.`;
  });

  private readonly attempt = new RunStartAttempt();
  private cancelDialogOpen = false;

  constructor() {
    this.runs.clearStartError();
    this.runs.clearCancelError();
    this.loadIfPossible();

    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const nextRunId = params.get('runId') ?? '';
        if (nextRunId === this.runId()) {
          return;
        }

        this.runId.set(nextRunId);
        this.attempt.reset();
        this.announcement.set('');
        this.runs.clearStartError();
        this.runs.clearCancelError();
        this.loadIfPossible();
      });
  }

  protected retryLoad(): void {
    this.loadIfPossible();
  }

  protected refresh(): void {
    const runId = this.runId();
    if (runId.length === 0 || this.runs.refreshing()) {
      return;
    }

    this.runs
      .refreshRun(runId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.announcement.set('The latest run snapshot has been loaded.');
          this.focusAfterRender('run-snapshot-region');
        },
        error: () => this.focusAfterRender('refresh-error-panel'),
      });
  }

  protected requestCancel(): void {
    if (!this.canCancel() || this.cancelDialogOpen) {
      return;
    }

    const run = this.snapshot();
    if (run === null) {
      return;
    }

    const data: CancelRunDialogData = {
      planName: run.planName,
      versionNumber: run.versionNumber,
      recordedSampleCount: run.recordedSampleCount,
      expectedSampleCount: run.expectedSampleCount,
    };

    this.cancelDialogOpen = true;
    this.dialog
      .open<CancelRunDialog, CancelRunDialogData, boolean>(CancelRunDialog, {
        data,
        autoFocus: '#cancel-run-keep',
        restoreFocus: true,
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        this.cancelDialogOpen = false;
        if (confirmed === true) {
          this.confirmCancel(run.id);
        }
      });
  }

  protected startAgain(): void {
    if (!this.canRunAgain()) {
      return;
    }

    const run = this.snapshot();
    if (run === null) {
      return;
    }

    let request: StartRunRequest;
    try {
      request = buildRerunRequest(run);
    } catch {
      this.announcement.set(
        'This snapshot does not contain the settings required for a new run. No request was sent.',
      );
      this.focusAfterRender('run-snapshot-region');
      return;
    }

    const idempotencyKey = this.attempt.keyFor(request);
    this.runs
      .startRun(request, idempotencyKey)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.attempt.reset();
          void this.router.navigate(['/runs', result.runId]);
        },
        error: () => {
          if (this.runs.startError()?.error.code === 'IDEMPOTENCY_CONFLICT') {
            // A conflict is a definitive answer for this key. A later explicit
            // click is a new logical attempt and must not reuse it.
            this.attempt.reset();
          }
          this.focusAfterRender('rerun-error-panel');
        },
      });
  }

  protected scenario = scenarioLabel;
  protected stepStatus = stepStatusLabel;
  protected stepOutcome = stepOutcomeLabel;
  protected progress = progressLabel;

  private confirmCancel(runId: string): void {
    this.runs
      .cancelRun(runId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (snapshot) => {
          this.announcement.set(
            snapshot.status === 'CANCELLED'
              ? 'The server confirmed the cancellation. Recorded samples and completed step results are preserved.'
              : `The run was already ${runStatusLabel(snapshot.status, snapshot.outcome)}. Its existing result is shown unchanged.`,
          );
          this.refreshAfterCancel(runId);
        },
        error: () => this.focusAfterRender('cancel-error-panel'),
      });
  }

  /**
   * The cancel response already contains a full snapshot; the extra read
   * confirms it without ever treating a failed refresh as a successful cancel.
   */
  private refreshAfterCancel(runId: string): void {
    this.runs
      .refreshRun(runId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => undefined });
  }

  private loadIfPossible(): void {
    const runId = this.runId();
    if (runId.trim().length === 0) {
      return;
    }

    this.runs
      .loadRun(runId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => undefined });
  }

  private focusAfterRender(elementId: string): void {
    afterNextRender(() => document.getElementById(elementId)?.focus(), {
      injector: this.injector,
    });
  }
}
