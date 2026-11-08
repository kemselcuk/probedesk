import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../app.routes';
import { AuthSessionStore } from '../../core/auth/auth-session.store';
import type { Role } from '../../core/auth/auth.types';
import { NotificationService } from '../../shared/notifications/notification.service';
import { DeviceArchiveDialog } from './device-archive-dialog';
import { DeviceEditorDialog } from './device-editor-dialog';
import { DevicesApi, type Device } from './devices-api';
import { DevicesFacade } from './devices.facade';

const ID = '11111111-1111-4111-8111-111111111111';
const PROFILE_ID = '22222222-2222-4222-8222-222222222222';
const PROFILE = { id: PROFILE_ID, code: 'DC-POWER', name: 'DC Power Module', description: null };
const DEVICE: Device = {
  id: ID,
  deviceProfileId: PROFILE_ID,
  name: 'Bench supply',
  serialNumber: 'PSU-1',
  description: null,
  archivedAt: null,
  editRevision: 1,
  createdAt: '2026-11-06T10:00:00.000Z',
  updatedAt: '2026-11-06T10:00:00.000Z',
};
const page = (items: Device[] = [DEVICE]) => ({
  items,
  page: 1,
  limit: 20,
  total: items.length,
  totalPages: items.length ? 1 : 0,
});

