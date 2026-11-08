import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ViewContainerRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthFacade } from '../../core/auth/auth.facade';
import { NotificationService } from '../../shared/notifications/notification.service';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { ErrorState } from '../../shared/ui/error-state/error-state';
import { LoadingState } from '../../shared/ui/loading-state/loading-state';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { PlansFacade } from '../plans/plans.facade';
import { DeviceEditorDialog } from './device-editor-dialog';
import { type Device, type DeviceQuery } from './devices-api';
import { DevicesFacade } from './devices.facade';

type State = 'active' | 'archived' | 'all';

@Component({
  selector: 'app-devices-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    PageHeader,
    LoadingState,
    ErrorState,
    EmptyState,
  ],
  providers: [DevicesFacade],
  template: `
    <app-page-header
      title="Devices"
      subtitle="Track test devices by serial number. Run history preserves the values recorded at start."
    >
      <button mat-stroked-button type="button" (click)="reload()" [disabled]="facade.loading()">
        Refresh
      </button>
      @if (isPlanner()) {
        <button mat-flat-button type="button" (click)="edit(null)">New device</button>
      }
    </app-page-header>
    <mat-card appearance="outlined" class="filters-panel">
      <form [formGroup]="filters" (ngSubmit)="apply()" class="filters">
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Name or serial prefix</mat-label>
          <input matInput formControlName="q" id="device-search" />
        </mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Device state</mat-label>
          <mat-select formControlName="state" id="device-state">
            <mat-option class="pd-select-option" value="active">Active</mat-option>
            <mat-option class="pd-select-option" value="archived">Archived</mat-option>
            <mat-option class="pd-select-option" value="all">All devices</mat-option>
          </mat-select>
        </mat-form-field>
        <div class="filter-actions">
          <button mat-stroked-button type="submit">Apply filters</button>
          <button mat-button type="button" (click)="clear()">Clear</button>
        </div>
      </form>
    </mat-card>
    @if (invalidUrl()) {
      <app-error-state
        heading="Invalid device filters"
        message="Use a valid state, a search of at most 100 characters and a positive page number. Clear filters to start again."
      />
    } @else if (facade.loading()) {
      <app-loading-state message="Loading devices…" />
    } @else if (facade.error(); as error) {
      <app-error-state
        heading="Devices could not be loaded"
        [message]="error.message"
        [requestId]="error.requestId"
        [retryable]="true"
        (retry)="reload()"
      />
    } @else if (facade.page(); as page) {
      @if (page.items.length) {
        <mat-card appearance="outlined" class="list-panel">
          <div class="pd-table-wrap" tabindex="0" role="region" aria-label="Device list">
            <table class="pd-table devices-table">
              <caption class="visually-hidden">
                Devices matching the current filters
              </caption>
              <colgroup>
                <col class="name-col" />
                <col class="serial-col" />
                <col class="profile-col" />
                <col class="state-col" />
                @if (isPlanner()) {
                  <col class="action-col" />
                }
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Serial number</th>
                  <th scope="col">Profile</th>
                  <th scope="col">State</th>
                  @if (isPlanner()) {
                    <th scope="col">Actions</th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (device of page.items; track device.id) {
                  <tr>
                    <td>
                      <a [routerLink]="['/devices', device.id]">{{ device.name }}</a>
                    </td>
                    <td class="mono">{{ device.serialNumber }}</td>
                    <td>{{ profileName(device.deviceProfileId) }}</td>
                    <td>
                      <span class="pd-badge">{{ device.archivedAt ? 'Archived' : 'Active' }}</span>
                    </td>
                    @if (isPlanner()) {
                      <td>
                        <button
                          mat-button
                          type="button"
                          (click)="edit(device)"
                          [attr.aria-label]="'Edit ' + device.name"
                        >
                          Edit
                        </button>
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </mat-card>
      } @else if (page.total > 0) {
        <app-empty-state
          heading="Page outside the device list"
          message="Matching devices exist on another page. Return to the first page to see them."
          ><button mat-stroked-button type="button" (click)="go(1)">
            Go to first page
          </button></app-empty-state
        >
      } @else {
        <app-empty-state
          heading="No matching devices"
          message="Try another name or serial prefix, or change the state filter."
        />
      }
      <nav class="pagination" aria-label="Device pages">
        <span>{{ page.total }} devices · Page {{ page.page }} of {{ page.totalPages || 1 }}</span>
        <div>
          <button mat-button type="button" [disabled]="page.page <= 1" (click)="go(page.page - 1)">
            Previous
          </button>
          <button
            mat-button
            type="button"
            [disabled]="page.page >= page.totalPages"
            (click)="go(page.page + 1)"
          >
            Next
          </button>
        </div>
      </nav>
    }
    @if (plans.profilesStatus() === 'error') {
      <p role="status">
        Profile names are unavailable.
        <button mat-button type="button" (click)="loadProfiles()">Retry profile names</button>
      </p>
    }
  `,
  styleUrl: './devices-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DevicesPage {
  protected readonly facade = inject(DevicesFacade);
  protected readonly plans = inject(PlansFacade);
  protected readonly isPlanner = computed(() => this.auth.role() === 'PLANNER');
  protected readonly invalidUrl = signal(false);
  protected readonly filters = inject(NonNullableFormBuilder).group({
    q: '',
    state: 'active' as State,
  });
  private readonly auth = inject(AuthFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialogs = inject(MatDialog);
  private readonly viewContainerRef = inject(ViewContainerRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly notifications = inject(NotificationService);
  private query: DeviceQuery = { state: 'active', page: 1, limit: 20 };

  constructor() {
    this.loadProfiles();
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const q = params.get('q') ?? '';
      const state = params.get('state') ?? 'active';
      const page = params.get('page') ?? '1';
      const valid =
        ['active', 'archived', 'all'].includes(state) &&
        Array.from(q).length <= 100 &&
        /^[1-9]\d*$/.test(page) &&
        Number.isSafeInteger(Number(page));
      this.invalidUrl.set(!valid);
      this.filters.reset({
        q,
        state: ['active', 'archived', 'all'].includes(state) ? (state as State) : 'active',
      });
      if (!valid) return;
      this.query = { q: q.trim(), state: state as State, page: Number(page), limit: 20 };
      this.reload();
    });
  }
  protected reload(): void {
    if (!this.invalidUrl()) this.facade.load(this.query);
  }
  protected loadProfiles(): void {
    this.plans
      .loadProfiles()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => undefined });
  }
  protected profileName(id: string): string {
    return (
      this.plans.profiles().find((profile) => profile.id === id)?.name ?? 'Profile unavailable'
    );
  }
  protected apply(): void {
    this.navigate(1);
  }
  protected clear(): void {
    this.filters.reset({ q: '', state: 'active' });
    this.navigate(1);
  }
  protected go(page: number): void {
    this.navigate(page);
  }
  private navigate(page: number): void {
    const value = this.filters.getRawValue();
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { q: value.q.trim() || null, state: value.state, page },
    });
  }
  protected edit(device: Device | null): void {
    if (!this.isPlanner() || this.dialogs.getDialogById('device-editor')) return;
    const ref = this.dialogs.open<DeviceEditorDialog, Device | null, Device>(DeviceEditorDialog, {
      id: 'device-editor',
      data: device,
      viewContainerRef: this.viewContainerRef,
      width: '34rem',
      maxWidth: 'calc(100vw - 32px)',
      autoFocus: 'first-tabbable',
    });
    const unregister = this.destroyRef.onDestroy(() => ref.close());
    ref
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        unregister();
        if (result) {
          this.notifications.success('Device saved.');
          this.reload();
        }
      });
  }
}
