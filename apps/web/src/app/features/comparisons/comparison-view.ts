import type { ComparisonChartSeries } from '../../shared/charts/comparison-chart.types';
import {
  runStatusLabel,
  scenarioLabel,
  stepOutcomeLabel,
  stepStatusLabel,
} from '../runs/run-status';
import type { RunSnapshotStep } from '../runs/runs-api.types';
import type {
  ComparisonChangedField,
  ComparisonMatchedStep,
  ComparisonNumericComparison,
  ComparisonResult,
  ComparisonRuleField,
  ComparisonRunSummary,
} from './comparisons-api.types';

export type ComparisonPresence = 'matched' | 'added' | 'removed';
export type ComparisonSideKey = 'left' | 'right';

export interface ComparisonStepSide {
  readonly key: ComparisonSideKey;
  readonly runLabel: 'Left run' | 'Right run';
  readonly run: ComparisonRunSummary;
  readonly step: RunSnapshotStep;
  readonly chartSeries: ComparisonChartSeries;
}

export interface ComparisonStepView {
  readonly key: string;
  readonly logicalStepId: string;
  readonly presence: ComparisonPresence;
  readonly left: ComparisonStepSide | null;
  readonly right: ComparisonStepSide | null;
  readonly changedFields: readonly ComparisonChangedField[];
  readonly changedFieldSet: ReadonlySet<ComparisonRuleField>;
  readonly numericComparison: ComparisonNumericComparison | null;
  readonly sameUnit: boolean;
  readonly unitChanged: boolean;
  readonly heading: string;
  readonly positionText: string;
  readonly nameText: string;
  readonly leftPartial: boolean;
  readonly rightPartial: boolean;
}

export interface ComparisonRuleRow {
  readonly field: ComparisonRuleField;
  readonly label: string;
  readonly leftValue: string | null;
  readonly rightValue: string | null;
  readonly changed: boolean;
}

export interface ComparisonStatRow {
  readonly key: string;
  readonly label: string;
  readonly leftValue: string | null;
  readonly rightValue: string | null;
  /** right - left from the API; null when a side is missing or units differ. */
  readonly deltaValue: string | null;
  readonly comparable: boolean;
  readonly different: boolean;
}

export interface ComparisonEvaluationRow {
  readonly key: string;
  readonly label: string;
  readonly leftValue: string | null;
  readonly rightValue: string | null;
}

export interface ComparisonVersionNote {
  readonly sameVersion: boolean;
  readonly heading: string;
  readonly message: string;
}

const RULE_ROWS: readonly {
  readonly field: ComparisonRuleField;
  readonly label: string;
}[] = [
  { field: 'name', label: 'Name' },
  { field: 'unit', label: 'Unit' },
  { field: 'position', label: 'Position' },
  { field: 'minimum', label: 'Minimum' },
  { field: 'maximum', label: 'Maximum' },
  { field: 'sampleCount', label: 'Sample count' },
  { field: 'intervalMs', label: 'Interval (ms)' },
];

/**
 * Turns the server's logicalStepId matches into the one view model the screen
 * renders. Added and removed steps stay one-sided: the absent side is `null`,
 * never a synthetic step with zeroed rules or statistics.
 */
export function buildComparisonStepViews(
  result: ComparisonResult,
): ComparisonStepView[] {
  const matched = result.matchedSteps.map((entry) => matchedStepView(result, entry));
  const added = result.addedSteps.map((step) =>
    oneSidedStepView(result, step, 'added'),
  );
  const removed = result.removedSteps.map((step) =>
    oneSidedStepView(result, step, 'removed'),
  );

  return [...matched, ...added, ...removed];
}

function matchedStepView(
  result: ComparisonResult,
  entry: ComparisonMatchedStep,
): ComparisonStepView {
  const left = buildSide(result.leftRun, entry.left, 'left');
  const right = buildSide(result.rightRun, entry.right, 'right');
  const changedFieldSet = new Set(entry.changedFields.map((change) => change.field));

  return {
    key: entry.logicalStepId,
    logicalStepId: entry.logicalStepId,
    presence: 'matched',
    left,
    right,
    changedFields: entry.changedFields,
    changedFieldSet,
    numericComparison: entry.numericComparison,
    sameUnit: entry.left.unit === entry.right.unit,
    unitChanged: entry.left.unit !== entry.right.unit,
    heading: stepHeading(entry.left, entry.right),
    positionText: positionText(entry.left, entry.right),
    nameText: nameText(entry.left, entry.right),
    leftPartial: isStepPartial(entry.left),
    rightPartial: isStepPartial(entry.right),
  };
}

