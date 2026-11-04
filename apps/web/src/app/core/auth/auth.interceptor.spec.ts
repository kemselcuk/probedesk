import {
  HttpClient,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  Router,
  Routes,
  provideRouter,
  withDisabledInitialNavigation,
} from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthSessionStore } from './auth-session.store';
import { authInterceptor } from './auth.interceptor';
import type { AuthenticatedUser } from './auth.types';

@Component({ template: '' })
class InterceptorTestPage {}

const TEST_ROUTES: Routes = [
  { path: 'plans', component: InterceptorTestPage },
  { path: 'login', component: InterceptorTestPage },
];

const OPERATOR: AuthenticatedUser = {
  id: '33333333-3333-4333-8333-333333333333',
  email: 'operator@probedesk.local',
  role: 'OPERATOR',
};

const ERROR_BODY = {
  code: 'UNAUTHENTICATED',
  message: 'The session has expired.',
  requestId: 'req-expired',
};

describe('authInterceptor', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter(TEST_ROUTES, withDisabledInitialNavigation()),
      ],
    });
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('marks a protected 401 as anonymous and preserves the current URL', async () => {
    const router = TestBed.inject(Router);
    const store = TestBed.inject(AuthSessionStore);
    const http = TestBed.inject(HttpTestingController);
    const client = TestBed.inject(HttpClient);

    await router.navigateByUrl('/plans?tab=drafts');
    store.authenticate(OPERATOR);

    let failed = false;
    client.get('/api/runs').subscribe({
      error: () => {
        failed = true;
      },
    });
    http
      .expectOne('/api/runs')
      .flush(ERROR_BODY, { status: 401, statusText: 'Unauthorized' });

    expect(failed).toBe(true);
    expect(store.status()).toBe('anonymous');
    expect(store.user()).toBeNull();

    await vi.waitFor(() => {
      expect(router.url.startsWith('/login?')).toBe(true);
    });

    const query = new URLSearchParams(router.url.split('?')[1] ?? '');
    expect(query.get('returnUrl')).toBe('/plans?tab=drafts');
    expect(query.get('reason')).toBe('session-expired');
  });

  it('leaves a 401 from an auth endpoint to the auth facade', async () => {
    const router = TestBed.inject(Router);
    const store = TestBed.inject(AuthSessionStore);
    const http = TestBed.inject(HttpTestingController);
    const client = TestBed.inject(HttpClient);

    await router.navigateByUrl('/plans');
    store.authenticate(OPERATOR);

    client.get('/api/auth/me').subscribe({ error: () => undefined });
    http
      .expectOne('/api/auth/me')
      .flush(ERROR_BODY, { status: 401, statusText: 'Unauthorized' });

    expect(router.url).toBe('/plans');
    expect(store.status()).toBe('authenticated');
    expect(store.user()).toEqual(OPERATOR);
  });
});
