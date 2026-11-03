import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, TitleStrategy, provideRouter, withDisabledInitialNavigation } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { routes } from '../../app.routes';
import { AuthSessionStore } from '../../core/auth/auth-session.store';
import type { Role } from '../../core/auth/auth.types';
import { AppTitleStrategy } from '../../core/title/app-title.strategy';

const RUN_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_RUN_ID = '44444444-4444-4444-8444-444444444444';
const USER_ID = '55555555-5555-4555-8555-555555555555';

describe('LiveRunPage', () => {
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
      id: USER_ID,
      email: `${role.toLowerCase()}@probedesk.local`,
      role,
    });
  }

  async function openLive(runId: string): Promise<RouterTestingHarness> {
    actAs('VIEWER');
    const harness = await RouterTestingHarness.create(`/runs/${runId}/live`);
    harness.detectChanges();
    return harness;
  }

  function rootOf(harness: RouterTestingHarness): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  it('keeps the placeholder honest and links to the recorded run details', async () => {
    const harness = await openLive(RUN_ID);
    const root = rootOf(harness);

    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Live Run');
    expect(root.textContent).toContain('This screen is not available yet');
    expect(root.textContent).toContain('P4-04');

    const link = root.querySelector<HTMLAnchorElement>(`a[href="/runs/${RUN_ID}"]`);
    expect(link?.textContent).toContain('View run details');

    link?.click();
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(TestBed.inject(Router).url).toBe(`/runs/${RUN_ID}`);
    TestBed.inject(HttpTestingController)
      .expectOne(`/api/runs/${RUN_ID}`)
      .flush(
        {
          code: 'NOT_FOUND',
          message: 'The run was not found.',
          requestId: 'req-live-details-404',
        },
        { status: 404, statusText: 'Not Found' },
      );
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Run Details');
    expect(root.textContent).toContain('Run not found');
  });

  it('uses the runId from the route for the details link', async () => {
    const harness = await openLive(RUN_ID);
    const root = rootOf(harness);

    await harness.navigateByUrl(`/runs/${OTHER_RUN_ID}/live`);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(TestBed.inject(Router).url).toBe(`/runs/${OTHER_RUN_ID}/live`);
    expect(root.querySelector(`a[href="/runs/${OTHER_RUN_ID}"]`)?.textContent).toContain(
      'View run details',
    );
    expect(root.querySelector(`a[href="/runs/${RUN_ID}"]`)).toBeNull();
  });
});
