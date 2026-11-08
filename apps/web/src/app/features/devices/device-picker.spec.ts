import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatSelect } from '@angular/material/select';
import { By } from '@angular/platform-browser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DevicePicker } from './device-picker';
import type { Device } from './devices-api';

const PROFILE = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';
const DEVICE: Device = {
  id: ID,
  deviceProfileId: PROFILE,
  name: 'Bench',
  serialNumber: 'PSU-1',
  description: null,
  archivedAt: null,
  editRevision: 1,
  createdAt: '2026-11-07T10:00:00.000Z',
  updatedAt: '2026-11-07T10:00:00.000Z',
};
@Component({
  imports: [DevicePicker],
  template: `<app-device-picker
    [profileId]="profile()"
    [filterMode]="filterMode()"
    [deviceId]="id()"
    (deviceIdChange)="id.set($event)"
    (validChange)="valid.set($event)"
  />`,
})
class Host {
  readonly filterMode = signal(false);
  readonly profile = signal(PROFILE);
  readonly id = signal('');
  readonly valid = signal(true);
}

describe('DevicePicker', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }),
  );
  afterEach(() => {
    try {
      TestBed.inject(HttpTestingController).verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });
  function setup(id = '', filterMode = false) {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.id.set(id);
    fixture.componentInstance.filterMode.set(filterMode);
    fixture.detectChanges();
    return fixture;
  }
  function http() {
    return TestBed.inject(HttpTestingController);
  }
  it('loads choices lazily with the active profile and pages on the server', async () => {
    const fixture = setup();
    http().expectNone((r) => r.url === '/api/devices');
    const select = fixture.debugElement.query(By.directive(MatSelect))
      .componentInstance as MatSelect;
    select.open();
    fixture.detectChanges();
    await fixture.whenStable();
    const request = http().expectOne((r) => r.url === '/api/devices');
    expect(request.request.params.get('deviceProfileId')).toBe(PROFILE);
    expect(request.request.params.get('state')).toBe('active');
    expect(request.request.params.get('limit')).toBe('20');
    request.flush({ items: [DEVICE], page: 1, limit: 20, total: 21, totalPages: 2 });
    fixture.detectChanges();
    select.close();
    [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === 'Next choices')
      ?.click();
    fixture.detectChanges();
    const next = http().expectOne((r) => r.url === '/api/devices');
    expect(next.request.params.get('page')).toBe('2');
    next.flush({ items: [], page: 2, limit: 20, total: 21, totalPages: 2 });
  });
  it('keeps an archived preselection blocked until explicitly cleared', () => {
    const fixture = setup(ID);
    expect(fixture.componentInstance.valid()).toBe(false);
    http()
      .expectOne(`/api/devices/${ID}`)
      .flush({ ...DEVICE, archivedAt: DEVICE.createdAt });
    fixture.detectChanges();
    expect(fixture.componentInstance.id()).toBe(ID);
    expect(fixture.componentInstance.valid()).toBe(false);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('archived');
    fixture.componentInstance.id.set('');
    fixture.detectChanges();
    expect(fixture.componentInstance.valid()).toBe(true);
  });
  it('allows an archived device as a history filter', () => {
    const fixture = setup(ID, true);
    http()
      .expectOne(`/api/devices/${ID}`)
      .flush({ ...DEVICE, archivedAt: DEVICE.createdAt });
    fixture.detectChanges();
    expect(fixture.componentInstance.valid()).toBe(true);
  });
  it('rejects a device from another profile', () => {
    const fixture = setup(ID);
    http()
      .expectOne(`/api/devices/${ID}`)
      .flush({ ...DEVICE, deviceProfileId: ID });
    fixture.detectChanges();
    expect(fixture.componentInstance.valid()).toBe(false);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('another profile');
  });
  it('checks a selected active device independently of its current list page', () => {
    const fixture = setup(ID);
    http().expectOne(`/api/devices/${ID}`).flush(DEVICE);
    fixture.detectChanges();
    expect(fixture.componentInstance.valid()).toBe(true);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('PSU-1');
  });
  it('cancels an obsolete selected-device lookup and exposes an unavailable selection after failure', async () => {
    const fixture = setup(ID);
    const old = http().expectOne(`/api/devices/${ID}`);
    fixture.componentInstance.id.set(PROFILE);
    fixture.detectChanges();
    expect(old.cancelled).toBe(true);
    http()
      .expectOne(`/api/devices/${PROFILE}`)
      .flush(
        { code: 'NOT_FOUND', message: 'Device not found.', requestId: 'missing-device' },
        { status: 404, statusText: 'Not Found' },
      );
    fixture.detectChanges();
    expect(fixture.componentInstance.valid()).toBe(false);
    (fixture.debugElement.query(By.directive(MatSelect)).componentInstance as MatSelect).open();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.body.textContent).toContain('Unavailable');
    http()
      .expectOne((request) => request.url === '/api/devices')
      .flush({ items: [], page: 1, limit: 20, total: 0, totalPages: 0 });
  });
  it('reloads opened choices under the new profile rather than keeping an old-profile list', async () => {
    const fixture = setup();
    const select = fixture.debugElement.query(By.directive(MatSelect))
      .componentInstance as MatSelect;
    select.open();
    fixture.detectChanges();
    await fixture.whenStable();
    http()
      .expectOne((r) => r.url === '/api/devices')
      .flush({ items: [DEVICE], page: 1, limit: 20, total: 1, totalPages: 1 });
    fixture.componentInstance.profile.set(ID);
    fixture.detectChanges();
    const next = http().expectOne((r) => r.url === '/api/devices');
    expect(next.request.params.get('deviceProfileId')).toBe(ID);
    next.flush({ items: [], page: 1, limit: 20, total: 0, totalPages: 0 });
    select.close();
  });
});
