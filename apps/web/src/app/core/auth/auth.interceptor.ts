import {
  HttpErrorResponse,
  HttpEvent,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { Injector, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, switchMap, throwError } from 'rxjs';
import { AuthSessionStore } from './auth-session.store';
import { CsrfRecoveryService } from './csrf-recovery.service';

/** Auth endpoints handle their own 401s; they must not trigger a redirect loop. */
const AUTH_ENDPOINT = /\/api\/auth\/(?:login|logout|me)(?:[?#]|$)/;

/** A refresh calls `/auth/me`; login is unauthenticated and needs no token. */
const CSRF_RECOVERY_EXEMPT = /\/api\/auth\/(?:login|me)(?:[?#]|$)/;

const CSRF_ERROR_MESSAGE = 'The CSRF token is missing or invalid.';

/**
 * Marks the session anonymous after a protected request returns 401 and sends
 * the user to sign in with the current application URL preserved. The login
 * page explains the interruption and returns to the exact screen, filter, and
 * page after a successful sign-in.
 *
 * A mutation rejected with the documented CSRF error gets one safe recovery:
 * refresh `/auth/me` (which reissues the readable cookie) and retry the same
 * request once. The API rejects CSRF before changing state, so the retry cannot
 * duplicate a write. A role or origin 403 has a different message and is never
 * retried.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const injector = inject(Injector);

  const withUnauthorizedHandling = (
    source: Observable<HttpEvent<unknown>>,
  ): Observable<HttpEvent<unknown>> =>
    source.pipe(
      catchError((error: unknown) => {
        if (
          error instanceof HttpErrorResponse &&
          error.status === 401 &&
          !AUTH_ENDPOINT.test(request.url)
        ) {
          markSessionExpired(injector);
        }

        return throwError(() => error);
      }),
    );

  return withUnauthorizedHandling(
    next(request).pipe(
      catchError((error: unknown) => {
        if (
          !isCsrfFailure(error) ||
          CSRF_RECOVERY_EXEMPT.test(request.url)
        ) {
          return throwError(() => error);
        }

        return injector
          .get(CsrfRecoveryService)
          .refresh()
          .pipe(
            switchMap(() => next(withCurrentCsrfHeader(request))),
            catchError(() => throwError(() => error)),
          );
      }),
    ),
  );
};

function isCsrfFailure(error: unknown): error is HttpErrorResponse {
  if (!(error instanceof HttpErrorResponse) || error.status !== 403) {
    return false;
  }

  const body: unknown = error.error;
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as { message?: unknown }).message === CSRF_ERROR_MESSAGE
  );
}

/**
 * Angular's XSRF interceptor normally adds the header. The recovery retry is
 * built after that interceptor already ran for the original request, so copy
 * the freshly issued cookie explicitly.
 */
function withCurrentCsrfHeader(
  request: HttpRequest<unknown>,
): HttpRequest<unknown> {
  const token = readCookie('XSRF-TOKEN');
  return token === null
    ? request
    : request.clone({
        headers: request.headers.set('X-XSRF-TOKEN', token),
      });
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const prefix = `${name}=`;
  for (const part of document.cookie.split(';')) {
    const value = part.trim();
    if (value.startsWith(prefix)) {
      return decodeURIComponent(value.slice(prefix.length));
    }
  }

  return null;
}

function markSessionExpired(injector: Injector): void {
  const session = injector.get(AuthSessionStore);
  const router = injector.get(Router);
  const wasAuthenticated = session.status() === 'authenticated';
  const currentUrl = router.url;

  session.markAnonymous();

  if (
    wasAuthenticated &&
    !currentUrl.startsWith('/login') &&
    currentUrl !== '/'
  ) {
    void router.navigate(['/login'], {
      queryParams: {
        returnUrl: currentUrl,
        reason: 'session-expired',
      },
    });
  }
}
