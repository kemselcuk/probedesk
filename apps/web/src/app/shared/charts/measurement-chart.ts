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
  buildMeasurementChartConfig,
  buildMeasurementChartPoints,
  buildMeasurementSummary,
  formatUtcTimestamp,
} from './measurement-chart.config';
import { MEASUREMENT_CHART_FACTORY } from './measurement-chart.factory';
import type {
  MeasurementChartHandle,
  MeasurementChartStep,
  MeasurementSelection,
} from './measurement-chart.types';

interface FailureSampleView {
  readonly sampleIndex: number;
  readonly value: string;
  readonly elapsedMs: number;
  readonly recordedAtUtc: string;
  readonly isFirstFailure: boolean;
}

/**
 * One recorded step on a Chart.js line chart.
 *
 * The component owns the chart instance and the Chart.js boundary: feature
 * screens pass snapshot data and receive a logical selection. Verdicts come
 * exclusively from the backend `isWithinTolerance` flags; the numeric value is
 * converted only for plotting. A hidden text summary, a shape legend, a
 * per-step failure list, and the measurement table provide non-canvas access.
 */
@Component({
  selector: 'app-measurement-chart',
  imports: [MatButtonModule],
  templateUrl: './measurement-chart.html',
  styleUrl: './measurement-chart.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MeasurementChart {
  readonly runId = input.required<string>();
  readonly planName = input.required<string>();
  readonly step = input.required<MeasurementChartStep>();
  readonly selectedSample = input<MeasurementSelection | null>(null);

  readonly sampleSelected = output<MeasurementSelection>();
  readonly tableViewRequested = output<string>();

  private readonly factory = inject(MEASUREMENT_CHART_FACTORY);
  private readonly destroyRef = inject(DestroyRef);
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('chartCanvas');

  protected readonly chartReady = signal(false);
  protected readonly chartUnavailable = signal(false);
  protected readonly announcement = signal('');

  protected readonly points = computed(() => buildMeasurementChartPoints(this.step().measurements));
  protected readonly hasPoints = computed(() => this.points().length > 0);
  protected readonly summary = computed(() => buildMeasurementSummary(this.step(), this.points()));
  protected readonly headingId = computed(() => `chart-heading-${this.step().runStepId}`);
  protected readonly summaryId = computed(() => `chart-summary-${this.step().runStepId}`);
  protected readonly failureListId = computed(() => `chart-failures-${this.step().runStepId}`);
  protected readonly selectedIndex = computed(() => {
    const selection = this.selectedSample();
    return selection !== null && selection.logicalStepId === this.step().logicalStepId
      ? selection.sampleIndex
      : null;
  });

  protected readonly canvasLabel = computed(() => {
    const step = this.step();
    const failures = step.measurements.filter((measurement) => !measurement.isWithinTolerance);
    return `Measurement chart for step ${step.position}: ${step.name}, in ${step.unit}. ${this.points().length} plotted samples, ${failures.length} outside tolerance. The accessible summary and measurement table contain the same recorded values.`;
  });

  protected readonly failureSamples = computed<FailureSampleView[]>(() => {
    const step = this.step();
    return step.measurements
      .filter((measurement) => !measurement.isWithinTolerance)
      .map((measurement) => ({
        sampleIndex: measurement.sampleIndex,
        value: measurement.value,
        elapsedMs: measurement.elapsedMs,
        recordedAtUtc: formatUtcTimestamp(measurement.recordedAt),
        isFirstFailure: measurement.sampleIndex === step.firstFailureSampleIndex,
      }));
  });

  private chart: MeasurementChartHandle | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor() {
    afterNextRender(() => this.createChart());

    // Data or selection changes update the existing instance; they never
    // create a second chart for the same step.
    effect(() => {
      const config = buildMeasurementChartConfig({
        runId: this.runId(),
        planName: this.planName(),
        step: this.step(),
        selectedSampleIndex: this.selectedIndex(),
        onPointSelected: (selection) => this.sampleSelected.emit(selection),
      });

      if (this.chart !== null) {
        this.chart.update(config);
      }
    });

    this.destroyRef.onDestroy(() => this.destroyChart());
  }

  protected resetView(): void {
    if (this.chart === null) {
      return;
    }

    this.chart.resetZoom();
    this.announcement.set(
      'Chart view reset to the full recorded series. Zooming and panning never changed the recorded values or tolerance results.',
    );
  }

  protected selectFailure(sampleIndex: number): void {
    this.sampleSelected.emit({
      logicalStepId: this.step().logicalStepId,
      sampleIndex,
    });
  }

  protected requestTable(event: Event): void {
    event.preventDefault();
    this.tableViewRequested.emit(this.step().logicalStepId);
  }

  private createChart(): void {
    const canvas = this.canvas()?.nativeElement;
    if (canvas === undefined) {
      return;
    }

    try {
      this.chart = this.factory.create(
        canvas,
        buildMeasurementChartConfig({
          runId: this.runId(),
          planName: this.planName(),
          step: this.step(),
          selectedSampleIndex: this.selectedIndex(),
          onPointSelected: (selection) => this.sampleSelected.emit(selection),
        }),
      );
      this.chartReady.set(true);
      this.observeResize(canvas);
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
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.chart?.destroy();
    this.chart = null;
    this.chartReady.set(false);
  }
}
