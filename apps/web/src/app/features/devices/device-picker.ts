import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { DevicePickerFacade } from './device-picker.facade';
import { DevicesFacade } from './devices.facade';

/** Search and page on the server. A preselected device is checked independently of the visible page. */
@Component({
  selector: 'app-device-picker',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  providers: [DevicesFacade, DevicePickerFacade],
  template: `
    <div class="picker-grid">
      <mat-form-field appearance="outline" subscriptSizing="dynamic">
        <mat-label>{{ filterMode() ? 'Device filter' : 'Device (optional)' }}</mat-label>
        <mat-select
          [value]="deviceId()"
          [disabled]="disabled()"
          (selectionChange)="deviceIdChange.emit($event.value)"
          (openedChange)="onOpen($event)"
          [aria-label]="filterMode() ? 'Device filter' : 'Device (optional)'"
        >
          <mat-option class="pd-select-option" value="">{{
            filterMode() ? 'All devices' : 'No device'
          }}</mat-option>
          @if (deviceId() && !selectedInPage()) {
            <mat-option class="pd-select-option" [value]="deviceId()"
              >{{ selection.device()?.name ?? 'Selected device' }} ·
              {{ selection.device()?.serialNumber ?? 'Checking…' }}</mat-option
            >
          }
          @for (device of list.page()?.items ?? []; track device.id) {
            <mat-option class="pd-select-option" [value]="device.id"
              >{{ device.name }} · {{ device.serialNumber }}</mat-option
            >
          }
        </mat-select>
        <mat-hint>{{
          filterMode()
            ? 'Active and archived devices.'
            : 'Only active devices of the selected plan profile.'
        }}</mat-hint>
      </mat-form-field>
      <div class="search-row">
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Device name or serial prefix</mat-label>
          <input
            matInput
            [formControl]="search"
            [readonly]="disabled()"
            (keydown.enter)="$event.preventDefault(); find()"
          />
        </mat-form-field>
        <button
          mat-stroked-button
          type="button"
          (click)="find()"
          [disabled]="disabled() || list.loading()"
        >
          Search devices
        </button>
      </div>
    </div>
    @if (selection.checking()) {
      <p role="status">Checking selected device…</p>
    }
    @if (selection.error(); as error) {
      <p role="alert">
        {{ error }}
        <button mat-button type="button" (click)="recheck()" [disabled]="disabled()">
          Retry device
        </button>
      </p>
    }
    @if (selection.device(); as device) {
      <p>
        Selected: {{ device.name }} · {{ device.serialNumber }}.
        {{ device.archivedAt ? 'Archived' : 'Active' }}.
      </p>
    }
    @if (list.loading()) {
      <p role="status">Loading device choices…</p>
    }
    @if (list.error(); as error) {
      <p role="alert">
        {{ error.message }}
        <button mat-button type="button" (click)="load()" [disabled]="disabled()">
          Retry choices
        </button>
      </p>
    }
    @if (list.page(); as page) {
      <div class="pages">
        <span
          >{{ page.total }} matching devices · Page {{ page.page }} of
          {{ page.totalPages || 1 }}</span
        >
        <div>
          <button
            mat-button
            type="button"
            [disabled]="disabled() || list.loading() || page.page <= 1"
            (click)="changePage(page.page - 1)"
          >
            Previous choices</button
          ><button
            mat-button
            type="button"
            [disabled]="disabled() || list.loading() || page.page >= page.totalPages"
            (click)="changePage(page.page + 1)"
          >
            Next choices
          </button>
        </div>
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .picker-grid {
      display: grid;
      gap: var(--pd-space-3);
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
    }
    .search-row {
      display: flex;
      align-items: start;
      gap: var(--pd-space-2);
      min-width: 0;
    }
    .search-row mat-form-field {
      flex: 1;
      min-width: 0;
    }
    p {
      margin: var(--pd-space-2) 0;
      font-size: var(--pd-font-meta-size);
      line-height: var(--pd-font-body-relaxed-line);
      overflow-wrap: anywhere;
    }
    .pages {
      display: flex;
      gap: var(--pd-space-2);
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      font-size: var(--pd-font-meta-size);
      margin-top: var(--pd-space-2);
    }
    @media (max-width: 767px) {
      .picker-grid {
        grid-template-columns: 1fr;
      }
      .search-row {
        flex-wrap: wrap;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DevicePicker {
  readonly profileId = input('');
  readonly filterMode = input(false);
  readonly deviceId = input('');
  readonly disabled = input(false);
  readonly deviceIdChange = output<string>();
  readonly validChange = output<boolean>();
  protected readonly list = inject(DevicesFacade);
  protected readonly selection = inject(DevicePickerFacade);
  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly selectedInPage = computed(
    () =>
      this.list
        .page()
        ?.items.some((device) => device.id.toLowerCase() === this.deviceId().toLowerCase()) ??
      false,
  );
  private readonly page = signal(1);
  private readonly q = signal('');
  private lastProfile = '';
  constructor() {
    effect(() => {
      const profile = this.profileId();
      const id = this.deviceId();
      this.selection.check(id, profile, this.filterMode());
      if (this.lastProfile && this.lastProfile !== profile)
        untracked(() => {
          this.page.set(1);
          this.load();
        });
    });
    effect(() => {
      this.validChange.emit(!this.selection.checking() && !this.selection.error());
    });
  }
  protected onOpen(open: boolean): void {
    if (open && (!this.list.page() || this.lastProfile !== this.profileId())) {
      this.page.set(1);
      this.load();
    }
  }
  protected recheck(): void {
    this.selection.check(this.deviceId(), this.profileId(), this.filterMode());
  }
  protected find(): void {
    if (this.disabled()) return;
    this.q.set(this.search.value.trim());
    this.page.set(1);
    this.load();
  }
  protected changePage(page: number): void {
    this.page.set(page);
    this.load();
  }
  protected load(): void {
    this.lastProfile = this.profileId();
    this.list.load({
      state: this.filterMode() ? 'all' : 'active',
      ...(this.profileId() ? { deviceProfileId: this.profileId() } : {}),
      q: this.q(),
      page: this.page(),
      limit: 20,
    });
  }
}
