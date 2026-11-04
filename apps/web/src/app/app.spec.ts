import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  Router,
  TitleStrategy,
  provideRouter,
  withDisabledInitialNavigation,
} from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from './app';
import { routes } from './app.routes';
import { AppTitleStrategy } from './core/title/app-title.strategy';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
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

  it('loads the session on refresh and renders the signed-in shell', async () => {
    const fixture = TestBed.createComponent(App);
    const router = TestBed.inject(Router);
    const http = TestBed.inject(HttpTestingController);

    fixture.detectChanges();
    const navigation = router.navigateByUrl('/plans');
    http.expectOne('/api/auth/me').flush({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'planner@probedesk.local',
      role: 'PLANNER',
    });
    await navigation;
    await fixture.whenStable();
    fixture.detectChanges();
    http.expectOne('/api/plans').flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('header')?.textContent).toContain('ProbeDesk');
    expect(root.querySelector('.user-email')?.textContent).toContain('planner@probedesk.local');
    expect(root.querySelector('.role-chip')?.textContent).toContain('Planner');
    expect(root.querySelector('nav[aria-label="Primary navigation"]')).not.toBeNull();
    expect(root.querySelector('main#main-content')).not.toBeNull();
    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Test Plans');
    expect(document.title).toBe('Test Plans · ProbeDesk');
  });

  it('renders the not-found page for an unknown deep link', async () => {
    const fixture = TestBed.createComponent(App);
    const router = TestBed.inject(Router);
    const http = TestBed.inject(HttpTestingController);

    fixture.detectChanges();
    const navigation = router.navigateByUrl('/this-screen-does-not-exist');
    http.expectOne('/api/auth/me').flush({
      id: '22222222-2222-4222-8222-222222222222',
      email: 'viewer@probedesk.local',
      role: 'VIEWER',
    });
    await navigation;
    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Page not found');
    expect(root.textContent).toContain("We couldn't find that page");
    expect(document.title).toBe('Page not found · ProbeDesk');
  });
});
