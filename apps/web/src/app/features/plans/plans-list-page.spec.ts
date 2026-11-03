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
import { AuthSessionStore } from '../../core/auth/auth-session.store';
import type { Role } from '../../core/auth/auth.types';
import { AppTitleStrategy } from '../../core/title/app-title.strategy';
import { NotificationService } from '../../shared/notifications/notification.service';

const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const NEW_PLAN_ID = '99999999-9999-4999-8999-999999999999';
const VERSION_ID = '22222222-2222-4222-8222-222222222222';
const PROFILE_ID = '33333333-3333-4333-8333-333333333333';

const notifications = {
  success: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
};

const PROFILE = {
  id: PROFILE_ID,
  code: 'DC-POWER',
  name: 'DC Power Module',
  description: 'Simulated single-channel supply',
};

const DRAFT_PLAN = {
  id: PLAN_ID,
  name: 'Bench plan',
  profile: PROFILE,
  draft: { id: 'draft-1', editRevision: 4 },
  latestPublishedVersion: null,
};

const PUBLISHED_PLAN = {
  id: NEW_PLAN_ID,
  name: 'Thermal plan',
  profile: PROFILE,
  draft: null,
  latestPublishedVersion: {
    id: VERSION_ID,
    versionNumber: 2,
    publishedAt: '2026-11-03T10:00:00.000Z',
  },
};

