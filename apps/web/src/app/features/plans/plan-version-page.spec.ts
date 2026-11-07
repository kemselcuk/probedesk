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
  description: null,
};

const STEP_A = {
  logicalStepId: 'step-a',
  position: 1,
  name: 'Voltage',
  unit: 'V',
  minimum: '4.75',
  maximum: '5.25',
  sampleCount: 10,
  intervalMs: 1000,
};

const STEP_B = {
  logicalStepId: 'step-b',
  position: 2,
  name: 'Current',
  unit: 'A',
  minimum: '0.1',
  maximum: '2',
  sampleCount: 5,
  intervalMs: 2000,
};

const VERSION_DETAIL = {
  id: VERSION_ID,
  planId: PLAN_ID,
  state: 'PUBLISHED',
  name: 'Thermal check',
  versionNumber: 2,
  publishedAt: '2026-11-03T11:00:00.000Z',
  steps: [STEP_A, STEP_B],
};

const VERSION_LIST = [
  {
    id: VERSION_ID,
    versionNumber: 2,
    name: 'Thermal check',
    publishedAt: '2026-11-03T11:00:00.000Z',
    publishedBy: {
      id: '44444444-4444-4444-8444-444444444444',
      email: 'planner@probedesk.local',
      role: 'PLANNER',
    },
  },
];

const PLAN_WITHOUT_DRAFT = {
  id: PLAN_ID,
  name: 'Thermal check',
  profile: PROFILE,
  createdAt: '2026-11-03T09:00:00.000Z',
  latestPublishedVersion: {
    id: VERSION_ID,
    versionNumber: 2,
    publishedAt: '2026-11-03T11:00:00.000Z',
  },
  draft: null,
  published: null,
};