function oneSidedStepView(
  result: ComparisonResult,
  step: RunSnapshotStep,
  presence: 'added' | 'removed',
): ComparisonStepView {
  const left = presence === 'removed' ? buildSide(result.leftRun, step, 'left') : null;
  const right = presence === 'added' ? buildSide(result.rightRun, step, 'right') : null;

  return {
    key: step.logicalStepId,
    logicalStepId: step.logicalStepId,
    presence,
    left,
    right,
    changedFields: [],
    changedFieldSet: new Set(),
    numericComparison: null,
    sameUnit: false,
    unitChanged: false,
    heading: step.name,
    positionText: `Position ${step.position}`,
    nameText: step.name,
    leftPartial: presence === 'removed' ? isStepPartial(step) : false,
    rightPartial: presence === 'added' ? isStepPartial(step) : false,
  };
}

function buildSide(
  run: ComparisonRunSummary,
  step: RunSnapshotStep,
  key: ComparisonSideKey,
): ComparisonStepSide {
  return {
    key,
    runLabel: key === 'left' ? 'Left run' : 'Right run',
    run,
    step,
    chartSeries: {
      side: key,
      runId: run.id,
      planName: run.planName,
      versionNumber: run.versionNumber,
      step,
    },
  };
}

function isStepPartial(step: RunSnapshotStep): boolean {
  return step.status !== 'COMPLETED' || step.recordedCount < step.sampleCount;
}

function stepHeading(left: RunSnapshotStep, right: RunSnapshotStep): string {
  return left.name === right.name ? left.name : `${left.name} → ${right.name}`;
}

function positionText(left: RunSnapshotStep, right: RunSnapshotStep): string {
  return left.position === right.position
    ? `Position ${left.position}`
    : `Position ${left.position} → ${right.position}`;
}

function nameText(left: RunSnapshotStep, right: RunSnapshotStep): string {
  return left.name === right.name
    ? left.name
    : `Renamed from ${left.name} to ${right.name}`;
}

export function sidesOf(view: ComparisonStepView): ComparisonStepSide[] {
  return [view.left, view.right].filter(
    (side): side is ComparisonStepSide => side !== null,
  );
}

export function ruleRows(view: ComparisonStepView): ComparisonRuleRow[] {
  return RULE_ROWS.map(({ field, label }) => ({
    field,
    label,
    leftValue: view.left === null ? null : ruleValue(view.left.step, field),
    rightValue: view.right === null ? null : ruleValue(view.right.step, field),
    changed: view.changedFieldSet.has(field),
  }));
}

export function statisticRows(view: ComparisonStepView): ComparisonStatRow[] {
  const apiStatistics = view.numericComparison?.statistics ?? null;

  if (view.presence === 'matched') {
    if (apiStatistics !== null) {
      return [
        decimalStatRow('minimum', 'Minimum recorded', apiStatistics.minimum),
        decimalStatRow('maximum', 'Maximum recorded', apiStatistics.maximum),
        decimalStatRow('average', 'Average recorded', apiStatistics.average),
        {
          key: 'sampleCount',
          label: 'Samples in statistics',
          leftValue: formatNullableCount(apiStatistics.sampleCount.left),
          rightValue: formatNullableCount(apiStatistics.sampleCount.right),
          deltaValue: formatNullableDelta(apiStatistics.sampleCount.delta),
          comparable: true,
          different:
            apiStatistics.sampleCount.left !== null &&
            apiStatistics.sampleCount.right !== null &&
            apiStatistics.sampleCount.left !== apiStatistics.sampleCount.right,
        },
      ];
    }

    const left = view.left?.step.statistics ?? null;
    const right = view.right?.step.statistics ?? null;
    return buildFallbackStatRows(left, right, false);
  }

  const left = view.left;
  const right = view.right;
  return left !== null
    ? buildFallbackStatRows(left.step.statistics, null, false)
    : buildFallbackStatRows(null, right?.step.statistics ?? null, false);
}

function decimalStatRow(
  key: string,
  label: string,
  value: {
    readonly left: string | null;
    readonly right: string | null;
    readonly delta: string | null;
  },
): ComparisonStatRow {
  return {
    key,
    label,
    leftValue: value.left,
    rightValue: value.right,
    deltaValue: value.delta,
    comparable: true,
    different:
      value.left !== null && value.right !== null && value.left !== value.right,
  };
}

