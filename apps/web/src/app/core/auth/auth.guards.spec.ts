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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { routes } from '../../app.routes';
import { AppTitleStrategy } from '../title/app-title.strategy';
import { AuthFacade } from './auth.facade';
import type { Role } from './auth.types';

const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const ERROR_BODY = {
  code: 'UNAUTHENTICATED',
  message: 'No active session.',
  requestId: 'req-guard',
};

describe('auth guards', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter(routes, withDisabledInitialNavigation()),
        { provide: TitleStrategy, useClass: AppTitleStrategy },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  function resolveSession(role: Role | null): void {
    const auth = TestBed.inject(AuthFacade);
    const http = TestBed.inject(HttpTestingController);

    auth.loadSession().subscribe();
    const request = http.expectOne('/api/auth/me');

    if (role === null) {
      request.flush(ERROR_BODY, { status: 401, statusText: 'Unauthorized' });
      return;
    }

    request.flush({
      id: '22222222-2222-4222-8222-222222222222',
      email: `${role.toLowerCase()}@probedesk.local`,
      role,
    });
  }

  /** Completes the data requests the real plan screens start on entry. */
  function flushPlanLoads(): void {
    const http = TestBed.inject(HttpTestingController);
    for (const request of http.match((candidate) => candidate.url.startsWith('/api/plans'))) {
      if (request.request.url === '/api/plans') {
        request.flush([]);
      } else {
        request.flush({ id: PLAN_ID, name: 'Guard plan', draft: null });
      }
    }
  }

  it('redirects an anonymous deep link to login with the return URL', async () => {
    resolveSession(null);

    const harness = await RouterTestingHarness.create('/plans');
    const router = TestBed.inject(Router);
    harness.detectChanges();

    expect(router.url).toBe('/login?returnUrl=%2Fplans');
    expect(
      (harness.fixture.nativeElement as HTMLElement).querySelector('h1')?.textContent?.trim(),
    ).toBe('Sign in');
  });

  it('normalizes the root return URL to the default plans screen', async () => {
    resolveSession(null);

    await RouterTestingHarness.create('/');
    const router = TestBed.inject(Router);

    expect(router.url).toBe('/login?returnUrl=%2Fplans');
  });

  it('allows every role into the read-only screens', async () => {
    resolveSession('VIEWER');

    const harness = await RouterTestingHarness.create('/plans');
    const router = TestBed.inject(Router);
    harness.detectChanges();
    flushPlanLoads();

    expect(router.url).toBe('/plans');
    expect(
      (harness.fixture.nativeElement as HTMLElement).querySelector('h1')?.textContent?.trim(),
    ).toBe('Test Plans');
  });

  it('redirects a Viewer away from the Planner plan editor', async () => {
    resolveSession('VIEWER');

    const harness = await RouterTestingHarness.create('/plans');
    const router = TestBed.inject(Router);
    flushPlanLoads();

    await harness.navigateByUrl(`/plans/${PLAN_ID}/edit`);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(router.url).toBe('/not-authorized');
    expect(
      (harness.fixture.nativeElement as HTMLElement).querySelector('h1')?.textContent?.trim(),
    ).toBe('Not available for your role');
  });

  it('lets a Planner open the plan editor', async () => {
    resolveSession('PLANNER');

    const harness = await RouterTestingHarness.create(`/plans/${PLAN_ID}/edit`);
    const router = TestBed.inject(Router);
    harness.detectChanges();
    flushPlanLoads();

    expect(router.url).toBe(`/plans/${PLAN_ID}/edit`);
    expect(
      (harness.fixture.nativeElement as HTMLElement).querySelector('h1')?.textContent?.trim(),
    ).toBe('Plan Editor');
  });

  it('lets an Operator open Start Run', async () => {
    resolveSession('OPERATOR');

    const harness = await RouterTestingHarness.create('/plans');
    const router = TestBed.inject(Router);
    flushPlanLoads();

    await harness.navigateByUrl('/runs/new');
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(router.url).toBe('/runs/new');
    expect(
      (harness.fixture.nativeElement as HTMLElement).querySelector('h1')?.textContent?.trim(),
    ).toBe('Start Run');
  });

  it('lets a Viewer open Start Run without a role redirect', async () => {
    resolveSession('VIEWER');

    const harness = await RouterTestingHarness.create('/plans');
    const router = TestBed.inject(Router);
    flushPlanLoads();

    await harness.navigateByUrl('/runs/new');
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(router.url).toBe('/runs/new');
    expect(
      (harness.fixture.nativeElement as HTMLElement).querySelector('h1')?.textContent?.trim(),
    ).toBe('Start Run');
  });
});
