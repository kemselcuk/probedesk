import { DOCUMENT, DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
  viewChildren,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { LoadingState } from '../../shared/ui/loading-state/loading-state';
import { ErrorState } from '../../shared/ui/error-state/error-state';
import { RunDeviceMetadata } from '../runs/run-device-metadata';
import { RunStatusBadge } from '../runs/run-status-badge';
import {
  scenarioLabel,
  stepStatusLabel,
  stepOutcomeLabel,
  isPartialSampleSet,
  isStoppedWithAllSamples,
} from '../runs/run-status';
import { RunExportActions } from './run-export-actions';
import { ReportFacade } from './report.facade';
import { ReportChart } from './report-chart';
@Component({
  selector: 'app-run-report-page',
  imports: [
    DatePipe,
    RouterLink,
    MatButtonModule,
    PageHeader,
    LoadingState,
    ErrorState,
    RunDeviceMetadata,
    RunStatusBadge,
    RunExportActions,
    ReportChart,
  ],
  providers: [ReportFacade],
  templateUrl: './run-report-page.html',
  styleUrl: './run-report-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RunReportPage {
  protected readonly facade = inject(ReportFacade);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly cdr = inject(ChangeDetectorRef);
  protected readonly id = signal('');
  protected readonly invalid = signal(false);
  protected readonly fontsReady = signal(false);
  protected readonly printing = signal(false);
  protected readonly prepared = signal(false);
  protected readonly printError = signal('');
  private readonly charts = viewChildren(ReportChart);
  private printGeneration = 0;
  protected readonly canPrint = computed(() => {
    const run = this.facade.data();
    return (
      !!run &&
      this.fontsReady() &&
      !this.printing() &&
      this.charts().length === run.steps.length &&
      this.charts().every((chart) => chart.state() === 'ready')
    );
  });
  protected readonly isPartialSampleSet = isPartialSampleSet;
  protected readonly isStoppedWithAllSamples = isStoppedWithAllSamples;
  protected readonly scenarioLabel = scenarioLabel;
  protected readonly stepStatusLabel = stepStatusLabel;
  protected readonly stepOutcomeLabel = stepOutcomeLabel;
  constructor() {
    this.document.body.classList.add('pd-print-report');
    inject(ActivatedRoute)
      .paramMap.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const id = params.get('runId') ?? '';
        this.id.set(id);
        this.resetPrint();
        const valid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
        this.invalid.set(!valid);
        this.facade.load(valid ? id : null);
      });
    void (this.document.fonts?.ready ?? Promise.resolve()).then(() => {
      if (!this.destroyRef.destroyed) this.fontsReady.set(true);
    });
    const beforePrint = () => {
      if (!this.prepared()) this.preparePrint();
      this.cdr.detectChanges();
    };
    const afterPrint = () => {
      this.printing.set(false);
    };
    this.document.defaultView?.addEventListener('beforeprint', beforePrint);
    this.document.defaultView?.addEventListener('afterprint', afterPrint);
    this.destroyRef.onDestroy(() => {
      this.document.body.classList.remove('pd-print-report');
      this.document.defaultView?.removeEventListener('beforeprint', beforePrint);
      this.document.defaultView?.removeEventListener('afterprint', afterPrint);
    });
  }
  protected reload(): void {
    this.resetPrint();
    this.facade.load(this.id());
  }
  protected async print(): Promise<void> {
    if (!this.canPrint()) return;
    if (!this.preparePrint()) return;
    const printedReport = this.facade.data();
    const generation = ++this.printGeneration;
    const isCurrent = () =>
      !this.destroyRef.destroyed &&
      generation === this.printGeneration &&
      this.facade.data() === printedReport;
    this.printing.set(true);
    this.cdr.detectChanges();
    // Let the captured PNGs decode before handing the document to native print.
    const images = Array.from(
      this.document.querySelectorAll<HTMLImageElement>('app-report-chart .print-chart'),
    );
    try {
      await Promise.all(images.map((image) => image.decode()));
      if (!isCurrent()) return;
      this.document.defaultView?.print();
    } catch {
      if (!isCurrent()) return;
      this.printError.set(
        'Charts could not be prepared for printing. Retry after reloading the report.',
      );
      this.prepared.set(false);
    } finally {
      if (isCurrent()) this.printing.set(false);
    }
  }
  private resetPrint(): void {
    this.printGeneration++;
    this.printing.set(false);
    this.prepared.set(false);
    this.printError.set('');
  }
  private preparePrint(): boolean {
    const run = this.facade.data();
    const ready =
      !!run &&
      this.fontsReady() &&
      this.charts().length === run.steps.length &&
      this.charts().every((chart) => chart.state() === 'ready');
    const captured =
      ready &&
      this.charts()
        .map((chart) => chart.preparePrint())
        .every(Boolean);
    this.prepared.set(captured);
    this.printError.set(
      captured
        ? ''
        : 'The report is not ready to print. Wait for fonts and charts, or reload after a chart failure.',
    );
    return captured;
  }
}
