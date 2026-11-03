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
import { AppTitleStrategy } from '../core/title/app-title.strategy';
import { AuthSessionStore } from '../core/auth/auth-session.store';
import type { Role } from '../core/auth/auth.types';
import { routes } from '../app.routes';

interface RouteCase {
  readonly url: string;
  readonly title: string;
  readonly heading: string;
  readonly role: Role;
  readonly task?: string;
}

const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const VERSION_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '33333333-3333-4333-8333-333333333333';

const routeCases: readonly RouteCase[] = [
  { url: '/login', title: 'Sign in', heading: 'Sign in', role: 'VIEWER' },
  {
    url: '/plans',
    title: 'Test Plans',
    heading: 'Test Plans',
    role: 'VIEWER',
  },
  {
    url: `/plans/${PLAN_ID}/edit`,
    title: 'Plan Editor',
    heading: 'Plan Editor',
    role: 'PLANNER',
  },
  {
    url: `/plans/${PLAN_ID}/versions/${VERSION_ID}`,
    title: 'Published Plan',
    heading: 'Published Plan',
    role: 'VIEWER',
  },
  {
    url: '/runs',
    title: 'Run History',
    heading: 'Run History',
    role: 'VIEWER',
    task: 'P5-02',
  },
  {
    url: '/runs/new',
    title: 'Start Run',
    heading: 'Start Run',
    role: 'OPERATOR',
    task: 'P3-09',
  },
  {
    url: `/runs/${RUN_ID}/live`,
    title: 'Live Run',
    heading: 'Live Run',
    role: 'VIEWER',
    task: 'P4-04',
  },
  {
    url: `/runs/${RUN_ID}`,
    title: 'Run Details',
    heading: 'Run Details',
    role: 'VIEWER',
    task: 'P5-03',
  },
  {
    url: '/compare',
    title: 'Compare Runs',
    heading: 'Compare Runs',
    role: 'VIEWER',
    task: 'P6-02',
  },
  {
    url: '/not-authorized',
    title: 'Not available',
    heading: 'Not available for your role',
    role: 'VIEWER',
  },
];

describe('application routes', () => {
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

  function actAs(role: Role): void {
    TestBed.inject(AuthSessionStore).authenticate({
      id: '44444444-4444-4444-8444-444444444444',
      email: `${role.toLowerCase()}@probedesk.local`,
      role,
    });
  }

  /** Answers the data requests started by the real plan and version screens. */
  function flushPlanRequests(): void {
    const http = TestBed.inject(HttpTestingController);
    for (const request of http.match((candidate) => candidate.url.startsWith('/api/plan'))) {
      if (request.request.url.startsWith('/api/plan-versions/')) {
        request.flush({
          id: VERSION_ID,
          planId: PLAN_ID,
          name: 'Deep link plan',
          versionNumber: 1,
          publishedAt: '2026-11-03T10:00:00.000Z',
          steps: [],
        });
      } else if (request.request.url.endsWith('/versions')) {
        request.flush([
          {
            id: VERSION_ID,
            versionNumber: 1,
            name: 'Deep link plan',
            publishedAt: '2026-11-03T10:00:00.000Z',
            publishedBy: {
              id: '44444444-4444-4444-8444-444444444444',
              email: 'planner@probedesk.local',
              role: 'PLANNER',
            },
          },
        ]);
      } else {
        request.flush(
          request.request.url === '/api/plans'
            ? []
            : { id: PLAN_ID, name: 'Deep link plan', draft: null },
        );
      }
    }
  }

  it('resolves every deep link to the intended screen', async () => {
    actAs('VIEWER');
    const harness = await RouterTestingHarness.create('/plans');
    const router = TestBed.inject(Router);
    flushPlanRequests();

    for (const routeCase of routeCases) {
      actAs(routeCase.role);
      await harness.navigateByUrl(routeCase.url);
      flushPlanRequests();
      await harness.fixture.whenStable();
      harness.detectChanges();

      const root = harness.fixture.nativeElement as HTMLElement;
      const page = root.querySelector('main') ?? root;

      expect(router.url).toBe(routeCase.url);
      expect(root.querySelector('h1')?.textContent?.trim()).toBe(routeCase.heading);
      if (routeCase.task !== undefined) {
        expect(page.textContent).toContain(routeCase.task);
      }
      expect(document.title).toBe(`${routeCase.title} · ProbeDesk`);
    }
  });

  it('falls back to the not-found route without leaving the shell', async () => {
    actAs('VIEWER');
    const harness = await RouterTestingHarness.create('/plans');
    flushPlanRequests();
    await harness.fixture.whenStable();
    harness.detectChanges();

    await harness.navigateByUrl('/plans/not-a-valid-path/extra');
    await harness.fixture.whenStable();
    harness.detectChanges();

    const text = harness.fixture.nativeElement.textContent ?? '';

    expect(text).toContain('Page not found');
    expect(text).toContain('Go to Test Plans');
    expect(document.title).toBe('Page not found · ProbeDesk');
  });
});
