import { Injectable, computed, inject, signal } from '@angular/core';
import {
  EMPTY,
  Observable,
  catchError,
  finalize,
  map,
  of,
  shareReplay,
  switchMap,
  take,
  tap,
  throwError,
} from 'rxjs';
import { HttpErrorNormalizer, ApiErrorView } from '../http/http-error-normalizer';
import { AuthApi } from './auth-api';
import { AuthSessionStore } from './auth-session.store';
import type {
  AuthStatus,
  AuthenticatedUser,
  LoginCredentials,
  Role,
} from './auth.types';

/**
 * Application-facing authentication facade.
 *
 * The API remains the authority for roles; this facade only drives the session
 * UI, navigation, and route guards.
 */
@Injectable({ providedIn: 'root' })
export class AuthFacade {
  private readonly authApi = inject(AuthApi);
  private readonly sessionStore = inject(AuthSessionStore);
  private readonly errorNormalizer = inject(HttpErrorNormalizer);

  private readonly pendingState = signal(false);
  private readonly errorState = signal<ApiErrorView | null>(null);
  private sessionRequest$: Observable<AuthenticatedUser | null> | null = null;
  /**
   * Invalidates every in-flight session discovery when the authoritative
   * session changes. A slow `/auth/me` response from before a login/logout must
   * never overwrite the state established by the newer action.
   */
  private sessionGeneration = 0;

  readonly user = this.sessionStore.user;
  readonly role = this.sessionStore.role;
  readonly status = this.sessionStore.status;
  readonly pending = this.pendingState.asReadonly();
  readonly error = this.errorState.asReadonly();

  readonly isAuthenticated = computed(() => this.status() === 'authenticated');

  hasRole(...roles: readonly Role[]): boolean {
    const currentRole = this.role();
    return currentRole !== null && roles.includes(currentRole);
  }

  /**
   * Resolves the session exactly once after a page refresh. A 401 is the normal
   * anonymous result; other failures are exposed through `error` and leave the
   * status unknown so the caller can decide whether to retry.
   */
  loadSession(): Observable<AuthenticatedUser | null> {
    if (this.status() === 'authenticated') {
      return of(this.user());
    }

    if (this.status() === 'anonymous') {
      return of(null);
    }

    if (this.sessionRequest$ === null) {
      const generation = this.sessionGeneration;
      this.errorState.set(null);

      this.sessionRequest$ = this.authApi.me().pipe(
        map((user) => {
          if (generation !== this.sessionGeneration) {
            // The session was changed by a newer login/logout while this
            // request was in flight. Report the current authoritative state
            // instead of the stale response.
            return this.user();
          }

          this.sessionStore.authenticate(user);
          return user;
        }),
        catchError((error: unknown) => {
          const view = this.errorNormalizer.normalize(error);

          if (generation !== this.sessionGeneration) {
            return of(this.user());
          }

          if (view.status === 401) {
            this.sessionStore.markAnonymous();
            return of(null);
          }

          // A transient failure is not an anonymous session. Clear the shared
          // request so a later caller can retry; until then the status stays
          // `unknown` and the error remains visible.
          this.errorState.set(view);
          this.sessionRequest$ = null;
          return of(null);
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    }

    return this.sessionRequest$;
  }

  /**
   * Performs a single sign-in request. The observable credentials input keeps
   * the facade RxJS-based; a second submission while pending is ignored.
   */
  login(credentials$: Observable<LoginCredentials>): Observable<AuthenticatedUser> {
    return credentials$.pipe(
      take(1),
      switchMap((credentials) => {
        if (this.pendingState()) {
          return EMPTY;
        }

        this.pendingState.set(true);
        this.errorState.set(null);

        return this.authApi.login(credentials).pipe(
          tap((user) => {
            this.sessionGeneration += 1;
            this.sessionRequest$ = null;
            this.sessionStore.authenticate(user);
          }),
          catchError((error: unknown) => {
            this.errorState.set(this.errorNormalizer.normalize(error));
            return throwError(() => error);
          }),
          finalize(() => this.pendingState.set(false)),
        );
      }),
    );
  }

  /**
   * Revokes the server session. A 401 means the session is already gone, which
   * is treated as a successful sign-out. Other failures keep the local session
   * and surface the error so the shell does not claim a false success.
   */
  logout(): Observable<void> {
    if (this.pendingState()) {
      return EMPTY;
    }

    this.pendingState.set(true);
    this.errorState.set(null);
    // Any session discovery started before this sign-out belongs to the old
    // session, even if the sign-out request fails later.
    this.sessionGeneration += 1;

    return this.authApi.logout().pipe(
      tap(() => this.clearSession()),
      catchError((error: unknown) => {
        const view = this.errorNormalizer.normalize(error);
        if (view.status === 401) {
          this.clearSession();
          return of(void 0);
        }

        this.errorState.set(view);
        return throwError(() => error);
      }),
      finalize(() => this.pendingState.set(false)),
    );
  }

  clearError(): void {
    this.errorState.set(null);
  }

  private clearSession(): void {
    this.sessionGeneration += 1;
    this.sessionRequest$ = null;
    this.sessionStore.markAnonymous();
  }
}

export type { AuthStatus, AuthenticatedUser, LoginCredentials, Role };
