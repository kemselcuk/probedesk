import { Injectable, computed, signal } from '@angular/core';

/** Roles defined by the product contract. Access is enforced by the API. */
export type Role = 'PLANNER' | 'OPERATOR' | 'VIEWER';

/**
 * Placeholder authentication facade for the application shell.
 *
 * P1-07 replaces the local role signal with the real `/auth/me` session state.
 * Until then the application is deliberately signed out.
 */
@Injectable({ providedIn: 'root' })
export class AuthFacade {
  readonly role = signal<Role | null>(null);

  readonly isAuthenticated = computed(() => this.role() !== null);

  hasRole(...roles: readonly Role[]): boolean {
    const currentRole = this.role();
    return currentRole !== null && roles.includes(currentRole);
  }
}