describe('Devices boundary and screens', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter(routes),
        DevicesFacade,
        {
          provide: NotificationService,
          useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
        },
      ],
    }),
  );
  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    TestBed.inject(HttpTestingController).verify();
  });
  function auth(role: Role) {
    TestBed.inject(AuthSessionStore).authenticate({
      id: '33333333-3333-4333-8333-333333333333',
      role,
      email: 'test@example.test',
    });
  }
  function http() {
    return TestBed.inject(HttpTestingController);
  }
  function listRequest() {
    return http().expectOne((req) => req.url === '/api/devices');
  }

  it('sends literal search and paging parameters and validates a Unicode device', async () => {
    const promise = firstValueFrom(
      TestBed.inject(DevicesApi).list({ q: 'PSU_%\\', state: 'all', page: 2, limit: 20 }),
    );
    const req = listRequest();
    expect(req.request.params.get('q')).toBe('PSU_%\\');
    expect(req.request.params.get('page')).toBe('2');
    req.flush({ ...page([{ ...DEVICE, name: '😀'.repeat(100) }]), page: 2 });
    expect((await promise).items[0].name).toBe('😀'.repeat(100));
  });
  it('rejects missing nullable fields instead of inventing metadata', async () => {
    const promise = firstValueFrom(TestBed.inject(DevicesApi).get(ID));
    const { description: _description, ...invalid } = DEVICE;
    http().expectOne(`/api/devices/${ID}`).flush(invalid);
    await expect(promise).rejects.toThrow('invalid device response');
  });
  it('sends optimistic revision and validates response identity', async () => {
    const promise = firstValueFrom(
      TestBed.inject(DevicesApi).update(ID, { name: 'Changed', expectedRevision: 1 }),
    );
    const req = http().expectOne(`/api/devices/${ID}`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body.expectedRevision).toBe(1);
    req.flush({ ...DEVICE, id: PROFILE_ID });
    await expect(promise).rejects.toThrow();
  });
  it('cancels a stale list when filters change', () => {
    const facade = TestBed.inject(DevicesFacade);
    facade.load({ q: 'old' });
    const old = listRequest();
    facade.load({ q: 'new' });
    expect(old.cancelled).toBe(true);
    listRequest().flush(page());
    expect(facade.page()?.items[0].name).toBe('Bench supply');
    expect(facade.loading()).toBe(false);
  });
  it.each(['OPERATOR', 'VIEWER'] as const)(
    'shows %s device records without mutation actions',
    async (role) => {
      auth(role);
      const harness = await RouterTestingHarness.create('/devices?state=archived&q=PSU');
      http().expectOne('/api/device-profiles').flush([PROFILE]);
      const req = listRequest();
      expect(req.request.params.get('state')).toBe('archived');
      expect(req.request.params.get('q')).toBe('PSU');
      req.flush(page([{ ...DEVICE, archivedAt: DEVICE.createdAt }]));
      await harness.fixture.whenStable();
      harness.detectChanges();
      const root = harness.fixture.nativeElement as HTMLElement;
      expect(root.textContent).toContain('Bench supply');
      expect(root.textContent).toContain('Archived');
      expect(root.querySelector(`a[href="/devices/${ID}"]`)).not.toBeNull();
      expect(
        [...root.querySelectorAll('button')].some((button) =>
          /New device|^Edit$/.test(button.textContent?.trim() ?? ''),
        ),
      ).toBe(false);
    },
  );
  it('opens a Planner create dialog and posts trimmed fields', async () => {
    auth('PLANNER');
    const harness = await RouterTestingHarness.create('/devices');
    http().expectOne('/api/device-profiles').flush([PROFILE]);
    listRequest().flush(page([]));
    await harness.fixture.whenStable();
    harness.detectChanges();
    const root = harness.fixture.nativeElement as HTMLElement;
    [...root.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === 'New device')
      ?.click();
    http().expectOne('/api/device-profiles').flush([PROFILE]);
    await harness.fixture.whenStable();
    harness.detectChanges();
    const dialog = TestBed.inject(MatDialog).openDialogs[0].componentInstance as DeviceEditorDialog;
    dialog.form.patchValue({
      name: '  New bench  ',
      serialNumber: ' PSU-2 ',
      description: '  Notes  ',
    });
    dialog.save();
    const req = http().expectOne('/api/devices');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      name: 'New bench',
      serialNumber: 'PSU-2',
      description: 'Notes',
      deviceProfileId: PROFILE_ID,
    });
    req.flush({ ...DEVICE, name: 'New bench', serialNumber: 'PSU-2' });
    await vi.waitFor(() => {
      const refresh = listRequest();
      expect(refresh.request.method).toBe('GET');
      refresh.flush(page());
    });
  });
  it('keeps edits on a revision conflict and requires an explicit reload', () => {
    auth('PLANNER');
    const ref = TestBed.inject(MatDialog).open<DeviceEditorDialog, Device, Device>(
      DeviceEditorDialog,
      { data: DEVICE },
    );
    const dialog = ref.componentInstance;
    dialog.form.controls.name.setValue('My changes');
    dialog.save();
    http()
      .expectOne(`/api/devices/${ID}`)
      .flush(
        { code: 'DEVICE_CONFLICT', message: 'Device changed.', requestId: 'req-1' },
        { status: 409, statusText: 'Conflict' },
      );
    expect(dialog.form.controls.name.value).toBe('My changes');
    expect(dialog.error()?.code).toBe('DEVICE_CONFLICT');
    expect(dialog.pending()).toBe(false);
    dialog.reloadDevice();
    http()
      .expectOne(`/api/devices/${ID}`)
      .flush({ ...DEVICE, name: 'Latest', editRevision: 2 });
    expect(dialog.form.controls.name.value).toBe('Latest');
    dialog.save();
    const req = http().expectOne(`/api/devices/${ID}`);
    expect(req.request.body.expectedRevision).toBe(2);
    req.flush({ ...DEVICE, name: 'Latest', editRevision: 3 });
  });
  it('confirms archive with the current revision and leaves a conflict visible', () => {
    auth('PLANNER');
    const ref = TestBed.inject(MatDialog).open<DeviceArchiveDialog, Device, Device>(
      DeviceArchiveDialog,
      { data: DEVICE },
    );
    const dialog = ref.componentInstance;
    dialog.confirm();
    const request = http().expectOne(`/api/devices/${ID}/archive`);
    expect(request.request.body).toEqual({ expectedRevision: 1 });
    expect(ref.disableClose).toBe(true);
    request.flush(
      { code: 'DEVICE_CONFLICT', message: 'Changed elsewhere.', requestId: 'req-2' },
      { status: 409, statusText: 'Conflict' },
    );
    expect(dialog.error()?.code).toBe('DEVICE_CONFLICT');
    expect(ref.disableClose).toBe(false);
    dialog.confirm();
    http().expectNone(`/api/devices/${ID}/archive`);
  });

  it('loads device detail and links to filtered run history', async () => {
    auth('VIEWER');
    const harness = await RouterTestingHarness.create(`/devices/${ID}`);
    http().expectOne('/api/device-profiles').flush([PROFILE]);
    http().expectOne(`/api/devices/${ID}`).flush(DEVICE);
    await harness.fixture.whenStable();
    harness.detectChanges();
    const root = harness.fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('PSU-1');
    expect(root.querySelector(`a[href="/runs?deviceId=${ID}"]`)).not.toBeNull();
    expect(root.textContent).not.toContain('Archive device');
  });
});
