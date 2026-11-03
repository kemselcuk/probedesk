import {
  HttpErrorResponse,
  HttpInterceptorFn,
} from '@angular/common/http';
import { Injector, inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthSessionStore } from './auth-session.store';

/** Auth endpoints handle their own 401s; they must not trigger a redirect loop. */
const AUTH_ENDPOINT = /\/api\/auth\/(?:login|logout|me)(?:[?#]|$)/;

/**
 * Marks the session anonymous after a protected request returns 401 and sends
 * the user to sign in with the current application URL preserved.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const injector = inject(Injector);

  return next(request).pipe(
    catchError((error: unknown) => {
      if (
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        !AUTH_ENDPOINT.test(request.url)
      ) {
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
            queryParams: { returnUrl: currentUrl },
          });
        }
      }

      return throwError(() => error);
    }),
  );
};
