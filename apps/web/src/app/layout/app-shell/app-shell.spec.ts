import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  Router,
  TitleStrategy,
  provideRouter,
  withDisabledInitialNavigation,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../app.routes';
import { AuthFacade } from '../../core/auth/auth.facade';
import type { Role } from '../../core/auth/auth.types';
import { AppTitleStrategy } from '../../core/title/app-title.strategy';
import { NotificationService } from '../../shared/notifications/notification.service';

const notifications = {
  success: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
};

const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const PROFILE = {
  id: '33333333-3333-4333-8333-333333333333',
  code: 'DC-POWER',
  name: 'DC Power Module',
  description: null,
};
const EDITOR_PLAN = {
  id: PLAN_ID,
  name: 'Thermal check',
  profile: PROFILE,
  createdAt: '2026-11-03T09:00:00.000Z',
  latestPublishedVersion: null,
  draft: {
    id: 'draft-1',
    editRevision: 4,
    planId: PLAN_ID,
    state: 'DRAFT',
    name: 'Thermal check',
    versionNumber: null,
    steps: [],
  },
  published: null,
};

describe('AppShell', () => {
  beforeEach(async () => {
    notifications.success.mockReset();
    notifications.info.mockReset();
    notifications.error.mockReset();

    await TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter(routes, withDisabledInitialNavigation()),
        { provide: TitleStrategy, useClass: AppTitleStrategy },
        { provide: NotificationService, useValue: notifications },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  function resolveSession(role: Role): void {
    const http = TestBed.inject(HttpTestingController);
    TestBed.inject(AuthFacade).loadSession().subscribe();
    http.expectOne('/api/auth/me').flush({
      id: '11111111-1111-4111-8111-111111111111',
      email: `${role.toLowerCase()}@probedesk.local`,
      role,
    });
  }

  function rootOf(harness: RouterTestingHarness): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  function flushPlans(): void {
    TestBed.inject(HttpTestingController)
      .match('/api/plans')
      .forEach((request) => request.flush([]));
  }

  function findAction(root: HTMLElement, label: string): HTMLElement | undefined {
    return Array.from(
      root.querySelectorAll<HTMLElement>('a.planned-action, button.planned-action'),
    ).find((action) => action.textContent?.includes(label));
  }

  it('exposes a skip link, active navigation, and the main landmark', async () => {
    resolveSession('VIEWER');
    const harness = await RouterTestingHarness.create('/plans');
    harness.detectChanges();
    flushPlans();

    const root = rootOf(harness);
    const skipLink = root.querySelector<HTMLAnchorElement>('a.skip-link');
    const activeLink = root.querySelector<HTMLAnchorElement>('a[aria-current="page"]');

    expect(skipLink?.getAttribute('href')).toBe('#main-content');
    expect(root.querySelector('main#main-content')).not.toBeNull();
    expect(activeLink?.textContent).toContain('Test Plans');
    expect(root.querySelector('a[href="/runs"]')?.textContent).toContain('Run History');
    expect(root.querySelector('a[href="/compare"]')?.textContent).toContain('Compare Runs');
  });

  it('moves focus to the main landmark when the skip link is used', async () => {
    resolveSession('VIEWER');
    const harness = await RouterTestingHarness.create('/plans');
    harness.detectChanges();
    flushPlans();

    const root = rootOf(harness);
    const skipLink = root.querySelector<HTMLAnchorElement>('a.skip-link');
    const main = root.querySelector<HTMLElement>('main#main-content');

    main?.blur();
    skipLink?.click();

    expect(main?.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(main);
  });

  it('shows the signed-in email and role with a working Planner action', async () => {
    resolveSession('PLANNER');
    const harness = await RouterTestingHarness.create('/plans');
    harness.detectChanges();
    flushPlans();

    const root = rootOf(harness);

    expect(root.querySelector('.user-email')?.textContent).toContain('planner@probedesk.local');
    expect(root.querySelector('.role-chip')?.textContent).toContain('Planner');

    const newPlan = findAction(root, 'New plan');
    expect(newPlan?.tagName).toBe('A');
    expect(newPlan?.getAttribute('href')).toBe('/plans?create=1');
    expect(findAction(root, 'Start run')).toBeUndefined();
    expect(root.querySelector<HTMLButtonElement>('.sign-out-action')?.disabled).toBe(false);
  });

  it('shows only the Operator action for an Operator', async () => {
    resolveSession('OPERATOR');
    const harness = await RouterTestingHarness.create('/plans');
    harness.detectChanges();
    flushPlans();

    const root = rootOf(harness);
    const startRun = findAction(root, 'Start run');

    expect(startRun?.tagName).toBe('A');
    expect(startRun?.getAttribute('href')).toBe('/plans');
    expect(startRun?.getAttribute('disabled')).toBeNull();
    expect(root.textContent).not.toContain('available with P3-09');
    expect(findAction(root, 'New plan')).toBeUndefined();
    expect(root.querySelector('.role-chip')?.textContent).toContain('Operator');
  });

  it('shows a read-only note for a Viewer without action placeholders', async () => {
    resolveSession('VIEWER');
    const harness = await RouterTestingHarness.create('/plans');
    harness.detectChanges();
    flushPlans();

    const root = rootOf(harness);

    expect(findAction(root, 'New plan')).toBeUndefined();
    expect(findAction(root, 'Start run')).toBeUndefined();
    expect(root.querySelector('.nav-actions')).toBeNull();
    expect(root.querySelector('.sign-out-action')).not.toBeNull();
  });

  it('signs out through the API, clears state, notifies, and returns to login', async () => {
    resolveSession('PLANNER');
    const harness = await RouterTestingHarness.create('/plans');
    const auth = TestBed.inject(AuthFacade);
    const router = TestBed.inject(Router);
    const http = TestBed.inject(HttpTestingController);
    harness.detectChanges();
    flushPlans();

    const root = rootOf(harness);
    root.querySelector<HTMLButtonElement>('.sign-out-action')?.click();
    harness.detectChanges();

    const signOutButton = root.querySelector<HTMLButtonElement>('.sign-out-action');
    expect(signOutButton?.disabled).toBe(true);
    expect(signOutButton?.textContent).toContain('Signing out…');

    const request = http.expectOne('/api/auth/logout');
    expect(request.request.method).toBe('POST');
    request.flush(null, { status: 204, statusText: 'No Content' });

    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(auth.status()).toBe('anonymous');
    expect(auth.user()).toBeNull();
    expect(router.url).toBe('/login');
    await vi.waitFor(() => {
      expect(notifications.success).toHaveBeenCalledWith('You have signed out.');
    });
  });

  it('prompts before sign out discards unsaved editor changes', async () => {
    resolveSession('PLANNER');
    const harness = await RouterTestingHarness.create(`/plans/${PLAN_ID}/edit`);
    const auth = TestBed.inject(AuthFacade);
    const router = TestBed.inject(Router);
    const http = TestBed.inject(HttpTestingController);
    harness.detectChanges();

    http.expectOne(`/api/plans/${PLAN_ID}`).flush(EDITOR_PLAN);
    http.expectOne(`/api/plans/${PLAN_ID}/versions`).flush([]);
    await harness.fixture.whenStable();
    harness.detectChanges();

    const root = rootOf(harness);
    const nameInput = root.querySelector<HTMLInputElement>('#plan-name');
    if (nameInput === null) {
      throw new Error('Editor plan name input not found');
    }

    nameInput.value = 'Unsaved sign-out change';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    harness.detectChanges();

    root.querySelector<HTMLButtonElement>('.sign-out-action')?.click();
    harness.detectChanges();

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Leave without saving?');
    });

    const keepEditing = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Keep editing'),
    );
    keepEditing?.click();
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(http.match('/api/auth/logout')).toHaveLength(0);
    expect(auth.status()).toBe('authenticated');
    expect(router.url).toContain(`/plans/${PLAN_ID}/edit`);
    expect(nameInput.value).toBe('Unsaved sign-out change');

    root.querySelector<HTMLButtonElement>('.sign-out-action')?.click();
    harness.detectChanges();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Leave without saving?');
    });

    const discard = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Discard changes'),
    );
    discard?.click();
    await vi.waitFor(() => {
      expect(document.body.textContent).not.toContain('Leave without saving?');
    });

    const request = http.expectOne('/api/auth/logout');
    expect(request.request.method).toBe('POST');
    request.flush(null, { status: 204, statusText: 'No Content' });
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(auth.status()).toBe('anonymous');
    expect(router.url).toBe('/login');
  });

  it('keeps the session and reports an error when sign-out fails', async () => {
    resolveSession('OPERATOR');
    const harness = await RouterTestingHarness.create('/plans');
    const auth = TestBed.inject(AuthFacade);
    const router = TestBed.inject(Router);
    const http = TestBed.inject(HttpTestingController);
    harness.detectChanges();
    flushPlans();

    rootOf(harness).querySelector<HTMLButtonElement>('.sign-out-action')?.click();

    http.expectOne('/api/auth/logout').flush(
      {
        code: 'SERVICE_UNAVAILABLE',
        message: 'The session service is unavailable.',
        requestId: 'req-logout-fail',
      },
      { status: 503, statusText: 'Service Unavailable' },
    );

    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(auth.status()).toBe('authenticated');
    expect(auth.role()).toBe('OPERATOR');
    expect(router.url).toBe('/plans');
    await vi.waitFor(() => {
      expect(notifications.error).toHaveBeenCalledWith('The session service is unavailable.');
    });
  });
});
