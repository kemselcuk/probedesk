import { DatePipe } from '@angular/common';
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
import { FormControl, NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { DateAdapter, MAT_DATE_FORMATS, MAT_NATIVE_DATE_FORMATS } from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import {
  formatCalendarDate,
  IsoDateAdapter,
  parseCalendarDate,
} from '../../shared/ui/iso-date-adapter';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, ParamMap, Router, RouterLink } from '@angular/router';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { ErrorState } from '../../shared/ui/error-state/error-state';
import { LoadingState } from '../../shared/ui/loading-state/loading-state';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import type { PlanSummary } from '../plans/plans-api.types';
import { PlansFacade } from '../plans/plans.facade';
import {
  MAX_COMPARE_RUNS,
  isTerminalStatus,
  validateCompareSelection,
} from '../comparisons/compare-selection';
import { isPartialSampleSet, isStoppedWithAllSamples, scenarioLabel } from './run-status';
import { RunHistoryFacade } from './run-history.facade';
import { RunStatusBadge } from './run-status-badge';
import type { RunHistoryItem, RunHistoryQuery, RunStatus } from './runs-api.types';

const PAGE_SIZE = 20;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RUN_STATUSES: readonly RunStatus[] = [
  'RUNNING',
  'COMPLETED',
  'CANCELLED',
  'INTERRUPTED',
  'ERROR',
];

type OutcomeFilter = 'PASSED' | 'FAILED' | '';

interface HistoryUrlState {
  readonly planId: string;
  readonly status: RunStatus | '';
  readonly outcome: OutcomeFilter;
  readonly from: string;
  readonly to: string;
  readonly page: number;
}

interface InvalidUrlFilter {
  readonly label: string;
  readonly value: string;
}

interface ParsedHistoryUrl {
  readonly state: HistoryUrlState;
  readonly invalid: readonly InvalidUrlFilter[];
}

/**
 * Paginated run history.
 *
 * The URL query string is the single source of truth for filters and page
 * number, so a refresh, a detail link, and the browser Back button restore the
 * same view. A filter change always resets the page to one. The facade keeps a
 * request sequence guard, so a slow response for an older selection cannot
 * replace a newer one. Rows contain summary counters only; opening details is
 * the only way to load measurement arrays.
 */
