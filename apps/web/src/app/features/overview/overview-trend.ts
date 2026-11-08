import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  InjectionToken,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Chart, type ChartConfiguration } from 'chart.js';
import { registerChartJs } from '../../shared/charts/chart-js.setup';
import type { TrendDay } from './analytics-api';

type Config = ChartConfiguration<'line', { x: number; y: number }[], number>;
export interface OverviewChartHandle {
  update(config: Config): void;
  destroy(): void;
}
export const OVERVIEW_CHART_FACTORY = new InjectionToken<
  (canvas: HTMLCanvasElement, config: Config) => OverviewChartHandle
>('OVERVIEW_CHART_FACTORY', {
  providedIn: 'root',
  factory: () => (canvas, config) => {
    registerChartJs();
    const context = canvas.getContext('2d');
    if (!context) throw Error('A 2D canvas is required.');
    const chart = new Chart(context, config);
    return {
      update(next) {
        chart.data = next.data;
        chart.options = next.options ?? {};
        chart.update('none');
      },
      destroy() {
        chart.destroy();
      },
    };
  },
});
@Component({
  selector: 'app-overview-trend',
  template: `<div class="legend" aria-hidden="true">
      <span>● Total</span><span>▲ Passed</span><span>■ Failed</span>
    </div>
    <div class="chart">
      <canvas
        #canvas
        role="img"
        aria-label="Daily total, passed and failed run counts. Use the daily results table below for exact values and history links."
      ></canvas>
    </div>
    @if (unavailable()) {
      <p role="status">
        The chart is unavailable. The daily results table below contains all recorded counts.
      </p>
    }`,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .legend {
      display: flex;
      gap: var(--pd-space-4);
      flex-wrap: wrap;
      font-size: var(--pd-font-meta-size);
      margin-bottom: var(--pd-space-3);
    }
    .legend span:nth-child(1) {
      color: #2563a8;
    }
    .legend span:nth-child(2) {
      color: #137566;
    }
    .legend span:nth-child(3) {
      color: #b3261e;
    }
    .chart {
      position: relative;
      height: 17rem;
      min-width: 0;
    }
    p {
      line-height: var(--pd-font-body-relaxed-line);
      color: var(--pd-text-secondary);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OverviewTrend {
  readonly days = input.required<readonly TrendDay[]>();
  readonly daySelected = output<string>();
  protected readonly unavailable = signal(false);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly factory = inject(OVERVIEW_CHART_FACTORY);
  private chart: OverviewChartHandle | null = null;
  constructor() {
    afterNextRender(() => {
      try {
        this.chart = this.factory(this.canvas().nativeElement, this.config());
      } catch {
        this.unavailable.set(true);
      }
    });
    effect(() => {
      const config = this.config();
      this.chart?.update(config);
    });
    inject(DestroyRef).onDestroy(() => {
      this.chart?.destroy();
      this.chart = null;
    });
  }
  private config(): Config {
    const days = this.days();
    return {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Total',
            borderColor: '#2563a8',
            backgroundColor: '#2563a8',
            pointStyle: 'circle',
            data: days.map((day, x) => ({ x, y: day.totalRuns })),
          },
          {
            label: 'Passed',
            borderColor: '#137566',
            backgroundColor: '#137566',
            pointStyle: 'triangle',
            borderDash: [5, 3],
            data: days.map((day, x) => ({ x, y: day.passedRuns })),
          },
          {
            label: 'Failed',
            borderColor: '#b3261e',
            backgroundColor: '#b3261e',
            pointStyle: 'rect',
            borderDash: [2, 3],
            data: days.map((day, x) => ({ x, y: day.failedRuns })),
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        parsing: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { title: (items) => days[items[0]?.dataIndex ?? -1]?.date ?? '' } },
        },
        scales: {
          x: {
            type: 'linear',
            min: 0,
            max: Math.max(0, days.length - 1),
            ticks: {
              maxTicksLimit: 8,
              precision: 0,
              callback: (value) => days[Number(value)]?.date.slice(5) ?? '',
            },
            title: { display: true, text: 'UTC day' },
          },
          y: { beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: 'Runs' } },
        },
        onClick: (_event, active) => {
          const date = days[active[0]?.index ?? -1]?.date;
          if (date) this.daySelected.emit(date);
        },
      },
    };
  }
}
