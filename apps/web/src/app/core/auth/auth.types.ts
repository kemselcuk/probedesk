import type { components } from '@probedesk/api-client';

/** The signed-in user summary, derived from the generated OpenAPI contract. */
export type AuthenticatedUser = components['schemas']['AuthUserDto'];

/** Roles defined by the product contract. The API enforces access. */
export type Role = AuthenticatedUser['role'];

/** Session state before `/auth/me` has been resolved. */
export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous';

/** Credentials typed by the login form. */
export interface LoginCredentials {
  readonly email: string;
  readonly password: string;
}

export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  PLANNER: 'Planner',
  OPERATOR: 'Operator',
  VIEWER: 'Viewer',
};

export function roleLabel(role: Role | null): string {
  return role === null ? 'Not signed in' : ROLE_LABELS[role];
}