function buildFallbackStatRows(
  left: StatisticsView | null,
  right: StatisticsView | null,
  comparable: boolean,
): ComparisonStatRow[] {
  return [
    {
      key: 'minimum',
      label: 'Minimum recorded',
      leftValue: left?.minimum ?? null,
      rightValue: right?.minimum ?? null,
      deltaValue: null,
      comparable,
      different:
        left?.minimum !== null &&
        left?.minimum !== undefined &&
        right?.minimum !== null &&
        right?.minimum !== undefined &&
        left.minimum !== right.minimum,
    },
    {
      key: 'maximum',
      label: 'Maximum recorded',
      leftValue: left?.maximum ?? null,
      rightValue: right?.maximum ?? null,
      deltaValue: null,
      comparable,
      different:
        left?.maximum !== null &&
        left?.maximum !== undefined &&
        right?.maximum !== null &&
        right?.maximum !== undefined &&
        left.maximum !== right.maximum,
    },
    {
      key: 'average',
      label: 'Average recorded',
      leftValue: left?.average ?? null,
      rightValue: right?.average ?? null,
      deltaValue: null,
      comparable,
      different:
        left?.average !== null &&
        left?.average !== undefined &&
        right?.average !== null &&
        right?.average !== undefined &&
        left.average !== right.average,
    },
    {
      key: 'sampleCount',
      label: 'Samples in statistics',
      leftValue: formatNullableCount(left?.sampleCount ?? null),
      rightValue: formatNullableCount(right?.sampleCount ?? null),
      deltaValue: null,
      comparable,
      different:
        left?.sampleCount !== null &&
        left?.sampleCount !== undefined &&
        right?.sampleCount !== null &&
        right?.sampleCount !== undefined &&
        left.sampleCount !== right.sampleCount,
    },
  ];
}

interface StatisticsView {
  readonly minimum: string | null;
  readonly maximum: string | null;
  readonly average: string | null;
  readonly sampleCount: number | null;
}

function formatNullableCount(value: number | null): string | null {
  return value === null ? null : String(value);
}

function formatNullableDelta(value: number | null): string | null {
  if (value === null) {
    return null;
  }

  return value > 0 ? `+${value}` : String(value);
}

function ruleValue(step: RunSnapshotStep, field: ComparisonRuleField): string {
  switch (field) {
    case 'name':
      return step.name;
    case 'unit':
      return step.unit;
    case 'position':
      return String(step.position);
    case 'minimum':
      return step.minimum;
    case 'maximum':
      return step.maximum;
    case 'sampleCount':
      return String(step.sampleCount);
    case 'intervalMs':
      return String(step.intervalMs);
  }
}

/**
 * Stored execution fields shown next to the rules. These are values recorded by
 * the run, not a new evaluation: statuses, outcomes, counters, and the stored
 * first-failure index are copied verbatim.
 */
export function evaluationRows(view: ComparisonStepView): ComparisonEvaluationRow[] {
  return [
    {
      key: 'status',
      label: 'Step status',
      leftValue: view.left === null ? null : stepStatusText(view.left.step),
      rightValue: view.right === null ? null : stepStatusText(view.right.step),
    },
    {
      key: 'outcome',
      label: 'Stored outcome',
      leftValue: view.left === null ? null : stepOutcomeText(view.left.step),
      rightValue: view.right === null ? null : stepOutcomeText(view.right.step),
    },
    {
      key: 'recorded',
      label: 'Recorded samples',
      leftValue:
        view.left === null
          ? null
          : `${view.left.step.recordedCount} of ${view.left.step.sampleCount}`,
      rightValue:
        view.right === null
          ? null
          : `${view.right.step.recordedCount} of ${view.right.step.sampleCount}`,
    },
    {
      key: 'out-of-tolerance',
      label: 'Out-of-tolerance samples',
      leftValue: view.left === null ? null : String(view.left.step.outOfToleranceCount),
      rightValue: view.right === null ? null : String(view.right.step.outOfToleranceCount),
    },
    {
      key: 'first-failure',
      label: 'First failure sample',
      leftValue:
        view.left === null
          ? null
          : view.left.step.firstFailureSampleIndex === null
            ? 'None recorded'
            : `Sample ${view.left.step.firstFailureSampleIndex}`,
      rightValue:
        view.right === null
          ? null
          : view.right.step.firstFailureSampleIndex === null
            ? 'None recorded'
            : `Sample ${view.right.step.firstFailureSampleIndex}`,
    },
  ];
}

