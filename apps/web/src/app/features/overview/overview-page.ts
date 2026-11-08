import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { DateAdapter, MAT_DATE_FORMATS, MAT_NATIVE_DATE_FORMATS } from '@angular/material/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router, RouterLink, type ParamMap } from '@angular/router';
import { DevicePicker } from '../devices/device-picker';
import { PlansFacade } from '../plans/plans.facade';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { ErrorState } from '../../shared/ui/error-state/error-state';
import { LoadingState } from '../../shared/ui/loading-state/loading-state';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import {
  IsoDateAdapter,
  formatCalendarDate,
  parseCalendarDate,
} from '../../shared/ui/iso-date-adapter';
import { UUID, type Overview, type OverviewQuery } from './analytics-api';
import { OverviewFacade } from './overview.facade';
import { OverviewTrend } from './overview-trend';
import { defaultOverviewQuery, historyDayParams, historyParams } from './overview-links';

type Scenario = NonNullable<OverviewQuery['scenario']>;
const RANGE = 366 * 86_400_000;
@Component({
  selector: 'app-overview-page',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    DevicePicker,
    PageHeader,
    LoadingState,
    ErrorState,
    EmptyState,
    OverviewTrend,
  ],
  providers: [
    OverviewFacade,
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
  templateUrl: './overview-page.html',
  styleUrl: './overview-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OverviewPage {
  protected readonly facade = inject(OverviewFacade);
  protected readonly plans = inject(PlansFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly query = signal<OverviewQuery | null>(null);
  protected readonly invalid = signal<string | null>(null);
  protected readonly versionsForPlan = signal('');
  protected readonly form = inject(NonNullableFormBuilder).group({
    from: new FormControl<Date | null>(null, Validators.required),
    to: new FormControl<Date | null>(null, Validators.required),
    planId: '',
    planVersionId: new FormControl({ value: '', disabled: true }, { nonNullable: true }),
    scenario: '' as Scenario | '',
    deviceId: '',
    batchNumber: ['', Validators.pattern(/^\s*[A-Za-z0-9._:/-]{1,100}\s*$|^\s*$/)],
  });
  protected readonly links = historyParams;
  protected readonly dayLinks = historyDayParams;
  protected selectedVersionMissing(): boolean {
    const id = this.form.controls.planVersionId.value;
    return (
      !!id &&
      (this.versionsForPlan() !== this.form.controls.planId.value ||
        !this.plans.versions().some((version) => version.id === id))
    );
  }
  protected selectedPlanMissing(): boolean {
    const id = this.form.controls.planId.value;
    return !!id && !this.plans.plans().some((plan) => plan.id === id);
  }
  protected readonly additionalStates = [
    { key: 'runningRuns', status: 'RUNNING', label: 'Running' },
    { key: 'cancelledRuns', status: 'CANCELLED', label: 'Cancelled' },
    { key: 'interruptedRuns', status: 'INTERRUPTED', label: 'Interrupted' },
    { key: 'errorRuns', status: 'ERROR', label: 'Error' },
  ] as const;
  private bounds = { from: '', to: '' };
  constructor() {
    this.plans.loadPlans();
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      if (params.keys.some((key) => params.getAll(key).length !== 1)) {
        this.query.set(null);
        this.invalid.set('The address contains a repeated overview filter.');
        this.facade.clear();
        return;
      }
      if (!params.has('from') || !params.has('to')) {
        const defaults = defaultOverviewQuery();
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: {
            ...Object.fromEntries(params.keys.map((key) => [key, params.get(key)])),
            from: params.get('from') ?? defaults.from,
            to: params.get('to') ?? defaults.to,
          },
          replaceUrl: true,
        });
        return;
      }
      try {
        const query = readQuery(params);
        this.query.set(query);
        this.invalid.set(null);
        this.syncForm(query);
        this.facade.load(query);
      } catch (error) {
        this.query.set(null);
        this.invalid.set(error instanceof Error ? error.message : 'Invalid overview filters.');
        this.facade.clear();
      }
    });
    this.form.controls.planId.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((id) => {
        this.form.controls.planVersionId.setValue('', { emitEvent: false });
        this.setVersionEnabled(!!id);
        this.versionsForPlan.set('');
      });
  }
  protected refresh(): void {
    const query = this.query();
    if (query) this.facade.load(query);
  }
  protected reset(): void {
    void this.router.navigate(['/overview']);
  }
  protected apply(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const value = this.form.getRawValue();
    const from = this.bound(value.from, this.bounds.from),
      to = this.bound(value.to, this.bounds.to);
    if (
      !from ||
      !to ||
      Date.parse(from) >= Date.parse(to) ||
      Date.parse(to) - Date.parse(from) > RANGE
    ) {
      this.form.setErrors({ range: true });
      return;
    }
    this.form.markAsPristine();
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        from,
        to,
        planId: value.planId || null,
        planVersionId: value.planVersionId || null,
        scenario: value.scenario || null,
        deviceId: value.deviceId || null,
        batchNumber: value.batchNumber.trim() || null,
      },
    });
  }
  protected loadVersions(): void {
    const id = this.form.controls.planId.value;
    if (!id) return;
    this.versionsForPlan.set(id);
    this.plans
      .loadVersions(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => undefined });
  }
  protected openDay(date: string): void {
    const data = this.facade.data();
    if (data) void this.router.navigate(['/runs'], { queryParams: historyDayParams(data, date) });
  }
  protected topLinks(data: Overview, row: Overview['topFailedSteps'][number]) {
    return historyParams(data, {
      planId: row.planId,
      planVersionId: row.planVersionId,
      status: 'COMPLETED',
      outcome: 'FAILED',
    });
  }
  protected planLabel(id: string, name: string): string {
    return this.plans.plans().filter((plan) => plan.name === name).length > 1
      ? `${name} (${id.slice(0, 8)})`
      : name;
  }
  private syncForm(query: OverviewQuery): void {
    this.bounds = { from: query.from, to: query.to };
    this.setVersionEnabled(!!query.planId);
    this.form.reset(
      {
        from: parseCalendarDate(query.from.slice(0, 10)),
        to: parseCalendarDate(query.to.slice(0, 10)),
        planId: query.planId ?? '',
        planVersionId: query.planVersionId ?? '',
        scenario: query.scenario ?? '',
        deviceId: query.deviceId ?? '',
        batchNumber: query.batchNumber ?? '',
      },
      { emitEvent: false },
    );
  }
  private setVersionEnabled(enabled: boolean): void {
    if (enabled) this.form.controls.planVersionId.enable({ emitEvent: false });
    else this.form.controls.planVersionId.disable({ emitEvent: false });
  }
  private bound(value: Date | null, original: string): string {
    const day = formatCalendarDate(value);
    return !day ? '' : day === original.slice(0, 10) ? original : `${day}T00:00:00.000Z`;
  }
}
function readQuery(params: ParamMap): OverviewQuery {
  const supported = [
    'from',
    'to',
    'planId',
    'planVersionId',
    'scenario',
    'deviceId',
    'batchNumber',
  ];
  if (params.keys.some((key) => !supported.includes(key) || params.getAll(key).length !== 1))
    throw Error(
      'The address contains an unsupported or repeated overview filter. Reset filters to start again.',
    );
  const from = readInstant(params.get('from')),
    to = readInstant(params.get('to'));
  if (Date.parse(from) >= Date.parse(to) || Date.parse(to) - Date.parse(from) > RANGE)
    throw Error('Choose a UTC range with From before To, up to 366 days.');
  const query: OverviewQuery = { from, to };
  for (const key of ['planId', 'planVersionId', 'deviceId'] as const) {
    const value = params.get(key);
    if (value) {
      if (!UUID.test(value))
        throw Error('The address contains an invalid plan, version or device identifier.');
      query[key] = value.toLowerCase();
    }
  }
  const batch = params.get('batchNumber')?.trim();
  if (batch) {
    if (!/^[A-Za-z0-9._:/-]{1,100}$/.test(batch))
      throw Error('Batch numbers must use 1–100 ASCII letters, digits and ._:/-.');
    query.batchNumber = batch;
  }
  const scenario = params.get('scenario');
  if (scenario) {
    if (scenario !== 'NORMAL' && scenario !== 'FORCED_FAILURE' && scenario !== 'RANDOM')
      throw Error('The address contains an invalid scenario.');
    query.scenario = scenario;
  }
  return query;
}
function readInstant(value: string | null): string {
  if (
    !value ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !parseCalendarDate(value.slice(0, 10)) ||
    !Number.isFinite(Date.parse(value))
  )
    throw Error('Use valid ISO dates with an explicit timezone in the overview address.');
  return new Date(value).toISOString();
}
