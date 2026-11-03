import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
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

const PLAN_DETAIL = {
  id: PLAN_ID,
  name: 'Thermal check',
  profile: PROFILE,
  createdAt: '2026-11-03T09:00:00.000Z',
  latestPublishedVersion: {
    id: VERSION_ID,
    versionNumber: 1,
    publishedAt: '2026-11-03T10:00:00.000Z',
  },
  draft: {
    id: 'draft-1',
    editRevision: 4,
    planId: PLAN_ID,
    state: 'DRAFT',
    name: 'Thermal check',
    versionNumber: null,
    steps: [STEP_A, STEP_B],
  },
  published: null,
};

function savedDraft(
  editRevision: number,
  steps: readonly object[] = [STEP_A, STEP_B],
): object {
  return { ...PLAN_DETAIL.draft, editRevision, steps };
}

const PUBLISHED_REVISION = {
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
    versionNumber: 1,
    name: 'Thermal check',
    publishedAt: '2026-11-03T10:00:00.000Z',
    publishedBy: {
      id: '44444444-4444-4444-8444-444444444444',
      email: 'planner@probedesk.local',
      role: 'PLANNER' as const,
    },
  },
];

const CONFLICT_BODY = {
  code: 'DRAFT_CONFLICT',
  message: 'The draft was changed by another request.',
  requestId: 'req-conflict-1',
};

const STALE_PUBLISH_BODY = {
  code: 'DRAFT_CONFLICT',
  message: 'The draft was changed by another save. Reload it and try again.',
  requestId: 'req-publish-stale',
  details: { currentRevision: 9 },
};

