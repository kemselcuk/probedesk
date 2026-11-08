import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { MEASUREMENT_CHART_FACTORY } from '../../shared/charts/measurement-chart.factory';
import {
  buildMeasurementChartConfig,
  buildMeasurementChartPoints,
  buildMeasurementSummary,
} from '../../shared/charts/measurement-chart.config';
import type {
  MeasurementChartHandle,
  MeasurementChartStep,
} from '../../shared/charts/measurement-chart.types';
@Component({
  selector: 'app-report-chart',
  template: `<div class="chart-frame">
      <canvas #canvas role="img" [attr.aria-label]="summary()"></canvas>
    </div>
    @if (printImage(); as image) {
      <img class="print-chart" [src]="image" [alt]="summary()" />
    }
    @if (state() === 'error') {
      <p role="alert">
        The chart could not be drawn. Printing is unavailable; recorded rules and statistics remain
        visible.
      </p>
    }
    @if (step().measurements.length === 0) {
      <p>No samples recorded. The chart shows copied tolerance rules only.</p>
    }
    <p class="chart-summary">{{ summary() }}</p>`,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .chart-frame {
      height: 17rem;
      position: relative;
    }
    .print-chart {
      display: none;
    }
    p {
      font-size: var(--pd-font-meta-size);
      line-height: var(--pd-font-body-relaxed-line);
    }
    @media print {
      .chart-frame {
        display: none;
      }
      .print-chart {
        display: block;
        width: 100%;
        height: auto;
        max-height: 72mm;
        object-fit: contain;
      }
      .chart-summary {
        font-size: 9pt;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportChart {
  readonly runId = input.required<string>();
  readonly planName = input.required<string>();
  readonly step = input.required<MeasurementChartStep>();
  readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  readonly printImage = signal<string | null>(null);
  private readonly factory = inject(MEASUREMENT_CHART_FACTORY);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private chart: MeasurementChartHandle | null = null;
  protected summary(): string {
    return buildMeasurementSummary(
      this.step(),
      buildMeasurementChartPoints(this.step().measurements),
    );
  }
  constructor() {
    afterNextRender(() => {
      try {
        this.chart = this.factory.create(this.canvas().nativeElement, this.config());
        this.state.set('ready');
      } catch {
        this.state.set('error');
      }
    });
    effect(() => {
      const config = this.config();
      this.printImage.set(null);
      if (this.chart) {
        try {
          this.chart.update(config);
        } catch {
          this.state.set('error');
        }
      }
    });
    inject(DestroyRef).onDestroy(() => {
      this.chart?.destroy();
      this.chart = null;
    });
  }
  /** Capture the fully drawn screen canvas before print layout changes its size. */
  preparePrint(): boolean {
    if (!this.chart || this.state() !== 'ready') return false;
    try {
      this.chart.resetZoom();
      this.chart.resize();
      this.chart.update(this.config());
      const canvas = this.canvas().nativeElement;
      if (canvas.width === 0 || canvas.height === 0) throw Error('Canvas has no dimensions.');
      const image = canvas.toDataURL('image/png');
      if (!image.startsWith('data:image/png;base64,')) throw Error('Canvas capture failed.');
      this.printImage.set(image);
      return true;
    } catch {
      this.state.set('error');
      this.printImage.set(null);
      return false;
    }
  }
  private config() {
    return buildMeasurementChartConfig({
      runId: this.runId(),
      planName: this.planName(),
      step: this.step(),
      selectedSampleIndex: null,
      onPointSelected: () => undefined,
    });
  }
}
