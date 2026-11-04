import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { ComparisonChart } from '../../shared/charts/comparison-chart';
import { MeasurementChart } from '../../shared/charts/measurement-chart';
import type { ComparisonStepSide, ComparisonStepView } from './comparison-view';
import {
  changedFieldLabels,
  chartPanelId,
  evaluationRows,
  measurementTableId,
  ruleRows,
  sidesOf,
  statisticRows,
  stepDataNote,
  stepOutcomeText,
  stepStatusText,
} from './comparison-view';

/**
 * One server-matched step inside the comparison.
 *
 * Shared steps show both recorded rule snapshots side by side with changed
 * fields highlighted. Added/removed steps stay one-sided. Stored outcomes and
 * tolerance flags are displayed as recorded; this card never recomputes them.
 */
@Component({
  selector: 'app-comparison-step-card',
  imports: [ComparisonChart, DatePipe, MatCardModule, MeasurementChart],
  templateUrl: './comparison-step-card.html',
  styleUrl: './comparison-step-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComparisonStepCard {
  readonly view = input.required<ComparisonStepView>();

  protected readonly announcement = signal('');
  protected readonly sides = computed(() => sidesOf(this.view()));
  protected readonly rules = computed(() => ruleRows(this.view()));
  protected readonly statistics = computed(() => statisticRows(this.view()));
  protected readonly evaluation = computed(() => evaluationRows(this.view()));
  protected readonly changedLabels = computed(() => changedFieldLabels(this.view()));
  protected readonly headingId = computed(
    () => `comparison-step-heading-${this.view().logicalStepId}`,
  );
  protected readonly sameUnit = computed(
    () => this.view().presence === 'matched' && this.view().sameUnit,
  );
  protected readonly unitChanged = computed(
    () => this.view().presence === 'matched' && this.view().unitChanged,
  );
  protected readonly comparisonLeft = computed(() => this.view().left?.chartSeries ?? null);
  protected readonly comparisonRight = computed(() => this.view().right?.chartSeries ?? null);
  protected readonly ruleTableCaption = computed(() => {
    const view = this.view();
    if (view.presence === 'matched') {
      return `Recorded rule fields and stored step evaluation for shared step ${view.positionText.toLowerCase()}: ${view.nameText}. Left and right columns come from each run's immutable snapshot.`;
    }

    const side = view.presence === 'added' ? 'right' : 'left';
    return `Recorded rule fields and stored step evaluation for the ${side} run. The other run has no step with this logicalStepId; no absent values are shown.`;
  });
  protected readonly measurementCaption = (side: ComparisonStepSide) =>
    `${side.runLabel} version ${side.run.versionNumber} recorded measurements for step ${side.step.position}: ${side.step.name}, in ${side.step.unit}.`;
  protected readonly tableId = measurementTableId;
  protected readonly panelId = chartPanelId;
  protected readonly sideNote = stepDataNote;
  protected readonly statusText = stepStatusText;
  protected readonly outcomeText = stepOutcomeText;

  protected presenceTitle(): string {
    switch (this.view().presence) {
      case 'matched':
        return 'Shared step';
      case 'added':
        return 'Only in the right run';
      case 'removed':
        return 'Only in the left run';
    }
  }

  protected presenceMessage(): string {
    switch (this.view().presence) {
      case 'matched':
        return 'Matched by logicalStepId, not by name or position.';
      case 'added':
        return 'This logicalStepId exists only in the right run. The left side is intentionally absent, not zero-filled.';
      case 'removed':
        return 'This logicalStepId exists only in the left run. The right side is intentionally absent, not zero-filled.';
    }
  }

  protected sideRunLabel(side: ComparisonStepSide): string {
    return `${side.runLabel} · Version ${side.run.versionNumber}`;
  }

  protected firstFailureText(side: ComparisonStepSide): string {
    return side.step.firstFailureSampleIndex === null
      ? 'None recorded'
      : `Sample ${side.step.firstFailureSampleIndex}`;
  }

  protected recordedSampleText(side: ComparisonStepSide): string {
    return `${side.step.recordedCount} of ${side.step.sampleCount}`;
  }

  /**
   * The single-run MeasurementChart emits this after preventing its anchor's
   * default. Focusing the matching comparison table keeps the chart's "View
   * measurements" action working inside a comparison card.
   */
  protected focusMeasurementTable(
    side: ComparisonStepSide,
    _logicalStepId: string,
  ): void {
    const table = document.getElementById(`measurements-table-${side.step.runStepId}`);
    if (table === null) {
      return;
    }

    table.focus();
    this.announcement.set(
      'The recorded measurement table for this run is focused. It contains the same stored samples as the chart.',
    );
  }
}
