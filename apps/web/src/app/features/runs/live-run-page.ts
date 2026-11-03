import { DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthFacade } from '../../core/auth/auth.facade';
import type { RunConnectionState } from '../../core/runs/run-events.service';
import { MeasurementChart } from '../../shared/charts/measurement-chart';
import type { MeasurementSelection } from '../../shared/charts/measurement-chart.types';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { ErrorState } from '../../shared/ui/error-state/error-state';
import { LoadingState } from '../../shared/ui/loading-state/loading-state';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { CancelRunDialog } from './cancel-run-dialog';
import type { CancelRunDialogData } from './cancel-run-dialog';
import { LiveRunFacade } from './live-run.facade';
import {
  findSelectedMeasurement,
  findStepByLogicalStepId,
  measurementRowId,
  measurementsTableId,
} from './run-details-chart';
import {
  isPartialResult,
  isStoppedAfterAllSamples,
  progressLabel,
  runStatusView,
  scenarioLabel,
  stepOutcomeLabel,
  stepStatusLabel,
} from './run-status';
import type { RunSnapshotStep } from './runs-api.types';

interface ConnectionView {
  readonly label: string;
  readonly detail: string;
  readonly tone: 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'unauthenticated';
}

const CONNECTION_VIEWS: Readonly<Record<RunConnectionState, ConnectionView>> = {
  connecting: {
    label: 'Connecting',
    detail: 'Opening the live event stream for this run.',
    tone: 'connecting',
  },
  connected: {
    label: 'Connected',
    detail: 'Receiving live updates from the server.',
    tone: 'connected',
  },
  reconnecting: {
    label: 'Reconnecting',
    detail:
      'The live stream was interrupted. Retrying from the last received event; the run keeps executing on the server.',
    tone: 'reconnecting',
  },
  disconnected: {
    label: 'Disconnected',
    detail:
      'No live stream is open. The last state received from the server is shown.',
    tone: 'disconnected',
  },
  unauthenticated: {
    label: 'Signed out',
    detail:
      'Your session has expired. Sign in again to continue watching; the run itself keeps executing.',
    tone: 'unauthenticated',
  },
};

/**
 * Live Run screen.
 *
 * Run status and connection status are separate labels. Progress comes from the
 * backend counters, the first out-of-tolerance sample is marked as soon as its
 * event arrives, and a terminal state is only shown after the backend says so.
 * Cancelling is an Operator action and waits for the server response.
 */