describe('PlanVersionPage', () => {
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

  function url(): string {
    return `/plans/${PLAN_ID}/versions/${VERSION_ID}`;
  }

  async function open(role: Role): Promise<RouterTestingHarness> {
    actAs(role);
    const harness = await RouterTestingHarness.create(url());
    harness.detectChanges();
    return harness;
  }

  function rootOf(harness: RouterTestingHarness): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  function flushVersionAndPublisher(
    http: HttpTestingController,
    versions: readonly object[] = VERSION_LIST,
  ): void {
    http.expectOne(`/api/plan-versions/${VERSION_ID}`).flush(VERSION_DETAIL);
    http.expectOne(`/api/plans/${PLAN_ID}/versions`).flush(versions);
  }

  it('renders the published version, ordered steps, totals, and publisher without edit controls', async () => {
    const harness = await open('VIEWER');
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    expect(root.textContent).toContain('Loading published version…');

    flushVersionAndPublisher(http);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Thermal check');
    expect(root.textContent).toContain('Version 2 · Read-only published plan');
    expect(root.querySelector('#version-title')?.textContent?.trim()).toBe('Thermal check');
    expect(root.querySelector('.version-badge')?.textContent).toContain('Version 2');
    expect(root.textContent).toContain('planner@probedesk.local (PLANNER)');
    expect(root.textContent).toContain('2026');

    expect(root.querySelector('table caption')?.textContent).toContain(
      'Ordered measurement steps of published version 2',
    );
    expect(root.querySelectorAll('th[scope="col"]')).toHaveLength(7);
    const rows = root.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('Voltage');
    expect(rows[0]?.textContent).toContain('4.75');
    expect(rows[1]?.textContent).toContain('Current');
    expect(rows[1]?.textContent).toContain('2,000');

    expect(root.querySelector('.totals')?.textContent).toContain('15');
    expect(root.querySelector('.totals')?.textContent).toContain('20.0 s');

    expect(root.querySelector('form')).toBeNull();
    expect(root.querySelector('input')).toBeNull();
    expect(root.querySelector('textarea')).toBeNull();
    expect(root.querySelector('select')).toBeNull();
    expect(root.querySelector('app-copy-plan-button')).toBeNull();
    expect(root.querySelector('#start-new-draft-button')).toBeNull();
    expect(root.textContent).not.toContain('Start new draft');

    const page = root.querySelector('app-plan-version-page') ?? root;
    const back = page.querySelector<HTMLAnchorElement>('a[href="/plans"]');
    expect(back?.textContent).toContain('Back to plans');

    expect(http.match(`/api/plans/${PLAN_ID}`)).toHaveLength(0);
  });

  it('reloads the published source when the router reuses the page', async () => {
    const harness = await open('VIEWER');
    const http = TestBed.inject(HttpTestingController);
    flushVersionAndPublisher(http);
    await harness.fixture.whenStable();
    const nextId = '99999999-9999-4999-8999-999999999999';
    await harness.navigateByUrl(`/plans/${PLAN_ID}/versions/${nextId}`);
    http
      .expectOne(`/api/plan-versions/${nextId}`)
      .flush({ ...VERSION_DETAIL, id: nextId, name: 'Updated source', versionNumber: 3 });
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(rootOf(harness).querySelector('h1')?.textContent).toContain('Updated source');
    expect(rootOf(harness).textContent).toContain('Version 3');
  });

  it('offers an Operator a Start run link for this published version', async () => {
    const harness = await open('OPERATOR');
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    flushVersionAndPublisher(http);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.querySelector('app-copy-plan-button')).toBeNull();
    const startRun = root.querySelector<HTMLAnchorElement>('#start-run-link');
    expect(startRun?.textContent).toContain('Start run');
    expect(startRun?.getAttribute('href')).toBe(`/runs/new?versionId=${VERSION_ID}`);
    expect(http.match(`/api/plans/${PLAN_ID}`)).toHaveLength(0);
  });

  it.each(['PLANNER', 'VIEWER'] as const)('does not offer %s a Start run link', async (role) => {
    const harness = await open(role);
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    flushVersionAndPublisher(http);
    if (role === 'PLANNER') {
      http.expectOne(`/api/plans/${PLAN_ID}`).flush(PLAN_WITHOUT_DRAFT);
    }
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.querySelector('#start-run-link')).toBeNull();
    expect(root.textContent).not.toContain('Start run');
  });

  it('offers a Planner a new draft when no draft is open and navigates to the editor', async () => {
    const harness = await open('PLANNER');
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    flushVersionAndPublisher(http);
    http.expectOne(`/api/plans/${PLAN_ID}`).flush(PLAN_WITHOUT_DRAFT);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.querySelectorAll('app-copy-plan-button')).toHaveLength(1);
    const start = root.querySelector<HTMLButtonElement>('#start-new-draft-button');
    expect(start?.disabled).toBe(false);
    expect(root.textContent).toContain('This version cannot be edited.');

    start?.click();
    harness.detectChanges();

    const request = http.expectOne(`/api/plans/${PLAN_ID}/drafts`);
    expect(request.request.method).toBe('POST');
    request.flush(
      {
        id: 'draft-2',
        planId: PLAN_ID,
        state: 'DRAFT',
        name: 'Thermal check',
        editRevision: 1,
        versionNumber: null,
        baseVersionId: VERSION_ID,
        steps: [STEP_A, STEP_B],
      },
      { status: 201, statusText: 'Created' },
    );
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(notifications.success).toHaveBeenCalledWith('New draft created from version 2.');
    expect(TestBed.inject(Router).url).toBe(`/plans/${PLAN_ID}/edit`);
    http.expectOne(`/api/plans/${PLAN_ID}`).flush({
      ...PLAN_WITHOUT_DRAFT,
      draft: {
        id: 'draft-2',
        editRevision: 1,
        planId: PLAN_ID,
        state: 'DRAFT',
        name: 'Thermal check',
        versionNumber: null,
        steps: [STEP_A, STEP_B],
      },
    });
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Plan Editor');
  });

  it('links to the existing draft instead of offering a second one', async () => {
    const harness = await open('PLANNER');
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    flushVersionAndPublisher(http);
    http.expectOne(`/api/plans/${PLAN_ID}`).flush({
      ...PLAN_WITHOUT_DRAFT,
      draft: {
        id: 'draft-2',
        editRevision: 6,
        planId: PLAN_ID,
        state: 'DRAFT',
        name: 'Thermal check draft',
        versionNumber: null,
        steps: [],
      },
    });
    await harness.fixture.whenStable();
    harness.detectChanges();

    const page = root.querySelector('app-plan-version-page') ?? root;
    expect(root.querySelector('#start-new-draft-button')).toBeNull();
    expect(root.textContent).toContain('An open draft already exists');
    expect(root.textContent).toContain('Current revision 6.');
    const draftLinks = Array.from(
      page.querySelectorAll<HTMLAnchorElement>(`a[href="/plans/${PLAN_ID}/edit"]`),
    );
    expect(draftLinks.some((link) => link.textContent?.includes('Continue editing draft'))).toBe(
      true,
    );
  });

  it('shows not found and renders nothing when the version belongs to another plan', async () => {
    const harness = await open('VIEWER');
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    http
      .expectOne(`/api/plan-versions/${VERSION_ID}`)
      .flush({ ...VERSION_DETAIL, planId: '99999999-9999-4999-8999-999999999999' });
    http.expectOne(`/api/plans/${PLAN_ID}/versions`).flush(VERSION_LIST);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.textContent).toContain('Published version not found');
    expect(root.textContent).toContain('does not belong to the plan in the address');
    expect(root.querySelector('#version-title')).toBeNull();
    expect(root.querySelector('table')).toBeNull();
    expect(root.textContent).not.toContain('planner@probedesk.local');
  });

  it('hides new draft on an older version and explains that the latest is copied', async () => {
    const harness = await open('PLANNER');
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);
    const latestId = '77777777-7777-4777-8777-777777777777';

    http.expectOne(`/api/plan-versions/${VERSION_ID}`).flush(VERSION_DETAIL);
    http.expectOne(`/api/plans/${PLAN_ID}/versions`).flush([
      {
        id: latestId,
        versionNumber: 3,
        name: 'Thermal check',
        publishedAt: '2026-11-03T12:00:00.000Z',
        publishedBy: {
          id: '44444444-4444-4444-8444-444444444444',
          email: 'planner@probedesk.local',
          role: 'PLANNER',
        },
      },
      ...VERSION_LIST,
    ]);
    http.expectOne(`/api/plans/${PLAN_ID}`).flush(PLAN_WITHOUT_DRAFT);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.querySelector('#start-new-draft-button')).toBeNull();
    expect(root.textContent).toContain('This is an older published version.');
    expect(root.textContent).toContain(
      'A new draft always copies the latest published version, not this older version.',
    );
    expect(
      root.querySelector<HTMLAnchorElement>(`a[href="/plans/${PLAN_ID}/versions/${latestId}"]`)
        ?.textContent,
    ).toContain('Open version 3');
    expect(http.match(`/api/plans/${PLAN_ID}/drafts`)).toHaveLength(0);
  });

  it('shows a clear not-found state for a draft or unknown version id', async () => {
    const harness = await open('VIEWER');
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    http.expectOne(`/api/plan-versions/${VERSION_ID}`).flush(
      {
        code: 'NOT_FOUND',
        message: 'The requested resource was not found.',
        requestId: 'req-version-404',
      },
      { status: 404, statusText: 'Not Found' },
    );
    http.expectOne(`/api/plans/${PLAN_ID}/versions`).flush([]);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.textContent).toContain('Published version not found');
    expect(root.textContent).toContain('Draft revisions are never shown on this page.');
    expect(root.textContent).toContain('req-version-404');
    const page = root.querySelector('app-plan-version-page') ?? root;
    expect(page.querySelector<HTMLAnchorElement>('a[href="/plans"]')?.textContent).toContain(
      'Back to plans',
    );
    expect(root.querySelector('input')).toBeNull();
  });
});