describe('PlanEditorPage', () => {
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
    TestBed.inject(MatDialog).closeAll();
    TestBed.inject(HttpTestingController).verify();
  });

  function actAs(role: Role): void {
    TestBed.inject(AuthSessionStore).authenticate({
      id: '44444444-4444-4444-8444-444444444444',
      email: `${role.toLowerCase()}@probedesk.local`,
      role,
    });
  }

  async function openEditor(
    detail: object = PLAN_DETAIL,
    versions: readonly object[] = VERSION_LIST,
  ): Promise<RouterTestingHarness> {
    actAs('PLANNER');
    const harness = await RouterTestingHarness.create(`/plans/${PLAN_ID}/edit`);
    harness.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne(`/api/plans/${PLAN_ID}`).flush(detail);
    http.expectOne(`/api/plans/${PLAN_ID}/versions`).flush(versions);
    await harness.fixture.whenStable();
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

  function blur(root: HTMLElement, selector: string): void {
    root
      .querySelector<HTMLInputElement>(selector)
      ?.dispatchEvent(new Event('blur', { bubbles: false }));
  }

  function submit(root: HTMLElement): void {
    const form = root.querySelector('form');
    if (form === null) {
      throw new Error('Editor form not found');
    }

    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }

  function buttonByText(text: string, scope: ParentNode = document): HTMLButtonElement | undefined {
    return Array.from(scope.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(text),
    );
  }

  function metaValues(root: HTMLElement): readonly string[] {
    return Array.from(root.querySelectorAll<HTMLElement>('.plan-meta dd')).map(
      (element) => element.textContent?.trim() ?? '',
    );
  }

  it('loads the open draft, its ordered steps, and nominal totals', async () => {
    actAs('PLANNER');
    const harness = await RouterTestingHarness.create(`/plans/${PLAN_ID}/edit`);
    harness.detectChanges();
    const root = rootOf(harness);

    expect(root.textContent).toContain('Loading plan draft…');

    const http = TestBed.inject(HttpTestingController);
    http.expectOne(`/api/plans/${PLAN_ID}`).flush(PLAN_DETAIL);
    http.expectOne(`/api/plans/${PLAN_ID}/versions`).flush(VERSION_LIST);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Plan Editor');
    expect(root.querySelector<HTMLInputElement>('#plan-name')?.value).toBe('Thermal check');
    expect(metaValues(root)).toEqual(['DC Power Module', '4', 'Version 1', '2 / 30']);

    const headings = Array.from(root.querySelectorAll<HTMLElement>('.step-heading'));
    expect(headings.map((heading) => heading.textContent?.trim())).toEqual(['Step 1', 'Step 2']);
    expect(root.querySelector<HTMLInputElement>('#step-name-loaded-step-a')?.value).toBe('Voltage');
    expect(root.querySelector<HTMLInputElement>('#step-name-loaded-step-b')?.value).toBe('Current');
    expect(root.querySelector<HTMLInputElement>('#step-unit-loaded-step-b')?.value).toBe('A');

    expect(root.querySelector('.totals')?.textContent).toContain('15');
    expect(root.querySelector('.totals')?.textContent).toContain('20.0 s');
    expect(root.textContent).toContain('All changes saved');
    expect(buttonByText('Save draft', root)?.disabled).toBe(false);
    expect(root.textContent).toContain('Published versions');
    expect(
      root.querySelector<HTMLAnchorElement>(`a[href="/plans/${PLAN_ID}/versions/${VERSION_ID}"]`)
        ?.textContent,
    ).toContain('View version 1');
    expect(root.querySelector('.current-version')?.textContent).toContain('Current');
    expect(root.querySelector('.current-version')?.textContent).toContain(
      'planner@probedesk.local',
    );
  });

  it('saves an empty draft separately from publish validity', async () => {
    const harness = await openEditor({
      ...PLAN_DETAIL,
      draft: {
        ...PLAN_DETAIL.draft,
        id: 'draft-empty',
        editRevision: 2,
        name: 'Empty plan',
        steps: [],
      },
    });
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    expect(root.textContent).toContain('No steps yet');
    expect(root.textContent).toContain(
      'A draft can be saved with zero steps. Publishing requires at least one valid step.',
    );
    expect(buttonByText('Save draft', root)?.disabled).toBe(false);
    expect(root.querySelector<HTMLButtonElement>('#publish-button')?.disabled).toBe(true);
    expect(root.querySelector('#publish-availability')?.textContent).toContain(
      'Add at least one step before publishing.',
    );

    submit(root);
    const request = http.expectOne(`/api/plans/${PLAN_ID}/draft`);
    expect(request.request.body).toEqual({
      name: 'Empty plan',
      expectedRevision: 2,
      steps: [],
    });
    request.flush(savedDraft(3, []));
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(notifications.success).toHaveBeenCalledWith('Draft saved.');
    expect(metaValues(root)).toContain('3');
    expect(root.querySelector<HTMLButtonElement>('#publish-button')?.disabled).toBe(true);
    expect(root.querySelector('#publish-availability')?.textContent).toContain(
      'Add at least one step before publishing.',
    );
  });

  it('saves the visual order, trims the name, and reuses the new revision', async () => {
    const harness = await openEditor();
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    root.querySelector<HTMLButtonElement>('#move-up-loaded-step-b')?.click();
    harness.detectChanges();

    typeInto(root, '#plan-name', '  Thermal check revised  ');
    submit(root);
    harness.detectChanges();

    const request = http.expectOne(`/api/plans/${PLAN_ID}/draft`);
    const saveButton = buttonByText('Saving…', root);
    expect(saveButton?.disabled).toBe(true);
    submit(root);
    expect(http.match(`/api/plans/${PLAN_ID}/draft`)).toHaveLength(0);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({
      name: 'Thermal check revised',
      expectedRevision: 4,
      steps: [
        {
          logicalStepId: 'step-b',
          name: 'Current',
          unit: 'A',
          minimum: '0.1',
          maximum: '2',
          sampleCount: 5,
          intervalMs: 2000,
        },
        {
          logicalStepId: 'step-a',
          name: 'Voltage',
          unit: 'V',
          minimum: '4.75',
          maximum: '5.25',
          sampleCount: 10,
          intervalMs: 1000,
        },
      ],
    });

    request.flush(savedDraft(5, [{ ...STEP_B }, { ...STEP_A }]));
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(notifications.success).toHaveBeenCalledWith('Draft saved.');
    expect(root.textContent).toContain('All changes saved');
    expect(metaValues(root)).toContain('5');

    submit(root);
    const secondRequest = http.expectOne(`/api/plans/${PLAN_ID}/draft`);
    expect(secondRequest.request.body).toMatchObject({
      expectedRevision: 5,
    });
    secondRequest.flush(savedDraft(6, [{ ...STEP_B }, { ...STEP_A }]));
    await harness.fixture.whenStable();
    harness.detectChanges();
  });

  it('binds server step ids back to the same client rows after saving a new step', async () => {
    const harness = await openEditor();
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    root.querySelector<HTMLButtonElement>('#add-step-button')?.click();
    harness.detectChanges();

    typeInto(root, '#step-name-new-1', 'Resistance');
    typeInto(root, '#step-unit-new-1', 'Ohm');
    typeInto(root, '#step-minimum-new-1', '1');
    typeInto(root, '#step-maximum-new-1', '2');

    submit(root);
    const firstRequest = http.expectOne(`/api/plans/${PLAN_ID}/draft`);
    expect(firstRequest.request.body).toMatchObject({
      expectedRevision: 4,
      steps: [
        { logicalStepId: 'step-a' },
        { logicalStepId: 'step-b' },
        { logicalStepId: '', name: 'Resistance', unit: 'Ohm' },
      ],
    });

    firstRequest.flush(
      savedDraft(5, [
        { ...STEP_A },
        { ...STEP_B },
        {
          logicalStepId: 'new-id-1',
          position: 3,
          name: 'Resistance',
          unit: 'Ohm',
          minimum: '1',
          maximum: '2',
          sampleCount: 10,
          intervalMs: 1000,
        },
      ]),
    );
    await harness.fixture.whenStable();
    harness.detectChanges();

    submit(root);
    const secondRequest = http.expectOne(`/api/plans/${PLAN_ID}/draft`);
    expect(secondRequest.request.body).toMatchObject({
      expectedRevision: 5,
      steps: [
        { logicalStepId: 'step-a' },
        { logicalStepId: 'step-b' },
        { logicalStepId: 'new-id-1' },
      ],
    });
    secondRequest.flush(
      savedDraft(6, [
        { ...STEP_A },
        { ...STEP_B },
        {
          logicalStepId: 'new-id-1',
          position: 3,
          name: 'Resistance',
          unit: 'Ohm',
          minimum: '1',
          maximum: '2',
          sampleCount: 10,
          intervalMs: 1000,
        },
      ]),
    );
    await harness.fixture.whenStable();
    harness.detectChanges();
  });

  it('blocks invalid decimal, range, sample, and interval values before HTTP', async () => {
    const harness = await openEditor();
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    typeInto(root, '#step-minimum-loaded-step-a', '5');
    typeInto(root, '#step-maximum-loaded-step-a', '4');
    submit(root);
    harness.detectChanges();
    await harness.fixture.whenStable();

    expect(root.textContent).toContain('Maximum must be greater than or equal to minimum.');
    expect(document.activeElement?.id).toBe('validation-summary');
    expect(
      root.querySelector('#step-maximum-loaded-step-a')?.getAttribute('aria-describedby'),
    ).toContain('step-maximum-error-loaded-step-a');
    expect(http.match(`/api/plans/${PLAN_ID}/draft`)).toHaveLength(0);

    typeInto(root, '#step-minimum-loaded-step-a', '1.1234567');
    harness.detectChanges();
    expect(root.textContent).toContain('Use at most 6 decimal places.');

    typeInto(root, '#step-sample-count-loaded-step-a', '0');
    typeInto(root, '#step-interval-loaded-step-a', '99');
    harness.detectChanges();
    expect(root.textContent).toContain('Sample count must be at least 1.');
    expect(root.textContent).toContain('Interval must be at least 100.');

    typeInto(root, '#step-sample-count-loaded-step-a', '1001');
    typeInto(root, '#step-interval-loaded-step-a', '5001');
    harness.detectChanges();
    expect(root.textContent).toContain('Sample count must be at most 1000.');
    expect(root.textContent).toContain('Interval must be at most 5000.');
    expect(http.match(`/api/plans/${PLAN_ID}/draft`)).toHaveLength(0);
  });

  it('shows a plan-level duration limit error and keeps the sum visible', async () => {
    const harness = await openEditor();
    const root = rootOf(harness);

    typeInto(root, '#step-sample-count-loaded-step-a', '100');
    typeInto(root, '#step-sample-count-loaded-step-b', '100');
    typeInto(root, '#step-interval-loaded-step-a', '5000');
    typeInto(root, '#step-interval-loaded-step-b', '5000');
    harness.detectChanges();

    expect(root.querySelector('.totals')?.textContent).toContain('200');
    expect(root.querySelector('.totals')?.textContent).toContain('16 min 40 s');
    expect(root.textContent).toContain(
      'The plan exceeds the maximum nominal duration of 10 min 0 s.',
    );

    submit(root);
    harness.detectChanges();

    expect(root.textContent).toContain('Check the highlighted fields');
    expect(root.textContent).toContain('Nominal duration must not exceed 10 min 0 s.');
    expect(TestBed.inject(HttpTestingController).match(`/api/plans/${PLAN_ID}/draft`)).toHaveLength(
      0,
    );
  });

  it('keeps local input on a 409 conflict and reloads only after confirmation', async () => {
    const harness = await openEditor();
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    typeInto(root, '#plan-name', 'Local edited name');
    submit(root);

    http.expectOne(`/api/plans/${PLAN_ID}/draft`).flush(CONFLICT_BODY, {
      status: 409,
      statusText: 'Conflict',
    });
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.querySelector<HTMLInputElement>('#plan-name')?.value).toBe('Local edited name');
    expect(root.textContent).toContain('This draft changed in another session');
    expect(root.textContent).toContain('Your local input has not been overwritten.');
    expect(notifications.error).toHaveBeenCalledWith(
      'This draft changed in another session. Your input has been kept.',
    );

    root.querySelector<HTMLButtonElement>('#reload-draft-button')?.click();
    harness.detectChanges();
    expect(root.textContent).toContain('Reloading discards your local changes.');

    root.querySelector<HTMLButtonElement>('#confirm-reload-button')?.click();
    harness.detectChanges();

    http
      .expectOne(`/api/plans/${PLAN_ID}`)
      .flush({ ...PLAN_DETAIL, draft: { ...PLAN_DETAIL.draft, editRevision: 8 } });
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.querySelector<HTMLInputElement>('#plan-name')?.value).toBe('Thermal check');
    expect(root.textContent).not.toContain('This draft changed in another session');
    expect(metaValues(root)).toContain('8');
  });

  it('maps server field errors to the submitted row after a reorder', async () => {
    const harness = await openEditor();
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    submit(root);
    const request = http.expectOne(`/api/plans/${PLAN_ID}/draft`);
    root.querySelector<HTMLButtonElement>('#move-up-loaded-step-b')?.click();
    harness.detectChanges();

    request.flush(
      {
        code: 'VALIDATION_ERROR',
        message: 'Check the highlighted fields.',
        requestId: 'req-field-1',
        fieldErrors: [
          {
            path: 'steps.1.name',
            code: 'INVALID_NAME',
            message: 'This step name is not allowed.',
          },
        ],
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.textContent).toContain('This step name is not allowed.');
    expect(root.querySelector('#step-name-error-loaded-step-b')?.textContent).toContain(
      'This step name is not allowed.',
    );
    expect(root.querySelector('#step-name-error-loaded-step-a')).toBeNull();
  });

  it('warns before leaving with unsaved changes and keeps the editor when asked', async () => {
    const harness = await openEditor();
    const root = rootOf(harness);
    const router = TestBed.inject(Router);
    const http = TestBed.inject(HttpTestingController);

    typeInto(root, '#plan-name', 'Dirty local name');

    const firstNavigation = router.navigateByUrl('/plans');
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Leave without saving?');
    });
    harness.detectChanges();

    buttonByText('Keep editing')?.click();
    await firstNavigation;
    harness.detectChanges();

    expect(router.url).toBe(`/plans/${PLAN_ID}/edit`);
    expect(root.querySelector<HTMLInputElement>('#plan-name')?.value).toBe('Dirty local name');

    const secondNavigation = router.navigateByUrl('/plans');
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Leave without saving?');
    });
    buttonByText('Discard changes')?.click();
    await secondNavigation;
    harness.detectChanges();

    expect(router.url).toBe('/plans');
    http.expectOne('/api/plans').flush([]);
    await harness.fixture.whenStable();
    harness.detectChanges();
  });

  it('moves an invalid row with its values and errors, then focuses the next row', async () => {
    const harness = await openEditor();
    const root = rootOf(harness);

    typeInto(root, '#step-name-loaded-step-a', '');
    blur(root, '#step-name-loaded-step-a');
    typeInto(root, '#step-unit-loaded-step-b', 'mA');
    harness.detectChanges();

    expect(root.querySelector('#step-name-error-loaded-step-a')?.textContent).toContain(
      'Step name is required.',
    );

    root.querySelector<HTMLButtonElement>('#move-up-loaded-step-b')?.click();
    harness.detectChanges();

    const firstCard = root.querySelectorAll<HTMLElement>('.step-card')[0];
    const secondCard = root.querySelectorAll<HTMLElement>('.step-card')[1];

    expect(firstCard?.querySelector('.step-heading')?.textContent).toContain('Step 1');
    expect(firstCard?.querySelector<HTMLInputElement>('#step-name-loaded-step-b')?.value).toBe(
      'Current',
    );
    expect(firstCard?.querySelector<HTMLInputElement>('#step-unit-loaded-step-b')?.value).toBe(
      'mA',
    );
    expect(secondCard?.querySelector<HTMLInputElement>('#step-name-loaded-step-a')?.value).toBe('');
    expect(secondCard?.querySelector('#step-name-error-loaded-step-a')?.textContent).toContain(
      'Step name is required.',
    );
    expect(secondCard?.querySelector('.step-error')?.textContent).toContain(
      'This step has errors: step name.',
    );
    expect(firstCard?.querySelector('#step-name-error-loaded-step-b')).toBeNull();

    await harness.fixture.whenStable();
    expect(document.activeElement?.id).toBe('step-heading-loaded-step-b');
  });

  it('adds and removes rows while keeping the remaining control state and focus', async () => {
    const harness = await openEditor();
    const root = rootOf(harness);

    root.querySelector<HTMLButtonElement>('#add-step-button')?.click();
    harness.detectChanges();
    await harness.fixture.whenStable();

    const addedName = root.querySelector<HTMLInputElement>('#step-name-new-1');
    expect(addedName).not.toBeNull();
    expect(document.activeElement).toBe(addedName);

    typeInto(root, '#step-name-new-1', 'Resistance');
    harness.detectChanges();

    root.querySelector<HTMLButtonElement>('[aria-label="Remove step 2"]')?.click();
    harness.detectChanges();
    await harness.fixture.whenStable();

    expect(root.querySelectorAll('.step-card')).toHaveLength(2);
    expect(root.querySelector('#step-name-loaded-step-b')).toBeNull();
    expect(root.querySelector<HTMLInputElement>('#step-name-new-1')?.value).toBe('Resistance');
    expect(document.activeElement?.id).toBe('step-heading-new-1');
  });

  it('shows a recoverable plan load error and retries', async () => {
    actAs('PLANNER');
    const harness = await RouterTestingHarness.create(`/plans/${PLAN_ID}/edit`);
    harness.detectChanges();
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    http.expectOne(`/api/plans/${PLAN_ID}`).flush(
      {
        code: 'SERVICE_UNAVAILABLE',
        message: 'The plan service is temporarily unavailable.',
        requestId: 'req-plan-1',
      },
      { status: 503, statusText: 'Service Unavailable' },
    );
    http.expectOne(`/api/plans/${PLAN_ID}/versions`).flush([]);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.querySelector('[role="alert"]')?.textContent).toContain(
      'The plan service is temporarily unavailable.',
    );
    expect(root.textContent).toContain('req-plan-1');

    buttonByText('Try again', root)?.click();
    harness.detectChanges();

    http.expectOne(`/api/plans/${PLAN_ID}`).flush(PLAN_DETAIL);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.querySelector<HTMLInputElement>('#plan-name')?.value).toBe('Thermal check');
  });

  it('explains when the plan has no open draft', async () => {
    const harness = await openEditor({
      id: PLAN_ID,
      name: 'Published only',
      profile: PROFILE,
      createdAt: '2026-11-03T09:00:00.000Z',
      latestPublishedVersion: {
        id: VERSION_ID,
        versionNumber: 3,
        publishedAt: '2026-11-03T10:00:00.000Z',
      },
      draft: null,
      published: null,
    });
    const root = rootOf(harness);

    expect(root.textContent).toContain('No open draft');
    expect(root.textContent).toContain('Start new draft');
    expect(
      root.querySelector<HTMLAnchorElement>(`a[href="/plans/${PLAN_ID}/versions/${VERSION_ID}"]`)
        ?.textContent,
    ).toContain('View version 3');
    expect(root.querySelector<HTMLButtonElement>('#start-new-draft-button')?.disabled).toBe(false);
    expect(root.querySelector('form')).toBeNull();
    expect(buttonByText('Save draft', root)).toBeUndefined();
  });

  it('shows the step and total limits for a maximum-size draft', async () => {
    const steps = Array.from({ length: 30 }, (_, index) => ({
      ...STEP_A,
      logicalStepId: `step-${index}`,
      name: `Step ${index + 1}`,
      sampleCount: 1000,
      intervalMs: 1000,
    }));
    const harness = await openEditor({
      ...PLAN_DETAIL,
      draft: { ...PLAN_DETAIL.draft, editRevision: 1, steps },
    });
    const root = rootOf(harness);

    expect(root.querySelectorAll('.step-card')).toHaveLength(30);
    expect(root.querySelector<HTMLButtonElement>('#add-step-button')?.disabled).toBe(true);
    expect(root.textContent).toContain('A draft can contain at most 30 steps.');
    expect(root.textContent).toContain('The plan exceeds the maximum of 10,000 total samples.');
    expect(root.textContent).toContain(
      'The plan exceeds the maximum nominal duration of 10 min 0 s.',
    );
  });

  it('blocks publish while the form is dirty and explains that a save is required', async () => {
    const harness = await openEditor();
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    typeInto(root, '#plan-name', 'Unsaved local name');
    harness.detectChanges();

    const publish = root.querySelector<HTMLButtonElement>('#publish-button');
    expect(publish?.disabled).toBe(true);
    expect(root.querySelector('#publish-availability')?.textContent).toContain(
      'Save your changes before publishing',
    );
    expect(http.match(`/api/plans/${PLAN_ID}/draft/publish`)).toHaveLength(0);

    publish?.click();
    harness.detectChanges();
    expect(document.body.textContent).not.toContain('Publish this draft?');
  });

  it('confirms publish with the plan name and step count and can be cancelled', async () => {
    const harness = await openEditor();
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    root.querySelector<HTMLButtonElement>('#publish-button')?.click();
    harness.detectChanges();

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Publish this draft?');
    });
    expect(document.body.textContent).toContain('Thermal check');
    expect(document.body.textContent).toContain('2 steps');
    expect(document.body.textContent).toContain('Only the last saved draft is published.');
    expect(document.activeElement?.textContent).toContain('Keep editing');

    buttonByText('Keep editing')?.click();
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(http.match(`/api/plans/${PLAN_ID}/draft/publish`)).toHaveLength(0);
    expect(root.querySelector<HTMLButtonElement>('#publish-button')?.disabled).toBe(false);
  });

  it('publishes the saved revision, refreshes versions, and opens the no-draft state', async () => {
    const harness = await openEditor();
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    root.querySelector<HTMLButtonElement>('#publish-button')?.click();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Publish this draft?');
    });
    buttonByText('Publish version')?.click();
    await vi.waitFor(() => {
      expect(document.body.textContent).not.toContain('Publish this draft?');
    });
    await harness.fixture.whenStable();
    harness.detectChanges();

    const request = http.expectOne(`/api/plans/${PLAN_ID}/draft/publish`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ expectedRevision: 4 });
    request.flush(PUBLISHED_REVISION, { status: 201, statusText: 'Created' });

    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(notifications.success).toHaveBeenCalledWith('Version 2 published.');
    expect(root.textContent).toContain('No open draft');
    expect(root.querySelector('form')).toBeNull();
    expect(root.querySelector('#publish-success-heading')?.textContent).toContain(
      'Version 2 published',
    );
    expect(
      root.querySelector<HTMLAnchorElement>(`a[href="/plans/${PLAN_ID}/versions/${VERSION_ID}"]`)
        ?.textContent,
    ).toContain('View version 2');
    expect(root.querySelector<HTMLButtonElement>('#start-new-draft-button')?.disabled).toBe(false);

    http.expectOne(`/api/plans/${PLAN_ID}/versions`).flush([
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
      ...VERSION_LIST,
    ]);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.querySelector('.current-version')?.textContent).toContain('Version 2');
    expect(root.querySelector('.current-version')?.textContent).toContain('Current');
  });

  it('keeps the local input and offers reload when publish hits a stale revision', async () => {
    const harness = await openEditor();
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    root.querySelector<HTMLButtonElement>('#publish-button')?.click();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Publish this draft?');
    });
    buttonByText('Publish version')?.click();
    await vi.waitFor(() => {
      expect(document.body.textContent).not.toContain('Publish this draft?');
    });
    await harness.fixture.whenStable();
    harness.detectChanges();

    typeInto(root, '#plan-name', 'Local input kept');
    harness.detectChanges();

    http.expectOne(`/api/plans/${PLAN_ID}/draft/publish`).flush(STALE_PUBLISH_BODY, {
      status: 409,
      statusText: 'Conflict',
    });
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.querySelector<HTMLInputElement>('#plan-name')?.value).toBe('Local input kept');
    expect(root.textContent).toContain('This draft was saved by another session');
    expect(root.textContent).toContain('Your local input has been kept.');
    expect(root.textContent).toContain('The saved draft is now revision 9.');
    expect(root.textContent).toContain('req-publish-stale');
    expect(notifications.error).toHaveBeenCalled();

    root.querySelector<HTMLButtonElement>('#reload-draft-button')?.click();
    harness.detectChanges();
    expect(root.textContent).toContain('Reloading discards your local changes.');

    root.querySelector<HTMLButtonElement>('#confirm-reload-button')?.click();
    harness.detectChanges();
    http
      .expectOne(`/api/plans/${PLAN_ID}`)
      .flush({ ...PLAN_DETAIL, draft: { ...PLAN_DETAIL.draft, editRevision: 9 } });
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.querySelector<HTMLInputElement>('#plan-name')?.value).toBe('Thermal check');
    expect(root.textContent).not.toContain('This draft was saved by another session');
  });

  it('creates a new draft from a published version and loads it into the editor', async () => {
    const harness = await openEditor(
      {
        ...PLAN_DETAIL,
        latestPublishedVersion: {
          id: VERSION_ID,
          versionNumber: 3,
          publishedAt: '2026-11-03T10:00:00.000Z',
        },
        draft: null,
        published: null,
      },
      [],
    );
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    root.querySelector<HTMLButtonElement>('#start-new-draft-button')?.click();
    harness.detectChanges();

    const request = http.expectOne(`/api/plans/${PLAN_ID}/drafts`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toBeNull();
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

    expect(notifications.success).toHaveBeenCalledWith('New draft created from version 3.');
    expect(root.querySelector<HTMLInputElement>('#plan-name')?.value).toBe('Thermal check');
    expect(root.querySelectorAll('.step-card')).toHaveLength(2);
    expect(metaValues(root)).toContain('1');
    expect(root.querySelector('#start-new-draft-button')).toBeNull();
    expect(root.querySelector<HTMLButtonElement>('#publish-button')?.disabled).toBe(false);
  });

  it('explains an existing open draft when new draft creation conflicts', async () => {
    const harness = await openEditor(
      {
        ...PLAN_DETAIL,
        draft: null,
      },
      [],
    );
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    root.querySelector<HTMLButtonElement>('#start-new-draft-button')?.click();
    harness.detectChanges();

    http.expectOne(`/api/plans/${PLAN_ID}/drafts`).flush(
      {
        code: 'DRAFT_CONFLICT',
        message: 'This plan already has an open draft.',
        requestId: 'req-open-draft',
        details: { reason: 'OPEN_DRAFT_EXISTS', currentRevision: 6 },
      },
      { status: 409, statusText: 'Conflict' },
    );
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.textContent).toContain('This plan already has an open draft');
    expect(root.textContent).toContain('The open draft is revision 6.');
    expect(root.textContent).toContain('req-open-draft');
    expect(
      root.querySelector<HTMLAnchorElement>(`a[href="/plans/${PLAN_ID}/edit"]`)?.textContent,
    ).toContain('Open existing draft');
    expect(root.querySelector<HTMLButtonElement>('#start-new-draft-button')?.disabled).toBe(true);
  });

  it('disables new draft creation when the plan has no published version', async () => {
    const harness = await openEditor(
      {
        ...PLAN_DETAIL,
        latestPublishedVersion: null,
        draft: null,
        published: null,
      },
      [],
    );
    const root = rootOf(harness);

    expect(root.textContent).toContain('No open draft');
    expect(root.textContent).toContain('There is no published version yet.');
    expect(root.querySelector<HTMLButtonElement>('#start-new-draft-button')?.disabled).toBe(true);
  });

  it('redirects a non-Planner away from the editor', async () => {
    actAs('VIEWER');
    const harness = await RouterTestingHarness.create(`/plans/${PLAN_ID}/edit`);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(TestBed.inject(Router).url).toBe('/not-authorized');
    expect(TestBed.inject(HttpTestingController).match('/api/plans').length).toBe(0);
  });
});