@Component({
  selector: 'app-live-run-page',
  imports: [
    DatePipe,
    DecimalPipe,
    EmptyState,
    ErrorState,
    LoadingState,
    MatButtonModule,
    MeasurementChart,
    PageHeader,
    RouterLink,
  ],
  templateUrl: './live-run-page.html',
  styleUrl: './live-run-page.scss',
  providers: [LiveRunFacade],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveRunPage {
  protected readonly live = inject(LiveRunFacade);
  protected readonly auth = inject(AuthFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  protected readonly runId = signal(
    this.route.snapshot.paramMap.get('runId') ?? '',
  );
  protected readonly missingRunId = computed(
    () => this.runId().trim().length === 0,
  );
  protected readonly isOperator = computed(
    () => this.auth.role() === 'OPERATOR',
  );

  protected readonly statusView = computed(() => {
    const run = this.live.snapshot();
    return run === null ? null : runStatusView(run.status, run.outcome);
  });

  protected readonly connection = computed<ConnectionView>(() => {
    const state = this.live.connection();
    const view = CONNECTION_VIEWS[state];
    if (state === 'disconnected' && this.live.isTerminal()) {
      return {
        ...view,
        detail: 'This run is terminal. No live stream is open.',
      };
    }

    return view;
  });

  protected readonly headerSubtitle = computed(() => {
    const run = this.live.snapshot();
    if (run === null) {
      return 'Follow execution progress and measurements as they arrive.';
    }

    return `${run.planName} · Version ${run.versionNumber} · ${this.statusView()?.label ?? run.status}`;
  });

  protected readonly progressPercent = this.live.progressPercent;

  protected readonly partialResults = computed(() => {
    const run = this.live.snapshot();
    return run !== null && isPartialResult(run);
  });

  protected readonly stoppedAfterAllSamples = computed(() => {
    const run = this.live.snapshot();
    return run !== null && isStoppedAfterAllSamples(run);
  });

  protected readonly showCancelAction = computed(
    () => this.isOperator() && this.live.isRunning(),
  );

  protected readonly canCancel = computed(
    () =>
      this.showCancelAction() &&
      this.live.snapshot() !== null &&
      !this.live.cancelPending(),
  );

  protected readonly terminalSummary = computed(() => {
    const run = this.live.snapshot();
    if (run === null || run.status === 'RUNNING') {
      return null;
    }

    switch (run.status) {
      case 'COMPLETED':
        return run.outcome === 'PASSED'
          ? 'The run completed and every step passed.'
          : run.outcome === 'FAILED'
            ? 'The run completed and at least one step failed.'
            : 'The run completed without an overall outcome. No verdict is inferred.';
      case 'CANCELLED':
        return `The run was cancelled after ${run.recordedSampleCount} of ${run.expectedSampleCount} samples. Completed step results are preserved.`;
      case 'INTERRUPTED':
        return `The server interrupted the run after ${run.recordedSampleCount} of ${run.expectedSampleCount} samples. Completed step results are preserved.`;
      case 'ERROR':
        return 'The run stopped because of a technical error. This is not a tolerance result.';
    }
  });

  protected readonly cancelErrorMessage = computed(() => {
    const failure = this.live.cancelError();
    if (failure === null) {
      return '';
    }

    if (failure.status === 401) {
      return 'Your session has expired. The run was not shown as cancelled; sign in again and reload the snapshot.';
    }

    if (failure.status === 403) {
      return 'Cancelling requires the Operator role and a valid CSRF token. If you are an Operator, reload the page and try again.';
    }

    if (failure.status === 404) {
      return 'The server does not have this run. Reload the snapshot to see whether it is still available.';
    }

    return `${failure.message} The run was not shown as cancelled; the last server state is still displayed.`;
  });

  protected readonly announcement = signal('');
  protected readonly selectedSample = signal<MeasurementSelection | null>(null);

  /**
   * A selection survives re-renders only while the exact step and sample are
   * still in the chart snapshot. It is passed to every chart, but only the
   * matching step highlights it.
   */
  protected readonly activeSelection = computed<MeasurementSelection | null>(() => {
    const selection = this.selectedSample();
    const run = this.live.chartSnapshot();
    if (selection === null || run === null) {
      return null;
    }

    return findSelectedMeasurement(run, selection) === null ? null : selection;
  });

  /** Number of samples currently drawn and listed by the grouped visual copy. */
  protected readonly chartSampleCount = computed(() => {
    const run = this.live.chartSnapshot();
    if (run === null) {
      return 0;
    }

    return run.steps.reduce(
      (total, step) => total + step.measurements.length,
      0,
    );
  });

  private cancelDialogOpen = false;

  constructor() {
    this.loadIfPossible();

    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const nextRunId = params.get('runId') ?? '';
        if (nextRunId === this.runId()) {
          return;
        }

        this.runId.set(nextRunId);
        this.live.clearCancelError();
        this.selectedSample.set(null);
        this.announcement.set('');
        this.loadIfPossible();
      });

    effect(() => {
      const selection = this.selectedSample();
      const run = this.live.chartSnapshot();
      if (
        selection !== null &&
        run !== null &&
        findSelectedMeasurement(run, selection) === null
      ) {
        this.selectedSample.set(null);
      }
    });
  }

  protected retry(): void {
    this.live.retry();
  }

  protected reload(): void {
    this.live.load(this.runId());
  }

  protected requestCancel(): void {
    if (!this.canCancel() || this.cancelDialogOpen) {
      return;
    }

    const run = this.live.snapshot();
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
          this.live.cancel();
          this.announcement.set(
            'Cancellation requested. Waiting for the server to confirm the terminal state.',
          );
        }
      });
  }

  protected isFirstViolation(step: RunSnapshotStep): boolean {
    return step.hasOutOfTolerance;
  }

  /**
   * A terminal event can arrive before the final snapshot that carries the
   * authoritative step statuses. When that snapshot never loads, RUNNING or
   * PENDING rows are stale by definition and must not be read as current.
   */
  protected stepStateUnavailable(step: RunSnapshotStep): boolean {
    return (
      this.live.finalStepStateUnavailable() &&
      (step.status === 'RUNNING' || step.status === 'PENDING')
    );
  }

  /**
   * One selection path for chart points, chart failure lists, the summary
   * link, and measurement rows. The matching row is focused after rendering;
   * the chart highlight is derived from the same logical step + sample index.
   */
  protected selectSample(selection: MeasurementSelection): void {
    const run = this.live.chartSnapshot();
    if (run === null) {
      return;
    }

    const resolved = findSelectedMeasurement(run, selection);
    if (resolved === null) {
      return;
    }

    this.selectedSample.set(selection);
    const { step, measurement } = resolved;
    const tolerance = measurement.isWithinTolerance
      ? 'Within tolerance'
      : 'Outside tolerance';
    this.announcement.set(
      `${tolerance}: sample ${measurement.sampleIndex} of step ${step.position}, ${step.name}, value ${measurement.value} ${step.unit}, elapsed ${measurement.elapsedMs} ms. The measurement row is focused in the table.`,
    );
    this.focusAfterRender(
      measurementRowId(step.runStepId, measurement.sampleIndex),
    );
  }

  protected selectMeasurementRow(
    step: RunSnapshotStep,
    sampleIndex: number,
  ): void {
    this.selectSample({ logicalStepId: step.logicalStepId, sampleIndex });
  }

  protected isSampleSelected(
    step: RunSnapshotStep,
    sampleIndex: number,
  ): boolean {
    const selection = this.activeSelection();
    return (
      selection !== null &&
      selection.logicalStepId === step.logicalStepId &&
      selection.sampleIndex === sampleIndex
    );
  }

  /** Failure rows are tab stops; every row can still receive programmatic focus. */
  protected measurementRowTabIndex(isWithinTolerance: boolean): number {
    return isWithinTolerance ? -1 : 0;
  }

  protected measurementRowLabel(
    step: RunSnapshotStep,
    sampleIndex: number,
  ): string | null {
    const run = this.live.chartSnapshot();
    if (run === null) {
      return null;
    }

    const resolved = findSelectedMeasurement(run, {
      logicalStepId: step.logicalStepId,
      sampleIndex,
    });
    if (resolved === null || resolved.measurement.isWithinTolerance) {
      return null;
    }

    return `Sample ${sampleIndex}, outside tolerance, value ${resolved.measurement.value} ${step.unit}. Select to highlight it in the chart.`;
  }

  protected focusMeasurementsTable(logicalStepId: string): void {
    const run = this.live.chartSnapshot();
    if (run === null) {
      return;
    }

    const step = findStepByLogicalStepId(run, logicalStepId);
    if (step === null) {
      return;
    }

    this.announcement.set(
      `Measurement table for step ${step.position}, ${step.name}, is focused. It contains the same recorded values and backend tolerance results as the chart.`,
    );
    this.focusAfterRender(measurementsTableId(step.runStepId));
  }

  protected scenario = scenarioLabel;
  protected stepStatus = stepStatusLabel;
  protected stepOutcome = stepOutcomeLabel;
  protected progress = progressLabel;
  protected tableId = measurementsTableId;
  protected rowId = measurementRowId;

  private loadIfPossible(): void {
    const runId = this.runId();
    if (runId.trim().length === 0) {
      return;
    }

    this.live.load(runId);
  }

  private focusAfterRender(elementId: string): void {
    afterNextRender(() => document.getElementById(elementId)?.focus(), {
      injector: this.injector,
    });
  }
}
