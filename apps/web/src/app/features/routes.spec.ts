import { TestBed } from '@angular/core/testing';
import {
  Router,
  TitleStrategy,
  provideRouter,
  withDisabledInitialNavigation,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppTitleStrategy } from '../core/title/app-title.strategy';
import { routes } from '../app.routes';

interface RouteCase {
  readonly url: string;
  readonly title: string;
  readonly heading: string;
  readonly task: string;
}

const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const VERSION_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '33333333-3333-4333-8333-333333333333';

const routeCases: readonly RouteCase[] = [
  { url: '/login', title: 'Sign in', heading: 'Sign in', task: 'P1-07' },
  { url: '/plans', title: 'Test Plans', heading: 'Test Plans', task: 'P2-03' },
  {
    url: `/plans/${PLAN_ID}/edit`,
    title: 'Plan Editor',
    heading: 'Plan Editor',
    task: 'P2-03',
  },
  {
    url: `/plans/${PLAN_ID}/versions/${VERSION_ID}`,
    title: 'Published Plan',
    heading: 'Published Plan',
    task: 'P2-03',
  },
  { url: '/runs', title: 'Run History', heading: 'Run History', task: 'P5-02' },
  { url: '/runs/new', title: 'Start Run', heading: 'Start Run', task: 'P3-09' },
  {
    url: `/runs/${RUN_ID}/live`,
    title: 'Live Run',
    heading: 'Live Run',
    task: 'P4-04',
  },
  {
    url: `/runs/${RUN_ID}`,
    title: 'Run Details',
    heading: 'Run Details',
    task: 'P5-03',
  },
  {
    url: '/compare',
    title: 'Compare Runs',
    heading: 'Compare Runs',
    task: 'P6-02',
  },
];

describe('application routes', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        provideRouter(routes, withDisabledInitialNavigation()),
        { provide: TitleStrategy, useClass: AppTitleStrategy },
      ],
    }).compileComponents();
  });

  it('resolves every deep link to the intended screen', async () => {
    const harness = await RouterTestingHarness.create('/plans');
    const router = TestBed.inject(Router);

    for (const routeCase of routeCases) {
      await harness.navigateByUrl(routeCase.url);
      await harness.fixture.whenStable();
      harness.detectChanges();

      const root = harness.fixture.nativeElement as HTMLElement;
      const page = root.querySelector('main') ?? root;

      expect(router.url).toBe(routeCase.url);
      expect(root.querySelector('h1')?.textContent?.trim()).toBe(
        routeCase.heading,
      );
      expect(page.textContent).toContain(routeCase.task);
      expect(document.title).toBe(`${routeCase.title} · ProbeDesk`);
    }
  });

  it('falls back to the not-found route without leaving the shell', async () => {
    const harness = await RouterTestingHarness.create('/plans');

    await harness.navigateByUrl('/plans/not-a-valid-path/extra');
    await harness.fixture.whenStable();
    harness.detectChanges();

    const text = harness.fixture.nativeElement.textContent ?? '';

    expect(text).toContain('Page not found');
    expect(text).toContain('Go to Test Plans');
    expect(document.title).toBe('Page not found · ProbeDesk');
  });
});
