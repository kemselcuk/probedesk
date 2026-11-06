import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationService } from '../../shared/notifications/notification.service';
import { CopyPlanButton } from './copy-plan-button';
import { PlanCopyFacade } from './plan-copy.facade';

const VERSION = '11111111-1111-4111-8111-111111111111';
const PLAN = '22222222-2222-4222-8222-222222222222';
const NEW_PLAN = '33333333-3333-4333-8333-333333333333';
const DRAFT = '44444444-4444-4444-8444-444444444444';
const SOURCE = {
  id: VERSION,
  planId: PLAN,
  state: 'PUBLISHED',
  name: 'Published voltage plan',
  versionNumber: 2,
  publishedAt: '2026-11-01T12:00:00.000Z',
  steps: [],
};
const RESPONSE = {
  planId: NEW_PLAN,
  draftRevisionId: DRAFT,
  sourceVersionId: VERSION,
  replayed: false,
};
const COPY_URL = `/api/plan-versions/${VERSION}/copy`;

describe('PlanCopyFacade', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), PlanCopyFacade],
    });
  });
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  function load(): { facade: PlanCopyFacade; http: HttpTestingController } {
    const facade = TestBed.inject(PlanCopyFacade),
      http = TestBed.inject(HttpTestingController);
    facade.loadSource(VERSION);
    http.expectOne(`/api/plan-versions/${VERSION}`).flush(SOURCE);
    return { facade, http };
  }

  it('preserves an uncertain request key for a retry and submits the trimmed name', () => {
    const { facade, http } = load();
    facade.submit('  Independent copy  ');
    const first = http.expectOne(COPY_URL);
    expect(first.request.body).toEqual({ name: 'Independent copy' });
    const key = first.request.headers.get('Idempotency-Key');
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    first.error(new ProgressEvent('error'));
    expect(facade.pending()).toBe(false);
    expect(facade.error()?.code).toBe('NETWORK_ERROR');
    facade.submit('Independent copy');
    const retry = http.expectOne(COPY_URL);
    expect(retry.request.headers.get('Idempotency-Key')).toBe(key);
    retry.flush({ ...RESPONSE, replayed: true });
    expect(facade.result()).toEqual({ ...RESPONSE, replayed: true });
    expect(facade.error()).toBeNull();
  });

  it('blocks duplicate submits while pending and assigns a new key to changed content', () => {
    const { facade, http } = load();
    facade.submit('First');
    facade.submit('First');
    const first = http.expectOne(COPY_URL);
    const firstKey = first.request.headers.get('Idempotency-Key');
    first.flush(
      { code: 'VALIDATION_ERROR', message: 'Try another name.' },
      { status: 400, statusText: 'Bad Request' },
    );
    facade.submit('Second');
    const second = http.expectOne(COPY_URL);
    expect(second.request.headers.get('Idempotency-Key')).not.toBe(firstKey);
    second.flush(RESPONSE);
    facade.submit('Second');
    http.expectNone(COPY_URL);
  });

  it('rejects malformed copy identity instead of navigating to an invented success', () => {
    const { facade, http } = load();
    facade.submit('Copy');
    http.expectOne(COPY_URL).flush({ ...RESPONSE, sourceVersionId: NEW_PLAN });
    expect(facade.result()).toBeNull();
    expect(facade.error()?.code).toBe('MALFORMED_API_RESPONSE');
    expect(facade.pending()).toBe(false);
  });

  it('allows source reload after a failed request and never copies an unavailable source', () => {
    const facade = TestBed.inject(PlanCopyFacade),
      http = TestBed.inject(HttpTestingController);
    facade.loadSource(VERSION);
    http
      .expectOne(`/api/plan-versions/${VERSION}`)
      .flush(
        { code: 'NOT_FOUND', message: 'Not found.' },
        { status: 404, statusText: 'Not Found' },
      );
    facade.submit('Copy');
    http.expectNone(COPY_URL);
    expect(facade.sourceError()?.status).toBe(404);
    facade.loadSource(VERSION);
    http.expectOne(`/api/plan-versions/${VERSION}`).flush(SOURCE);
    expect(facade.source()?.name).toBe(SOURCE.name);
    expect(facade.sourceError()).toBeNull();
  });
});

describe('CopyPlanButton and dialog', () => {
  const notifications = { success: vi.fn() };
  beforeEach(async () => {
    notifications.success.mockReset();
    await TestBed.configureTestingModule({
      imports: [CopyPlanButton],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: NotificationService, useValue: notifications },
      ],
    }).compileComponents();
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });
  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    TestBed.inject(HttpTestingController).verify();
  });

  async function open(name = SOURCE.name) {
    const fixture = TestBed.createComponent(CopyPlanButton);
    fixture.componentRef.setInput('versionId', VERSION);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    TestBed.inject(HttpTestingController)
      .expectOne(`/api/plan-versions/${VERSION}`)
      .flush({ ...SOURCE, name });
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('shows the real published version, preserves input on server error, then opens the new editor', async () => {
    const fixture = await open();
    const dialog = document.querySelector('mat-dialog-container') as HTMLElement;
    expect(dialog.textContent).toContain(`${SOURCE.name} · Version 2`);
    expect(dialog.textContent).toContain('independent draft');
    const input = dialog.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe(`${SOURCE.name} (copy)`);
    input.value = 'Custom copy';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    (dialog.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController),
      first = http.expectOne(COPY_URL);
    const key = first.request.headers.get('Idempotency-Key');
    expect(TestBed.inject(MatDialog).openDialogs[0]?.disableClose).toBe(true);
    first.flush(
      { code: 'INTERNAL_ERROR', message: 'Please retry.', requestId: 'copy-request' },
      { status: 500, statusText: 'Server Error' },
    );
    await fixture.whenStable();
    fixture.detectChanges();
    expect(input.value).toBe('Custom copy');
    expect(dialog.textContent).toContain('copy-request');
    expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
    (dialog.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    const retry = http.expectOne(COPY_URL);
    expect(retry.request.headers.get('Idempotency-Key')).toBe(key);
    retry.flush(RESPONSE);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => {
      expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(['/plans', NEW_PLAN, 'edit']);
    });
    expect(notifications.success).toHaveBeenCalledOnce();
  });

  it('fits a 100-character source name and rejects empty or overlong new names', async () => {
    const fixture = await open('x'.repeat(100));
    const dialog = document.querySelector('mat-dialog-container') as HTMLElement;
    const input = dialog.querySelector('input') as HTMLInputElement;
    expect(input.value.length).toBe(100);
    for (const invalid of ['   ', 'x'.repeat(101)]) {
      input.value = invalid;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      (dialog.querySelector('form') as HTMLFormElement).dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      fixture.detectChanges();
      TestBed.inject(HttpTestingController).expectNone(COPY_URL);
      expect(dialog.querySelector('mat-error')).not.toBeNull();
    }
  });
});
