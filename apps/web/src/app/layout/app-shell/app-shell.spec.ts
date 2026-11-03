import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
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
    TestBed.inject(AuthFacade)
      .loadSession()
      .subscribe();
    http.expectOne('/api/auth/me').flush({
      id: '11111111-1111-4111-8111-111111111111',
      email: `${role.toLowerCase()}@probedesk.local`,
      role,
    });
  }

  function rootOf(harness: RouterTestingHarness): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  function findAction(
    root: HTMLElement,
    label: string,
  ): HTMLButtonElement | undefined {
    return Array.from(
      root.querySelectorAll<HTMLButtonElement>('button.planned-action'),
    ).find((button) => button.textContent?.includes(label));
  }

  it('exposes a skip link, active navigation, and the main landmark', async () => {
    resolveSession('VIEWER');
    const harness = await RouterTestingHarness.create('/plans');
    harness.detectChanges();

    const root = rootOf(harness);
    const skipLink = root.querySelector<HTMLAnchorElement>('a.skip-link');
    const activeLink = root.querySelector<HTMLAnchorElement>(
      'a[aria-current="page"]',
    );

    expect(skipLink?.getAttribute('href')).toBe('#main-content');
    expect(root.querySelector('main#main-content')).not.toBeNull();
    expect(activeLink?.textContent).toContain('Test Plans');
    expect(root.querySelector('a[href="/runs"]')?.textContent).toContain(
      'Run History',
    );
    expect(root.querySelector('a[href="/compare"]')?.textContent).toContain(
      'Compare Runs',
    );
  });

  it('moves focus to the main landmark when the skip link is used', async () => {
    resolveSession('VIEWER');
    const harness = await RouterTestingHarness.create('/plans');
    harness.detectChanges();

    const root = rootOf(harness);
    const skipLink = root.querySelector<HTMLAnchorElement>('a.skip-link');
    const main = root.querySelector<HTMLElement>('main#main-content');

    main?.blur();
    skipLink?.click();

    expect(main?.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(main);
  });

  it('shows the signed-in email and role, with Planner actions as disabled placeholders', async () => {
    resolveSession('PLANNER');
    const harness = await RouterTestingHarness.create('/plans');
    harness.detectChanges();

    const root = rootOf(harness);

    expect(root.querySelector('.user-email')?.textContent).toContain(
      'planner@probedesk.local',
    );
    expect(root.querySelector('.role-chip')?.textContent).toContain(
      'Role: Planner',
    );

    const newPlan = findAction(root, 'New plan');
    expect(newPlan?.disabled).toBe(true);
    expect(findAction(root, 'Start run')).toBeUndefined();
    expect(
      root.querySelector<HTMLButtonElement>('.sign-out-action')?.disabled,
    ).toBe(false);
  });

  it('shows only the Operator action for an Operator', async () => {
    resolveSession('OPERATOR');
    const harness = await RouterTestingHarness.create('/plans');
    harness.detectChanges();

    const root = rootOf(harness);
    const startRun = findAction(root, 'Start run');

    expect(startRun?.disabled).toBe(true);
    expect(findAction(root, 'New plan')).toBeUndefined();
    expect(root.querySelector('.role-chip')?.textContent).toContain(
      'Role: Operator',
    );
  });

  it('shows a read-only note for a Viewer without action placeholders', async () => {
    resolveSession('VIEWER');
    const harness = await RouterTestingHarness.create('/plans');
    harness.detectChanges();

    const root = rootOf(harness);

    expect(findAction(root, 'New plan')).toBeUndefined();
    expect(findAction(root, 'Start run')).toBeUndefined();
    expect(root.textContent).toContain(
      'Your role has read-only access to plans and runs.',
    );
  });

  it('signs out through the API, clears state, notifies, and returns to login', async () => {
    resolveSession('PLANNER');
    const harness = await RouterTestingHarness.create('/plans');
    const auth = TestBed.inject(AuthFacade);
    const router = TestBed.inject(Router);
    const http = TestBed.inject(HttpTestingController);
    harness.detectChanges();

    const root = rootOf(harness);
    root.querySelector<HTMLButtonElement>('.sign-out-action')?.click();
    harness.detectChanges();

    const signOutButton = root.querySelector<HTMLButtonElement>(
      '.sign-out-action',
    );
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

  it('keeps the session and reports an error when sign-out fails', async () => {
    resolveSession('OPERATOR');
    const harness = await RouterTestingHarness.create('/plans');
    const auth = TestBed.inject(AuthFacade);
    const router = TestBed.inject(Router);
    const http = TestBed.inject(HttpTestingController);
    harness.detectChanges();

    rootOf(harness)
      .querySelector<HTMLButtonElement>('.sign-out-action')
      ?.click();

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
      expect(notifications.error).toHaveBeenCalledWith(
        'The session service is unavailable.',
      );
    });
  });
});
