import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute, ParamMap, Router, RouterLink } from '@angular/router';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { ErrorState } from '../../shared/ui/error-state/error-state';
import { LoadingState } from '../../shared/ui/loading-state/loading-state';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import type { PlanSummary } from '../plans/plans-api.types';
import { PlansFacade } from '../plans/plans.facade';
import { scenarioLabel } from './run-status';
import { RunHistoryFacade } from './run-history.facade';
import { RunStatusBadge } from './run-status-badge';
import type {
  RunHistoryItem,
  RunHistoryQuery,
  RunStatus,
} from './runs-api.types';

const PAGE_SIZE = 20;
const MAX_COMPARE_SELECTION = 2;

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
    MatFormFieldModule,
    MatInputModule,
    PageHeader,
    ReactiveFormsModule,
    RouterLink,
    RunStatusBadge,
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

  protected readonly currentQuery = signal<RunHistoryQuery>({
    page: 1,
    limit: PAGE_SIZE,
  });
  protected readonly compareSelection = signal<readonly string[]>([]);
  protected readonly announcement = signal('');

  protected readonly filters = inject(NonNullableFormBuilder).group({
    planId: '',
    status: '' as RunStatus | '',
    outcome: '' as OutcomeFilter,
    from: '',
    to: '',
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

  protected readonly displayTotalPages = computed(() =>
    Math.max(1, this.history.totalPages()),
  );

  /**
   * A page beyond the last one still has a non-zero total. That is not the same
   * as an empty history, so it gets its own state and never says "no runs".
   */
  protected readonly isPageOutOfRange = computed(
    () =>
      this.history.status() === 'loaded' &&
      this.history.total() > 0 &&
      this.history.items().length === 0 &&
      this.history.page() > this.displayTotalPages(),
  );

  protected readonly outOfRangeMessage = computed(() => {
    const total = this.history.total();
    const pages = this.displayTotalPages();
    const runs = total === 1 ? 'run' : 'runs';
    const pageLabel = pages === 1 ? 'page' : 'pages';
    return `The history contains ${total} ${runs} across ${pages} ${pageLabel}, but page ${this.history.page()} does not exist. The selected filters are unchanged.`;
  });

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

  protected readonly isUnauthenticated = computed(
    () => this.history.error()?.status === 401,
  );

  protected readonly canGoPrevious = computed(() => this.history.page() > 1);
  protected readonly canGoNext = computed(
    () => this.history.page() < this.history.totalPages(),
  );

  protected readonly scenario = scenarioLabel;

  constructor() {
    this.plans.loadPlans();

    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const filters = readUrlState(params);
      this.currentQuery.set(toServerQuery(filters));
      this.syncForm(filters);
      this.compareSelection.set([]);
      this.load(this.currentQuery());
    });

    this.filters.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.applyFilters());
  }

  protected applyFilters(): void {
    const filters = this.readFilters();
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

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {},
      replaceUrl: true,
    });
  }

  protected goToPage(page: number): void {
    if (page < 1 || page > this.displayTotalPages() || page === this.history.page()) {
      return;
    }

    const scrollTarget = document.getElementById('run-history-table');
    void this.router
      .navigate([], {
        relativeTo: this.route,
        queryParams: { page: page === 1 ? null : page },
        queryParamsHandling: 'merge',
      })
      .then(() => scrollTarget?.focus());
  }

  protected retry(): void {
    this.load(this.currentQuery());
  }

  protected retryPlanOptions(): void {
    this.plans.loadPlans();
  }

  protected planOptionLabel(plan: PlanSummary): string {
    return plan.name;
  }

  protected detailsLabel(run: RunHistoryItem): string {
    return `View details for ${run.planName}, version ${run.versionNumber}, started ${run.startedAt}`;
  }

  protected isSelectedForComparison(runId: string): boolean {
    return this.compareSelection().includes(runId);
  }

  protected isCompareSelectionFull(): boolean {
    return this.compareSelection().length >= MAX_COMPARE_SELECTION;
  }

  protected toggleCompare(runId: string, event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    const selected = this.compareSelection();
    if (target.checked) {
      if (selected.length >= MAX_COMPARE_SELECTION || selected.includes(runId)) {
        target.checked = selected.includes(runId);
        return;
      }

      this.compareSelection.set([...selected, runId]);
      this.announcement.set('Selected for a future comparison. Comparison is not available yet.');
      return;
    }

    this.compareSelection.set(selected.filter((id) => id !== runId));
    this.announcement.set('Run removed from the future comparison selection.');
  }

  private load(query: RunHistoryQuery): void {
    this.history
      .loadHistory(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => undefined });
  }

  private syncForm(filters: HistoryUrlState): void {
    this.filters.setValue(
      {
        planId: filters.planId,
        status: filters.status,
        outcome: filters.outcome,
        from: filters.from,
        to: filters.to,
      },
      { emitEvent: false },
    );
  }

  private readFilters(): HistoryUrlState {
    const value = this.filters.getRawValue();
    return {
      planId: value.planId,
      status: RUN_STATUSES.includes(value.status as RunStatus)
        ? (value.status as RunStatus)
        : '',
      outcome:
        value.outcome === 'PASSED' || value.outcome === 'FAILED' ? value.outcome : '',
      from: normalizeDateInput(value.from),
      to: normalizeDateInput(value.to),
      page: 1,
    };
  }
}

function readUrlState(params: ParamMap): HistoryUrlState {
  const statusValue = params.get('status');
  const outcomeValue = params.get('outcome');

  return {
    planId: params.get('planId') ?? '',
    status:
      statusValue !== null && RUN_STATUSES.includes(statusValue as RunStatus)
        ? (statusValue as RunStatus)
        : '',
    outcome:
      outcomeValue === 'PASSED' || outcomeValue === 'FAILED' ? outcomeValue : '',
    from: normalizeDateInput(params.get('from') ?? ''),
    to: normalizeDateInput(params.get('to') ?? ''),
    page: readPage(params.get('page')),
  };
}

function readPage(value: string | null): number {
  if (value === null) {
    return 1;
  }

  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 ? page : 1;
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
