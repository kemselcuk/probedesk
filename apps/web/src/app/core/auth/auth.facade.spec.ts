import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { of } from 'rxjs';
import { AuthFacade } from './auth.facade';
import type { AuthenticatedUser } from './auth.types';

const PLANNER: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'planner@probedesk.local',
  role: 'PLANNER',
};

const ERROR_BODY = {
  code: 'UNAUTHENTICATED',
  message: 'The email or password is incorrect.',
  requestId: 'req-auth-1',
};

describe('AuthFacade', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('starts with an unknown session and no role', () => {
    const auth = TestBed.inject(AuthFacade);

    expect(auth.status()).toBe('unknown');
    expect(auth.user()).toBeNull();
    expect(auth.role()).toBeNull();
    expect(auth.isAuthenticated()).toBe(false);
    expect(auth.hasRole('PLANNER')).toBe(false);
  });

  it('loads the session once even when several callers ask before the response', () => {
    const auth = TestBed.inject(AuthFacade);
    const http = TestBed.inject(HttpTestingController);
    const loaded: (AuthenticatedUser | null)[] = [];

    auth.loadSession().subscribe((user) => loaded.push(user));
    auth.loadSession().subscribe((user) => loaded.push(user));

    const request = http.expectOne('/api/auth/me');
    expect(request.request.method).toBe('GET');
    request.flush(PLANNER);

    expect(loaded).toEqual([PLANNER, PLANNER]);
    expect(auth.user()).toEqual(PLANNER);
    expect(auth.role()).toBe('PLANNER');
    expect(auth.status()).toBe('authenticated');
    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.hasRole('PLANNER', 'OPERATOR')).toBe(true);
    expect(auth.hasRole('VIEWER')).toBe(false);
  });

  it('treats a 401 from /auth/me as an anonymous session', () => {
    const auth = TestBed.inject(AuthFacade);
    const http = TestBed.inject(HttpTestingController);
    let result: AuthenticatedUser | null | undefined;

    auth.loadSession().subscribe((user) => {
      result = user;
    });
    http
      .expectOne('/api/auth/me')
      .flush(ERROR_BODY, { status: 401, statusText: 'Unauthorized' });

    expect(result).toBeNull();
    expect(auth.status()).toBe('anonymous');
    expect(auth.user()).toBeNull();
    expect(auth.error()).toBeNull();
  });

  it('retries session discovery after a transient failure', () => {
    const auth = TestBed.inject(AuthFacade);
    const http = TestBed.inject(HttpTestingController);
    let firstResult: AuthenticatedUser | null | undefined;
    let retriedResult: AuthenticatedUser | null | undefined;

    auth.loadSession().subscribe((user) => {
      firstResult = user;
    });
    http.expectOne('/api/auth/me').flush(
      {
        code: 'SERVICE_UNAVAILABLE',
        message: 'The session service is unavailable.',
        requestId: 'req-session-503',
      },
      { status: 503, statusText: 'Service Unavailable' },
    );

    expect(firstResult).toBeNull();
    expect(auth.status()).toBe('unknown');
    expect(auth.user()).toBeNull();
    expect(auth.error()).toMatchObject({
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      requestId: 'req-session-503',
    });

    auth.loadSession().subscribe((user) => {
      retriedResult = user;
    });
    http.expectOne('/api/auth/me').flush(PLANNER);

    expect(retriedResult).toEqual(PLANNER);
    expect(auth.user()).toEqual(PLANNER);
    expect(auth.status()).toBe('authenticated');
    expect(auth.error()).toBeNull();
  });

  it('does not let a stale session response erase a later login', () => {
    const auth = TestBed.inject(AuthFacade);
    const http = TestBed.inject(HttpTestingController);

    auth.loadSession().subscribe();
    const staleSession = http.expectOne('/api/auth/me');

    auth
      .login(of({ email: PLANNER.email, password: 'demo-password' }))
      .subscribe();
    http.expectOne('/api/auth/login').flush(PLANNER);

    staleSession.flush(ERROR_BODY, {
      status: 401,
      statusText: 'Unauthorized',
    });

    expect(auth.user()).toEqual(PLANNER);
    expect(auth.status()).toBe('authenticated');
    expect(auth.isAuthenticated()).toBe(true);
  });

  it('does not let a stale session response re-authenticate after logout', () => {
    const auth = TestBed.inject(AuthFacade);
    const http = TestBed.inject(HttpTestingController);

    auth.loadSession().subscribe();
    const staleSession = http.expectOne('/api/auth/me');

    auth.logout().subscribe();
    http
      .expectOne('/api/auth/logout')
      .flush(null, { status: 204, statusText: 'No Content' });

    staleSession.flush(PLANNER);

    expect(auth.user()).toBeNull();
    expect(auth.status()).toBe('anonymous');
  });

  it('signs in with one POST and exposes the pending state', () => {
    const auth = TestBed.inject(AuthFacade);
    const http = TestBed.inject(HttpTestingController);
    let signedIn: AuthenticatedUser | undefined;

    auth
      .login(of({ email: PLANNER.email, password: 'demo-password' }))
      .subscribe((user) => {
        signedIn = user;
      });

    expect(auth.pending()).toBe(true);

    const request = http.expectOne('/api/auth/login');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      email: PLANNER.email,
      password: 'demo-password',
    });

    request.flush(PLANNER);

    expect(signedIn).toEqual(PLANNER);
    expect(auth.user()).toEqual(PLANNER);
    expect(auth.role()).toBe('PLANNER');
    expect(auth.status()).toBe('authenticated');
    expect(auth.pending()).toBe(false);
    expect(auth.error()).toBeNull();
  });

  it('ignores a second sign-in subscription while a request is pending', () => {
    const auth = TestBed.inject(AuthFacade);
    const http = TestBed.inject(HttpTestingController);
    let firstSignedIn = false;
    let secondSignedIn = false;
    const credentials$ = of({
      email: PLANNER.email,
      password: 'demo-password',
    });

    auth.login(credentials$).subscribe(() => {
      firstSignedIn = true;
    });
    auth.login(credentials$).subscribe(() => {
      secondSignedIn = true;
    });

    const request = http.expectOne('/api/auth/login');
    request.flush(PLANNER);

    expect(firstSignedIn).toBe(true);
    expect(secondSignedIn).toBe(false);
  });

  it('keeps the API failure visible and releases the pending state', () => {
    const auth = TestBed.inject(AuthFacade);
    const http = TestBed.inject(HttpTestingController);
    let failure: unknown;

    auth
      .login(of({ email: PLANNER.email, password: 'wrong' }))
      .subscribe({ error: (error: unknown) => (failure = error) });

    http.expectOne('/api/auth/login').flush(
      {
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many sign-in attempts.',
        requestId: 'req-rate-limit',
      },
      { status: 429, statusText: 'Too Many Requests' },
    );

    expect(failure).toBeInstanceOf(HttpErrorResponse);
    expect(auth.error()).toMatchObject({
      kind: 'api',
      status: 429,
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many sign-in attempts.',
      requestId: 'req-rate-limit',
    });
    expect(auth.pending()).toBe(false);
    expect(auth.status()).toBe('unknown');
  });

  it('logs out through the API and clears the session', () => {
    const auth = TestBed.inject(AuthFacade);
    const http = TestBed.inject(HttpTestingController);
    let completed = false;

    auth.loadSession().subscribe();
    http.expectOne('/api/auth/me').flush(PLANNER);

    auth.logout().subscribe({
      complete: () => {
        completed = true;
      },
    });

    expect(auth.pending()).toBe(true);

    const request = http.expectOne('/api/auth/logout');
    expect(request.request.method).toBe('POST');
    request.flush(null, { status: 204, statusText: 'No Content' });

    expect(completed).toBe(true);
    expect(auth.pending()).toBe(false);
    expect(auth.status()).toBe('anonymous');
    expect(auth.user()).toBeNull();
    expect(auth.role()).toBeNull();
  });

  it('keeps the session when logout fails for a non-auth reason', () => {
    const auth = TestBed.inject(AuthFacade);
    const http = TestBed.inject(HttpTestingController);
    let failure: unknown;

    auth.loadSession().subscribe();
    http.expectOne('/api/auth/me').flush(PLANNER);
    auth.logout().subscribe({
      error: (error: unknown) => (failure = error),
    });

    http.expectOne('/api/auth/logout').flush(
      {
        code: 'SERVICE_UNAVAILABLE',
        message: 'The session service is unavailable.',
        requestId: 'req-logout',
      },
      { status: 503, statusText: 'Service Unavailable' },
    );

    expect(failure).toBeInstanceOf(HttpErrorResponse);
    expect(auth.status()).toBe('authenticated');
    expect(auth.user()).toEqual(PLANNER);
    expect(auth.error()?.code).toBe('SERVICE_UNAVAILABLE');
    expect(auth.pending()).toBe(false);
  });

  it('treats a 401 on logout as an already-ended session', () => {
    const auth = TestBed.inject(AuthFacade);
    const http = TestBed.inject(HttpTestingController);

    auth.loadSession().subscribe();
    http.expectOne('/api/auth/me').flush(PLANNER);
    auth.logout().subscribe();

    http
      .expectOne('/api/auth/logout')
      .flush(ERROR_BODY, { status: 401, statusText: 'Unauthorized' });

    expect(auth.status()).toBe('anonymous');
    expect(auth.user()).toBeNull();
    expect(auth.pending()).toBe(false);
  });
});