describe('PlansListPage', () => {
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

  function actAs(role: Role): void {
    TestBed.inject(AuthSessionStore).authenticate({
      id: '44444444-4444-4444-8444-444444444444',
      email: `${role.toLowerCase()}@probedesk.local`,
      role,
    });
  }

  async function open(role: Role): Promise<RouterTestingHarness> {
    actAs(role);
    const harness = await RouterTestingHarness.create('/plans');
    harness.detectChanges();
    return harness;
  }

  function rootOf(harness: RouterTestingHarness): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  function typeInto(root: HTMLElement, selector: string, value: string): void {
    const input = root.querySelector<HTMLInputElement>(selector);
    if (input === null) {
      throw new Error(`Input not found: ${selector}`);
    }

    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function submit(root: HTMLElement): void {
    const form = root.querySelector('form');
    if (form === null) {
      throw new Error('Create plan form not found');
    }

    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }

  it('shows loading and then a distinct empty state', async () => {
    const harness = await open('VIEWER');
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    expect(root.textContent).toContain('Loading test plans…');
    expect(root.querySelector('app-loading-state [role="status"]')).not.toBeNull();

    http.expectOne('/api/plans').flush([]);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.textContent).toContain('No test plans yet');
    expect(root.textContent).toContain(
      'Published plans appear here once a planner publishes them.',
    );
    expect(root.textContent).not.toContain('New plan');
  });

  it('renders plan rows with version links and Planner draft affordances', async () => {
    const harness = await open('PLANNER');
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    http.expectOne('/api/plans').flush([DRAFT_PLAN, PUBLISHED_PLAN]);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.querySelector('table')).not.toBeNull();
    expect(root.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(root.querySelector('table caption')?.textContent).toContain(
      'Test plans with their latest published version',
    );
    expect(root.querySelectorAll('th[scope="col"]')).toHaveLength(4);
    expect(root.textContent).toContain('Draft in progress');
    expect(root.textContent).toContain('Revision 4');
    expect(root.textContent).toContain('No open draft');
    expect(root.textContent).toContain('Version 2');
    expect(root.textContent).toContain('Not published yet');

    const editLink = root.querySelector<HTMLAnchorElement>(`a[href="/plans/${PLAN_ID}/edit"]`);
    expect(editLink?.textContent).toContain('Edit draft');

    const versionLink = root.querySelector<HTMLAnchorElement>(
      `a[href="/plans/${NEW_PLAN_ID}/versions/${VERSION_ID}"]`,
    );
    expect(versionLink?.textContent).toContain('Version 2');

    const newPlan = Array.from(root.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('New plan'),
    );
    expect(newPlan?.disabled).toBe(false);
  });

  it('hides draft information and editor affordances from non-Planners', async () => {
    const harness = await open('VIEWER');
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    http.expectOne('/api/plans').flush([DRAFT_PLAN, PUBLISHED_PLAN]);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.textContent).not.toContain('Draft in progress');
    expect(root.textContent).not.toContain('Revision 4');
    expect(root.textContent).not.toContain('No open draft');
    expect(root.querySelectorAll('th[scope="col"]')).toHaveLength(2);
    expect(root.querySelector(`a[href="/plans/${PLAN_ID}/edit"]`)).toBeNull();
    expect(root.querySelector(`a[href="/plans/${NEW_PLAN_ID}/edit"]`)).toBeNull();
    expect(
      root.querySelector<HTMLAnchorElement>(
        `a[href="/plans/${NEW_PLAN_ID}/versions/${VERSION_ID}"]`,
      )?.textContent,
    ).toContain('Version 2');

    const newPlan = Array.from(root.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('New plan'),
    );
    expect(newPlan).toBeUndefined();
  });

  it('turns a malformed list response into the normal error state', async () => {
    const harness = await open('VIEWER');
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    http.expectOne('/api/plans').flush([
      { id: PLAN_ID, profile: PROFILE, latestPublishedVersion: null },
    ]);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.querySelector('[role="alert"]')?.textContent).toContain(
      'did not match the API contract',
    );
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('name');
    expect(root.querySelector('table')).toBeNull();
  });

  it('shows an API error with the request id and retries the list', async () => {
    const harness = await open('VIEWER');
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    http.expectOne('/api/plans').flush(
      {
        code: 'SERVICE_UNAVAILABLE',
        message: 'The plan list is temporarily unavailable.',
        requestId: 'req-plans-1',
      },
      { status: 503, statusText: 'Service Unavailable' },
    );
    await harness.fixture.whenStable();
    harness.detectChanges();

    const alert = root.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('The plan list is temporarily unavailable.');
    expect(alert?.textContent).toContain('req-plans-1');

    const retry = Array.from(root.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Try again'),
    );
    retry?.click();
    harness.detectChanges();

    http.expectOne('/api/plans').flush([PUBLISHED_PLAN]);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(root.textContent).toContain('Thermal plan');
  });

  it('refreshes the list on demand', async () => {
    const harness = await open('VIEWER');
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    http.expectOne('/api/plans').flush([DRAFT_PLAN]);
    await harness.fixture.whenStable();
    harness.detectChanges();

    const refresh = Array.from(root.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Refresh'),
    );
    refresh?.click();
    harness.detectChanges();

    http.expectOne('/api/plans').flush([PUBLISHED_PLAN]);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.textContent).toContain('Thermal plan');
    expect(root.textContent).not.toContain('Bench plan');
  });

  it('opens the create form from the shell entry point and clears the query', async () => {
    actAs('PLANNER');
    const harness = await RouterTestingHarness.create('/plans?create=1');
    harness.detectChanges();
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);

    http.expectOne('/api/plans').flush([]);
    http.expectOne('/api/device-profiles').flush([PROFILE]);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.querySelector('#create-plan-panel')).not.toBeNull();
    expect(root.querySelector<HTMLInputElement>('#create-plan-name')).not.toBeNull();
    expect(router.url).toBe('/plans');
  });

  it('creates a plan from the inline form and opens its editor', async () => {
    const harness = await open('PLANNER');
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);

    http.expectOne('/api/plans').flush([]);
    await harness.fixture.whenStable();
    harness.detectChanges();

    const openButton = Array.from(root.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('New plan'),
    );
    openButton?.click();
    harness.detectChanges();

    http.expectOne('/api/device-profiles').flush([PROFILE]);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.querySelector<HTMLSelectElement>('#create-plan-profile')?.value).toBe(PROFILE.id);

    typeInto(root, '#create-plan-name', '  Thermal check  ');
    submit(root);
    harness.detectChanges();

    const request = http.expectOne('/api/plans');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      name: 'Thermal check',
      profileId: PROFILE.id,
    });

    const submitButton = Array.from(root.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Creating…'),
    );
    expect(submitButton?.disabled).toBe(true);

    request.flush(
      {
        id: NEW_PLAN_ID,
        name: 'Thermal check',
        profile: PROFILE,
        createdAt: '2026-11-03T09:00:00.000Z',
        latestPublishedVersion: null,
        draft: {
          id: 'draft-new',
          editRevision: 1,
          planId: NEW_PLAN_ID,
          state: 'DRAFT',
          name: 'Thermal check',
          versionNumber: null,
          steps: [],
        },
        published: null,
      },
      {
        status: 201,
        statusText: 'Created',
      },
    );
    await harness.fixture.whenStable();
    harness.detectChanges();

    http.expectOne(`/api/plans/${NEW_PLAN_ID}`).flush({
      id: NEW_PLAN_ID,
      name: 'Thermal check',
      profile: PROFILE,
      createdAt: '2026-11-03T09:00:00.000Z',
      latestPublishedVersion: null,
      draft: {
        id: 'draft-new',
        editRevision: 1,
        planId: NEW_PLAN_ID,
        state: 'DRAFT',
        name: 'Thermal check',
        versionNumber: null,
        steps: [],
      },
      published: null,
    });
    http.expectOne(`/api/plans/${NEW_PLAN_ID}/versions`).flush([]);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(router.url).toBe(`/plans/${NEW_PLAN_ID}/edit`);
    expect(notifications.success).toHaveBeenCalledWith(
      'Plan created. Add the first measurement step.',
    );
  });

  it('does not submit an invalid create form', async () => {
    const harness = await open('PLANNER');
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    http.expectOne('/api/plans').flush([]);
    await harness.fixture.whenStable();
    harness.detectChanges();

    Array.from(root.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('New plan'))
      ?.click();
    harness.detectChanges();
    http.expectOne('/api/device-profiles').flush([PROFILE]);
    await harness.fixture.whenStable();
    harness.detectChanges();

    submit(root);
    harness.detectChanges();

    expect(root.textContent).toContain('Plan name is required.');
    expect(http.match('/api/plans')).toHaveLength(0);
  });

  it('keeps create input and maps server field errors', async () => {
    const harness = await open('PLANNER');
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    http.expectOne('/api/plans').flush([]);
    await harness.fixture.whenStable();
    harness.detectChanges();

    Array.from(root.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('New plan'))
      ?.click();
    harness.detectChanges();
    http.expectOne('/api/device-profiles').flush([PROFILE]);
    await harness.fixture.whenStable();
    harness.detectChanges();

    typeInto(root, '#create-plan-name', 'Duplicate name');
    submit(root);
    http.expectOne('/api/plans').flush(
      {
        code: 'VALIDATION_ERROR',
        message: 'Check the highlighted fields.',
        requestId: 'req-create-1',
        fieldErrors: [
          {
            path: 'name',
            code: 'DUPLICATE',
            message: 'A plan with this name already exists.',
          },
        ],
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.querySelector<HTMLInputElement>('#create-plan-name')?.value).toBe('Duplicate name');
    expect(root.textContent).toContain('A plan with this name already exists.');
    expect(root.textContent).toContain('req-create-1');
  });
});
