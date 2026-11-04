import { Injectable, inject } from '@angular/core';
import { Observable, finalize, map, shareReplay } from 'rxjs';
import { AuthApi } from './auth-api';

/**
 * Refreshes the readable CSRF cookie after a mutation was rejected because the
 * browser no longer has it (or has a stale value).
 *
 * `GET /auth/me` is same-origin and idempotent; the API rotates the token only
 * when the cookie is missing or does not match the session hash, then returns
 * a fresh `Set-Cookie`. Concurrent callers share one refresh so two rejected
 * requests cannot race each other into a token loop.
 */
@Injectable({ providedIn: 'root' })
export class CsrfRecoveryService {
  private readonly authApi = inject(AuthApi);
  private inFlight$: Observable<void> | null = null;

  refresh(): Observable<void> {
    if (this.inFlight$ !== null) {
      return this.inFlight$;
    }

    let request$: Observable<void>;
    request$ = this.authApi.me().pipe(
      map(() => void 0),
      finalize(() => {
        if (this.inFlight$ === request$) {
          this.inFlight$ = null;
        }
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    this.inFlight$ = request$;

    return request$;
  }
}