@Component({
  selector: 'app-run-history-page',
  imports: [
    DatePipe,
    EmptyState,
    ErrorState,
    LoadingState,
    MatButtonModule,
    MatCardModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    PageHeader,
    ReactiveFormsModule,
    RouterLink,
    RunStatusBadge,
  ],
  providers: [
    { provide: DateAdapter, useClass: IsoDateAdapter },
    {
      provide: MAT_DATE_FORMATS,
      useValue: {
        ...MAT_NATIVE_DATE_FORMATS,
        parse: { dateInput: 'iso-date' },
        display: { ...MAT_NATIVE_DATE_FORMATS.display, dateInput: 'iso-date' },
      },
    },
  ],
  templateUrl: './run-history-page.html',
  styleUrl: './run-history-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RunHistoryPage {
  protected readonly history = inject(RunHistoryFacade);
  protected readonly plans = inject(PlansFacade);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  protected readonly currentQuery = signal<RunHistoryQuery>({
    page: 1,
    limit: PAGE_SIZE,
  });
  protected readonly compareSelection = signal<readonly RunHistoryItem[]>([]);
  protected readonly announcement = signal('');
  protected readonly invalidUrlFilters = signal<readonly InvalidUrlFilter[]>([]);

  /** Set by goToPage so focus moves only after that page actually loads. */
  private pendingPageNavigation: number | null = null;

  protected readonly filters = inject(NonNullableFormBuilder).group({
    planId: '',
    status: '' as RunStatus | '',
    outcome: '' as OutcomeFilter,
    from: new FormControl<Date | null>(null),
    to: new FormControl<Date | null>(null),
  });

  protected readonly hasActiveFilters = computed(() => {
    const query = this.currentQuery();
    return (
      query.planId !== undefined ||
      query.status !== undefined ||
      query.outcome !== undefined ||
      query.from !== undefined ||
      query.to !== undefined
    );
  });

  protected readonly selectedPlanMissing = computed(() => {
    const planId = this.currentQuery().planId;
    if (planId === undefined) {
      return false;
    }

    return !this.plans.plans().some((plan) => plan.id === planId);
  });

  protected readonly duplicatePlanNames = computed(() => {
    const counts = new Map<string, number>();
    for (const plan of this.plans.plans()) {
      counts.set(plan.name, (counts.get(plan.name) ?? 0) + 1);
    }

    return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name));
  });

  protected readonly displayTotalPages = computed(() => Math.max(1, this.history.totalPages()));

  /**
   * A page beyond the last one still has a non-zero total. That is not the same
   * as an empty history, so it gets its own state and never says "no runs".
   */
  protected readonly isPageOutOfRange = computed(
    () =>
      this.history.status() === 'loaded' &&
      this.history.total() > 0 &&
      this.history.items().length === 0,
  );

  protected readonly resultRange = computed(() => {
    if (this.isPageOutOfRange()) {
      return `Page ${this.history.page()} is outside 1-${this.displayTotalPages()}; ${this.history.total()} runs exist`;
    }

    const items = this.history.items();
    if (items.length === 0) {
      return 'No runs on this page';
    }

    const start = (this.history.page() - 1) * this.history.limit() + 1;
    const end = start + items.length - 1;
    return `Showing ${start}-${end} of ${this.history.total()} runs`;
  });

  protected readonly outOfRangeMessage = computed(() => {
    const total = this.history.total();
    const pages = this.displayTotalPages();
    const runs = total === 1 ? 'run' : 'runs';
    const pageLabel = pages === 1 ? 'page' : 'pages';

    return `The history contains ${total} ${runs} across ${pages} ${pageLabel}, but page ${this.history.page()} does not exist. The selected filters are unchanged.`;
  });

  protected readonly invalidFilterMessage = computed(() => {
    const invalid = this.invalidUrlFilters();
    if (invalid.length === 0) {
      return '';
    }

    const details = invalid.map((filter) => `${filter.label} "${filter.value}"`).join(', ');
    return `The address contains filter values that cannot be used, so they were ignored: ${details}. Remove them to share a working link.`;
  });

  protected readonly errorMessage = computed(() => {
    const error = this.history.error();
    if (error === null) {
      return 'The run history could not be loaded.';
    }

    if (error.status === 403) {
      return 'Your role cannot read the run history.';
    }

    return error.message;
  });

  protected readonly isUnauthenticated = computed(() => this.history.error()?.status === 401);

  protected readonly canGoPrevious = computed(() => this.history.page() > 1);
  protected readonly canGoNext = computed(() => this.history.page() < this.history.totalPages());

  protected readonly compareValidation = computed(() =>
    validateCompareSelection(this.compareSelection()),
  );
  protected readonly canCompare = computed(() => this.compareValidation().valid);
  protected readonly compareBlockedReason = computed(() => this.compareValidation().reason);
  protected readonly compareSelectionSummary = computed(() => {
    const selected = this.compareSelection();
    if (selected.length === 0) {
      return 'No runs selected for comparison.';
    }

    const labels = selected.map((run) => `${run.planName}, version ${run.versionNumber}`);
    return `${selected.length} of ${MAX_COMPARE_RUNS} selected: ${labels.join(' and ')}.`;
  });

  protected readonly scenario = scenarioLabel;

  constructor() {
    this.plans.loadPlans();

    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const parsed = readUrlState(params);
      const focusResults = this.pendingPageNavigation === parsed.state.page;
      this.pendingPageNavigation = null;

      this.invalidUrlFilters.set(parsed.invalid);
      this.currentQuery.set(toServerQuery(parsed.state));
      this.syncForm(parsed.state);
      this.compareSelection.set([]);
      this.load(this.currentQuery(), focusResults);
    });

    this.filters.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.applyFilters());
  }

  protected applyFilters(): void {
    if (this.filters.invalid) return;
    const filters = this.readFilters();
    this.invalidUrlFilters.set([]);
    this.pendingPageNavigation = null;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        planId: filters.planId.length > 0 ? filters.planId : null,
        status: filters.status.length > 0 ? filters.status : null,
        outcome: filters.outcome.length > 0 ? filters.outcome : null,
        from: filters.from.length > 0 ? filters.from : null,
        to: filters.to.length > 0 ? filters.to : null,
        page: null,
      },
      replaceUrl: true,
    });
  }

  protected clearFilters(): void {
    this.syncForm({
      planId: '',
      status: '',
      outcome: '',
      from: '',
      to: '',
      page: 1,
    });
    this.invalidUrlFilters.set([]);
    this.pendingPageNavigation = null;

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {},
      replaceUrl: true,
    });
  }

  /**
   * Removes only the values the screen could not use. Valid filters and a
   * syntactically valid page number are kept so the current view does not jump.
   */
  protected removeInvalidUrlFilters(): void {
    const filters = this.readFilters();
    const page = this.currentQuery().page;
    this.invalidUrlFilters.set([]);
    this.pendingPageNavigation = null;

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        planId: filters.planId.length > 0 ? filters.planId : null,
        status: filters.status.length > 0 ? filters.status : null,
        outcome: filters.outcome.length > 0 ? filters.outcome : null,
        from: filters.from.length > 0 ? filters.from : null,
        to: filters.to.length > 0 ? filters.to : null,
        page: page === 1 ? null : page,
      },
      replaceUrl: true,
    });
  }

  protected goToPage(page: number): void {
    if (page < 1 || page > this.displayTotalPages() || page === this.history.page()) {
      return;
    }

    this.pendingPageNavigation = page;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page: page === 1 ? null : page },
      queryParamsHandling: 'merge',
    });
  }

  protected retry(): void {
    this.load(this.currentQuery());
  }

  protected retryPlanOptions(): void {
    this.plans.loadPlans();
  }

  /**
   * Plan names are not unique. Only repeated names need a suffix, and both the
   * published version and a short plan id keep the option text unambiguous.
   */
  protected planOptionLabel(plan: PlanSummary): string {
    if (!this.duplicatePlanNames().has(plan.name)) {
      return plan.name;
    }

    const version = plan.latestPublishedVersion;
    const versionLabel =
      version === null ? 'no published version' : `version ${version.versionNumber}`;
    return `${plan.name} — ${versionLabel} (plan ${plan.id.slice(0, 8)})`;
  }

  protected isPartialRun(run: RunHistoryItem): boolean {
    return isPartialSampleSet(run.status, run.recordedSampleCount, run.expectedSampleCount);
  }

  protected isStoppedRun(run: RunHistoryItem): boolean {
    return isStoppedWithAllSamples(run.status, run.recordedSampleCount, run.expectedSampleCount);
  }

  protected detailsLabel(run: RunHistoryItem): string {
    return `View details for ${run.planName}, version ${run.versionNumber}, started ${run.startedAt}`;
  }

  protected isSelectedForComparison(runId: string): boolean {
    return this.compareSelection().some((run) => run.id === runId);
  }

  protected isCompareSelectionFull(): boolean {
    return this.compareSelection().length >= MAX_COMPARE_RUNS;
  }

  protected isCompareCheckboxDisabled(run: RunHistoryItem): boolean {
    return (
      !isTerminalStatus(run.status) ||
      (!this.isSelectedForComparison(run.id) && this.isCompareSelectionFull())
    );
  }

  protected compareCheckboxLabel(run: RunHistoryItem): string {
    const action = this.isSelectedForComparison(run.id) ? 'Remove' : 'Select';
    const status = isTerminalStatus(run.status)
      ? ''
      : ' Unavailable because the run is still running.';
    return `${action} ${run.planName}, version ${run.versionNumber}, for comparison.${status}`;
  }

  protected toggleCompare(run: RunHistoryItem, event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    const selected = this.compareSelection();
    if (target.checked) {
      if (selected.length >= MAX_COMPARE_RUNS || selected.some((entry) => entry.id === run.id)) {
        target.checked = selected.some((entry) => entry.id === run.id);
        return;
      }

      const next = [...selected, run];
      this.compareSelection.set(next);
      this.announceSelection(next);
      return;
    }

    const next = selected.filter((entry) => entry.id !== run.id);
    this.compareSelection.set(next);
    this.announceSelection(next);
  }

  protected clearCompareSelection(): void {
    this.compareSelection.set([]);
    this.announcement.set('The comparison selection was cleared.');
  }

  /**
   * The UI repeats the terminal, distinct-run, and same-plan checks before it
   * navigates, but the API validates the pair again and its 409/422/404 errors
   * stay visible on the Compare screen.
   */
  protected compareSelected(): void {
    const validation = this.compareValidation();
    if (!validation.valid || validation.left === null || validation.right === null) {
      this.announcement.set(
        validation.reason ?? 'Select two terminal runs of the same plan first.',
      );
      return;
    }

    this.announcement.set(
      `Opening comparison for ${validation.left.planName}, versions ${validation.left.versionNumber} and ${validation.right.versionNumber}.`,
    );
    void this.router.navigate(['/compare'], {
      queryParams: {
        leftRunId: validation.left.id,
        rightRunId: validation.right.id,
      },
    });
  }

  private announceSelection(selected: readonly RunHistoryItem[]): void {
    if (selected.length === 0) {
      this.announcement.set('The comparison selection was cleared.');
      return;
    }

    if (selected.length === 1) {
      this.announcement.set(
        `1 run selected: ${selected[0]?.planName ?? ''}, version ${selected[0]?.versionNumber ?? ''}. Select one more terminal run of the same plan.`,
      );
      return;
    }

    this.announcement.set(
      '2 runs selected. Choose Compare to open the comparison, or clear the selection.',
    );
  }

  private load(query: RunHistoryQuery, focusResults = false): void {
    this.history
      .loadHistory(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          if (
            !focusResults ||
            this.history.status() !== 'loaded' ||
            this.history.page() !== query.page
          ) {
            return;
          }

          this.focusAfterRender('history-results-heading');
        },
        error: () => undefined,
      });
  }

  private focusAfterRender(elementId: string): void {
    afterNextRender(() => document.getElementById(elementId)?.focus(), {
      injector: this.injector,
    });
  }

  private syncForm(filters: HistoryUrlState): void {
    this.filters.setValue(
      {
        planId: filters.planId,
        status: filters.status,
        outcome: filters.outcome,
        from: parseCalendarDate(filters.from),
        to: parseCalendarDate(filters.to),
      },
      { emitEvent: false },
    );
  }

  private readFilters(): HistoryUrlState {
    const value = this.filters.getRawValue();
    return {
      planId: value.planId,
      status: RUN_STATUSES.includes(value.status as RunStatus) ? (value.status as RunStatus) : '',
      outcome: value.outcome === 'PASSED' || value.outcome === 'FAILED' ? value.outcome : '',
      from: formatCalendarDate(value.from),
      to: formatCalendarDate(value.to),
      page: 1,
    };
  }
}

