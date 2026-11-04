import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
  buildComparisonChartConfig,
  buildComparisonSeriesPoints,
  buildComparisonSummary,
} from './comparison-chart.config';
import {
  isComparisonChartDebugEnabled,
  registerComparisonChartDebugEntry,
  unregisterComparisonChartDebugEntry,
  type ComparisonChartDebugEntry,
} from './comparison-chart.debug';
import { MEASUREMENT_CHART_FACTORY } from './measurement-chart.factory';
import type { MeasurementChartConfig, MeasurementChartHandle } from './measurement-chart.types';
import type {
  ComparisonChartSeries,
  ComparisonPointSelection,
  ComparisonSeriesVisibility,
} from './comparison-chart.types';

/**
 * Two recorded runs on one chart when both steps use the same unit.
 *
 * Each dataset uses its own run's elapsedMs, its own copied tolerance band,
 * and its own point styles. Toggling a series changes only dataset/annotation
 * visibility; the stored points, the other series, and both backend verdicts
 * stay untouched. Different-unit steps never reach this component; the screen
 * renders two separate MeasurementChart panels instead.
 */
@Component({
  selector: 'app-comparison-chart',
  imports: [MatButtonModule],
  templateUrl: './comparison-chart.html',
  styleUrl: './comparison-chart.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComparisonChart {
  readonly left = input.required<ComparisonChartSeries>();
  readonly right = input.required<ComparisonChartSeries>();

  readonly pointSelected = output<ComparisonPointSelection>();

  private readonly factory = inject(MEASUREMENT_CHART_FACTORY);
  private readonly destroyRef = inject(DestroyRef);
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('chartCanvas');

  protected readonly leftVisible = signal(true);
  protected readonly rightVisible = signal(true);
  protected readonly chartReady = signal(false);
  protected readonly chartUnavailable = signal(false);
  protected readonly announcement = signal('');

  protected readonly leftPoints = computed(() => buildComparisonSeriesPoints(this.left()));
  protected readonly rightPoints = computed(() => buildComparisonSeriesPoints(this.right()));
  protected readonly hasAnyPoints = computed(
    () => this.leftPoints().length > 0 || this.rightPoints().length > 0,
  );
  protected readonly bothHidden = computed(
    () => !this.leftVisible() && !this.rightVisible(),
  );
  protected readonly emptySeriesText = computed(() => {
    const leftEmpty = this.leftPoints().length === 0;
    const rightEmpty = this.rightPoints().length === 0;
    if (leftEmpty && rightEmpty) {
      return 'Neither run recorded a plottable sample for this step. No value or result is inferred.';
    }
    if (leftEmpty) {
      return 'The left run recorded no plottable sample for this step. The right series is shown without zero-filled left points.';
    }
    if (rightEmpty) {
      return 'The right run recorded no plottable sample for this step. The left series is shown without zero-filled right points.';
    }
    return null;
  });

  protected readonly headingId = computed(
    () => `comparison-chart-heading-${this.left().step.runStepId}-${this.right().step.runStepId}`,
  );
  protected readonly summaryId = computed(
    () => `comparison-chart-summary-${this.left().step.runStepId}-${this.right().step.runStepId}`,
  );
  protected readonly canvasLabel = computed(() => this.summary());

  protected readonly visibility = computed<ComparisonSeriesVisibility>(() => ({
    left: this.leftVisible(),
    right: this.rightVisible(),
  }));
  protected readonly summary = computed(() =>
    buildComparisonSummary(this.left(), this.right(), this.visibility()),
  );

  private chart: MeasurementChartHandle | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private debugEntry: ComparisonChartDebugEntry | null = null;

  constructor() {
    afterNextRender(() => this.createChart());

    effect(() => {
      const config = this.buildConfig();
      if (this.chart !== null) {
        this.chart.update(config);
      }
    });

    this.destroyRef.onDestroy(() => this.destroyChart());
  }

  protected toggleSide(side: 'left' | 'right'): void {
    if (side === 'left') {
      this.leftVisible.update((visible) => !visible);
      this.announceToggle('Left', this.leftVisible(), this.rightVisible());
      return;
    }

    this.rightVisible.update((visible) => !visible);
    this.announceToggle('Right', this.rightVisible(), this.leftVisible());
  }

  protected resetView(): void {
    if (this.chart === null) {
      return;
    }

    this.chart.resetZoom();
    this.announcement.set(
      'Chart view reset to the full recorded series. Zooming, panning, and series toggles never changed the recorded values or tolerance results.',
    );
  }

  protected seriesLabel(series: ComparisonChartSeries): string {
    return `Version ${series.versionNumber} · ${series.planName}`;
  }

  private announceToggle(
    toggled: 'Left' | 'Right',
    nowVisible: boolean,
    otherVisible: boolean,
  ): void {
    const other = toggled === 'Left' ? 'right' : 'left';
    const otherState = otherVisible ? 'still shown' : 'also hidden';
    this.announcement.set(
      `${toggled} series ${nowVisible ? 'shown' : 'hidden'}. The ${other} series is ${otherState}; recorded data and backend results did not change.`,
    );
  }

  private buildConfig(): MeasurementChartConfig {
    return buildComparisonChartConfig({
      left: this.left(),
      right: this.right(),
      visibility: this.visibility(),
      onPointSelected: (selection) => this.pointSelected.emit(selection),
    });
  }

  private createChart(): void {
    const canvas = this.canvas()?.nativeElement;
    if (canvas === undefined) {
      return;
    }

    try {
      this.chart = this.factory.create(canvas, this.buildConfig());
      this.chartReady.set(true);
      this.observeResize(canvas);
      const debug = this.chart.debug;
      if (debug !== undefined && isComparisonChartDebugEnabled()) {
        this.debugEntry = {
          canvas,
          leftVersionNumber: this.left().versionNumber,
          rightVersionNumber: this.right().versionNumber,
          leftStepName: this.left().step.name,
          rightStepName: this.right().step.name,
          debug,
        };
        registerComparisonChartDebugEntry(this.debugEntry);
      }
    } catch {
      this.chartUnavailable.set(true);
    }
  }

  private observeResize(canvas: HTMLCanvasElement): void {
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const container = canvas.parentElement;
    if (container === null) {
      return;
    }

    this.resizeObserver = new ResizeObserver(() => this.chart?.resize());
    this.resizeObserver.observe(container);
  }

  private destroyChart(): void {
    if (this.debugEntry !== null) {
      unregisterComparisonChartDebugEntry(this.debugEntry);
      this.debugEntry = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.chart?.destroy();
    this.chart = null;
  }
}
