import { Injectable, computed, signal } from '@angular/core';
import type { AuthStatus, AuthenticatedUser, Role } from './auth.types';

/**
 * Session state shared by the auth facade and the HTTP interceptor.
 *
 * Keeping the writable signals outside AuthFacade avoids a dependency cycle:
 * AuthFacade -> AuthApi -> HttpClient -> interceptor -> AuthFacade.
 */
@Injectable({ providedIn: 'root' })
export class AuthSessionStore {
  private readonly userState = signal<AuthenticatedUser | null>(null);
  private readonly statusState = signal<AuthStatus>('unknown');

  readonly user = this.userState.asReadonly();
  readonly status = this.statusState.asReadonly();
  readonly role = computed<Role | null>(() => this.userState()?.role ?? null);

  authenticate(user: AuthenticatedUser): void {
    this.userState.set(user);
    this.statusState.set('authenticated');
  }

  markAnonymous(): void {
    this.userState.set(null);
    this.statusState.set('anonymous');
  }
}