function readUrlState(params: ParamMap): ParsedHistoryUrl {
  const invalid: InvalidUrlFilter[] = [];
  const planIdValue = params.get('planId');
  const statusValue = params.get('status');
  const outcomeValue = params.get('outcome');
  const fromValue = params.get('from');
  const toValue = params.get('to');
  const pageValue = params.get('page');

  let planId = '';
  if (planIdValue !== null && planIdValue.length > 0) {
    if (UUID_PATTERN.test(planIdValue)) {
      planId = planIdValue;
    } else {
      invalid.push({ label: 'Plan', value: planIdValue });
    }
  }

  const status =
    statusValue !== null && RUN_STATUSES.includes(statusValue as RunStatus)
      ? (statusValue as RunStatus)
      : '';
  if (statusValue !== null && statusValue.length > 0 && status === '') {
    invalid.push({ label: 'Status', value: statusValue });
  }

  const outcome: OutcomeFilter =
    outcomeValue === 'PASSED' || outcomeValue === 'FAILED' ? outcomeValue : '';
  if (outcomeValue !== null && outcomeValue.length > 0 && outcome === '') {
    invalid.push({ label: 'Outcome', value: outcomeValue });
  }

  const from = normalizeDateInput(fromValue ?? '');
  if (fromValue !== null && fromValue.length > 0 && from === '') {
    invalid.push({ label: 'From date', value: fromValue });
  }

  const to = normalizeDateInput(toValue ?? '');
  if (toValue !== null && toValue.length > 0 && to === '') {
    invalid.push({ label: 'To date', value: toValue });
  }

  const page = readPage(pageValue);
  if (pageValue !== null && page === null) {
    invalid.push({ label: 'Page', value: pageValue });
  }

  return {
    state: {
      planId,
      status,
      outcome,
      from,
      to,
      page: page ?? 1,
    },
    invalid,
  };
}

/** Returns null for a present but unusable page value; absence is page one. */
function readPage(value: string | null): number | null {
  if (value === null) {
    return 1;
  }

  const page = Number(value);
  return /^\d+$/.test(value) && Number.isSafeInteger(page) && page >= 1 ? page : null;
}

/** Accepts the date-only value used in the URL and normalizes unexpected input. */
function normalizeDateInput(value: string): string {
  const date = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return '';
  }

  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  const isRealDate =
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;

  return isRealDate ? date : '';
}

function toServerQuery(filters: HistoryUrlState): RunHistoryQuery {
  const status = filters.status;
  const outcome = filters.outcome;

  return {
    ...(filters.planId.length > 0 ? { planId: filters.planId } : {}),
    ...(status !== '' ? { status } : {}),
    ...(outcome !== '' ? { outcome } : {}),
    ...(filters.from.length > 0 ? { from: toUtcStart(filters.from) } : {}),
    ...(filters.to.length > 0 ? { to: toUtcStart(filters.to) } : {}),
    page: filters.page,
    limit: PAGE_SIZE,
  };
}

/** The API contract is the UTC half-open range [from, to). */
function toUtcStart(date: string): string {
  return `${date}T00:00:00.000Z`;
}
