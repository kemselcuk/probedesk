import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ViewContainerRef,
  computed,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthFacade } from '../../core/auth/auth.facade';
import { NotificationService } from '../../shared/notifications/notification.service';
import { ErrorState } from '../../shared/ui/error-state/error-state';
import { LoadingState } from '../../shared/ui/loading-state/loading-state';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { PlansFacade } from '../plans/plans.facade';
import { DeviceArchiveDialog } from './device-archive-dialog';
import { DeviceEditorDialog } from './device-editor-dialog';
import { type Device } from './devices-api';
import { DeviceDetailFacade } from './device-detail.facade';

@Component({
  selector: 'app-device-detail-page',
  imports: [
    DatePipe,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    PageHeader,
    LoadingState,
    ErrorState,
  ],
  providers: [DeviceDetailFacade],
  template: `
    <app-page-header
      [title]="facade.device()?.name ?? 'Device'"
      subtitle="Current device record. Historical runs retain their own snapshots."
    >
      <a mat-button routerLink="/devices">Back to devices</a>
      <button mat-stroked-button type="button" [disabled]="facade.loading()" (click)="reload()">
        Refresh
      </button>
      @if (isPlanner() && facade.device()) {
        <button mat-flat-button type="button" (click)="edit()">Edit device</button>
      }
    </app-page-header>
    @if (facade.loading()) {
      <app-loading-state message="Loading device…" />
    } @else if (facade.error(); as error) {
      <app-error-state
        heading="Device could not be loaded"
        [message]="error.message"
        [requestId]="error.requestId"
        [retryable]="true"
        (retry)="reload()"
      />
    } @else if (facade.device(); as device) {
      <mat-card appearance="outlined" class="device-card">
        <h2>Device record</h2>
        <dl>
          <div>
            <dt>Serial number</dt>
            <dd class="mono">{{ device.serialNumber }}</dd>
          </div>
          <div>
            <dt>Profile</dt>
            <dd>{{ profileName(device.deviceProfileId) }}</dd>
          </div>
          <div>
            <dt>State</dt>
            <dd>{{ device.archivedAt ? 'Archived' : 'Active' }}</dd>
          </div>
          <div>
            <dt>Description</dt>
            <dd>{{ device.description ?? 'No description' }}</dd>
          </div>
          <div>
            <dt>Created (UTC)</dt>
            <dd>{{ device.createdAt | date: 'yyyy-MM-dd HH:mm:ss' : 'UTC' }}</dd>
          </div>
          <div>
            <dt>Updated (UTC)</dt>
            <dd>{{ device.updatedAt | date: 'yyyy-MM-dd HH:mm:ss' : 'UTC' }}</dd>
          </div>
          @if (device.archivedAt) {
            <div>
              <dt>Archived (UTC)</dt>
              <dd>{{ device.archivedAt | date: 'yyyy-MM-dd HH:mm:ss' : 'UTC' }}</dd>
            </div>
          }
        </dl>
        <div class="actions">
          <a mat-stroked-button routerLink="/runs" [queryParams]="{ deviceId: device.id }"
            >View device run history</a
          >
          @if (isPlanner()) {
            <button mat-button type="button" (click)="archive()">
              {{ device.archivedAt ? 'Restore device' : 'Archive device' }}
            </button>
          }
        </div>
        <p>Run history shows the device name and serial number recorded when each run started.</p>
      </mat-card>
    }
    @if (plans.profilesStatus() === 'error') {
      <p role="status">
        Profile names are unavailable.
        <button mat-button type="button" (click)="loadProfiles()">Retry profile names</button>
      </p>
    }
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .device-card {
      padding: var(--pd-card-padding);
    }
    h2 {
      margin: 0 0 var(--pd-space-4);
      font-size: var(--pd-font-section-size);
    }
    dl {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
      gap: var(--pd-space-4);
      margin: 0 0 var(--pd-space-5);
    }
    dt {
      color: var(--pd-text-secondary);
      font-size: var(--pd-font-meta-size);
      margin-bottom: var(--pd-space-1);
    }
    dd {
      margin: 0;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
      line-height: var(--pd-font-body-relaxed-line);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--pd-space-2);
    }
    p {
      margin: var(--pd-space-3) 0 0;
      color: var(--pd-text-secondary);
      line-height: var(--pd-font-body-relaxed-line);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeviceDetailPage {
  protected readonly facade = inject(DeviceDetailFacade);
  protected readonly plans = inject(PlansFacade);
  private readonly auth = inject(AuthFacade);
  protected readonly isPlanner = computed(() => this.auth.role() === 'PLANNER');
  private readonly route = inject(ActivatedRoute);
  private readonly dialogs = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);
  private readonly viewContainerRef = inject(ViewContainerRef);
  private readonly notifications = inject(NotificationService);
  constructor() {
    this.loadProfiles();
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.reload());
  }
  protected reload(): void {
    this.facade.load(this.route.snapshot.paramMap.get('deviceId') ?? '');
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
  protected edit(): void {
    this.open(false);
  }
  protected archive(): void {
    this.open(true);
  }
  private open(archive: boolean): void {
    const device = this.facade.device();
    if (!device || !this.isPlanner() || this.dialogs.getDialogById('device-detail-action')) return;
    const config = {
      id: 'device-detail-action',
      data: device,
      viewContainerRef: this.viewContainerRef,
      width: '34rem',
      maxWidth: 'calc(100vw - 32px)',
    };
    const ref = archive
      ? this.dialogs.open<DeviceArchiveDialog, Device, Device>(DeviceArchiveDialog, config)
      : this.dialogs.open<DeviceEditorDialog, Device, Device>(DeviceEditorDialog, config);
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
