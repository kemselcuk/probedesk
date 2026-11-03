import { TestBed } from '@angular/core/testing';
import {
  TitleStrategy,
  provideRouter,
  withDisabledInitialNavigation,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthFacade } from '../../core/auth/auth.facade';
import { AppTitleStrategy } from '../../core/title/app-title.strategy';
import { routes } from '../../app.routes';

describe('AppShell', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        provideRouter(routes, withDisabledInitialNavigation()),
        { provide: TitleStrategy, useClass: AppTitleStrategy },
      ],
    }).compileComponents();
  });

  it('exposes a skip link, active navigation, and the main landmark', async () => {
    const harness = await RouterTestingHarness.create('/plans');
    harness.detectChanges();

    const root = harness.fixture.nativeElement as HTMLElement;
    const skipLink = root.querySelector<HTMLAnchorElement>('a.skip-link');
    const activeLink = root.querySelector<HTMLAnchorElement>(
      'a[aria-current="page"]',
    );

    expect(skipLink?.getAttribute('href')).toBe('#main-content');
    expect(root.querySelector('main#main-content')).not.toBeNull();
    expect(activeLink?.textContent).toContain('Test Plans');
    expect(
      root.querySelector('a[href="/runs"]')?.textContent,
    ).toContain('Run History');
    expect(
      root.querySelector('a[href="/compare"]')?.textContent,
    ).toContain('Compare Runs');
  });

  it('moves focus to the main landmark when the skip link is used', async () => {
    const harness = await RouterTestingHarness.create('/plans');
    harness.detectChanges();

    const root = harness.fixture.nativeElement as HTMLElement;
    const skipLink = root.querySelector<HTMLAnchorElement>('a.skip-link');
    const main = root.querySelector<HTMLElement>('main#main-content');

    main?.blur();
    skipLink?.click();

    expect(main?.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(main);
  });

  it('keeps actions disabled until a role is available', async () => {
    const harness = await RouterTestingHarness.create('/plans');
    const auth = TestBed.inject(AuthFacade);
    harness.detectChanges();

    const actionButtons = (): HTMLButtonElement[] =>
      Array.from(
        (harness.fixture.nativeElement as HTMLElement).querySelectorAll(
          'button.planned-action',
        ),
      );

    const newPlanBefore = actionButtons().find((button) =>
      button.textContent?.includes('New plan'),
    );
    const startRunBefore = actionButtons().find((button) =>
      button.textContent?.includes('Start run'),
    );

    expect(newPlanBefore?.disabled).toBe(true);
    expect(startRunBefore?.disabled).toBe(true);

    auth.role.set('PLANNER');
    harness.detectChanges();

    const newPlanAfter = actionButtons().find((button) =>
      button.textContent?.includes('New plan'),
    );
    const startRunAfter = actionButtons().find((button) =>
      button.textContent?.includes('Start run'),
    );

    expect(newPlanAfter?.disabled).toBe(false);
    expect(startRunAfter?.disabled).toBe(true);
  });
});
