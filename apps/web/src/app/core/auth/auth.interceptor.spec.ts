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

  it('recovers a CSRF rejection once by refreshing the cookie and retrying', async () => {
    const router = TestBed.inject(Router);
    const store = TestBed.inject(AuthSessionStore);
    const http = TestBed.inject(HttpTestingController);
    const client = TestBed.inject(HttpClient);

    await router.navigateByUrl('/plans');
    store.authenticate(OPERATOR);

    let succeeded = false;
    client.post('/api/runs', {}).subscribe(() => {
      succeeded = true;
    });

    http.expectOne('/api/runs').flush(
      {
        code: 'FORBIDDEN',
        message: 'The CSRF token is missing or invalid.',
        requestId: 'req-csrf',
      },
      { status: 403, statusText: 'Forbidden' },
    );

    const refresh = http.expectOne('/api/auth/me');
    expect(refresh.request.method).toBe('GET');
    document.cookie = 'XSRF-TOKEN=fresh-token; path=/';
    refresh.flush(OPERATOR);

    const retry = http.expectOne('/api/runs');
    expect(retry.request.headers.get('X-XSRF-TOKEN')).toBe('fresh-token');
    retry.flush(
      {
        runId: '99999999-9999-4999-8999-999999999999',
        status: 'RUNNING',
        outcome: null,
        snapshotUrl: '/api/runs/99999999-9999-4999-8999-999999999999',
        eventsUrl: '/api/runs/99999999-9999-4999-8999-999999999999/events',
      },
      { status: 202, statusText: 'Accepted' },
    );

    expect(succeeded).toBe(true);
    document.cookie = 'XSRF-TOKEN=; Max-Age=0; path=/';
  });

  it('does not refresh or retry a role 403', async () => {
    const router = TestBed.inject(Router);
    const store = TestBed.inject(AuthSessionStore);
    const http = TestBed.inject(HttpTestingController);
    const client = TestBed.inject(HttpClient);

    await router.navigateByUrl('/plans');
    store.authenticate(OPERATOR);

    let failed = false;
    client.post('/api/runs', {}).subscribe({
      error: () => {
        failed = true;
      },
    });

    http.expectOne('/api/runs').flush(
      {
        code: 'FORBIDDEN',
        message: 'You do not have permission to perform this action.',
        requestId: 'req-role',
      },
      { status: 403, statusText: 'Forbidden' },
    );

    expect(failed).toBe(true);
    http.expectNone('/api/auth/me');
    http.expectNone('/api/runs');
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