export function changedFieldLabels(view: ComparisonStepView): string {
  return view.changedFields
    .map((change) => RULE_ROWS.find((row) => row.field === change.field)?.label ?? change.field)
    .join(', ');
}

export function versionNote(result: ComparisonResult): ComparisonVersionNote {
  const { leftRun, versionDifference } = result;

  if (versionDifference.sameVersion) {
    return {
      sameVersion: true,
      heading: 'Both runs used the same plan version',
      message: `Left and right both used version ${versionDifference.leftVersionNumber} of ${leftRun.planName}. Shared steps are matched by logicalStepId. Any measurement or outcome difference comes from the stored run data and scenario settings, not from a plan version change.`,
    };
  }

  return {
    sameVersion: false,
    heading: 'The runs used different plan versions',
    message: `Left used version ${versionDifference.leftVersionNumber} and right used version ${versionDifference.rightVersionNumber} of ${leftRun.planName}. Shared steps are matched by logicalStepId, not by name or position, so a rename or reorder stays on the same step. Changed rule fields are highlighted below.`,
  };
}

/** Scenario and seed differences explain why measurements can differ at all. */
export function scenarioNote(
  left: ComparisonRunSummary,
  right: ComparisonRunSummary,
): string | null {
  const scenarioDiffers = left.scenario !== right.scenario;
  const seedDiffers = left.seed !== right.seed;
  if (!scenarioDiffers && !seedDiffers) {
    return null;
  }

  const parts: string[] = [];
  if (scenarioDiffers) {
    parts.push(
      `scenarios differ (${scenarioLabel(left.scenario)} on the left, ${scenarioLabel(right.scenario)} on the right)`,
    );
  }
  if (seedDiffers) {
    parts.push(`seeds differ (${left.seed} on the left, ${right.seed} on the right)`);
  }

  return `The ${parts.join(' and ')}. Measurements and stored outcomes can therefore differ even when the copied rules are unchanged.`;
}

export function runDataNote(run: ComparisonRunSummary): string {
  const missing = Math.max(0, run.expectedSampleCount - run.recordedSampleCount);
  if (missing > 0) {
    return `${run.recordedSampleCount} of ${run.expectedSampleCount} expected samples were recorded; ${missing} ${missing === 1 ? 'is' : 'are'} missing and never shown as zero.`;
  }

  if (run.status !== 'COMPLETED') {
    return `All ${run.expectedSampleCount} expected samples were recorded, but the run is ${runStatusLabel(run.status, run.outcome)}, not a completed result.`;
  }

  return `All ${run.expectedSampleCount} expected samples were recorded.`;
}

export function runPartialChip(run: ComparisonRunSummary): string | null {
  if (!run.partial) {
    return null;
  }

  if (run.recordedSampleCount < run.expectedSampleCount) {
    return 'Partial data';
  }

  return 'Stopped after all samples';
}

export function stepDataNote(side: ComparisonStepSide): string {
  const step = side.step;
  const missing = Math.max(0, step.sampleCount - step.recordedCount);
  if (missing > 0) {
    return `${step.recordedCount} of ${step.sampleCount} expected samples recorded; ${missing} missing. Missing samples are not zero-filled.`;
  }

  if (step.status !== 'COMPLETED') {
    return `Step ${stepStatusLabel(step.status)}; all ${step.sampleCount} expected samples were recorded.`;
  }

  return `All ${step.sampleCount} expected samples recorded.`;
}

export function stepOutcomeText(step: RunSnapshotStep): string {
  return stepOutcomeLabel(step.outcome) ?? 'No step verdict';
}

export function stepStatusText(step: RunSnapshotStep): string {
  return stepStatusLabel(step.status);
}

export function measurementTableId(side: ComparisonStepSide): string {
  // Matches MeasurementChart's table link, so a single-run panel's "View
  // measurements in the table" action reaches this comparison table too.
  return `measurements-table-${side.step.runStepId}`;
}

export function chartPanelId(view: ComparisonStepView, side: ComparisonStepSide): string {
  return `comparison-panel-${side.key}-${view.logicalStepId}`;
}

/** Matched-step overview counters, before any chart or table is rendered. */
export function comparisonCounts(result: ComparisonResult): {
  readonly matched: number;
  readonly added: number;
  readonly removed: number;
  readonly changedFields: number;
} {
  return {
    matched: result.matchedSteps.length,
    added: result.addedSteps.length,
    removed: result.removedSteps.length,
    changedFields: result.matchedSteps.reduce(
      (total, step) => total + step.changedFields.length,
      0,
    ),
  };
}
