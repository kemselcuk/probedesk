/** Roles defined by the product contract. The API enforces access. */
export type Role = 'PLANNER' | 'OPERATOR' | 'VIEWER';

/** Session state before `/auth/me` has been resolved. */
export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous';

/** The signed-in user summary returned by the auth endpoints. */
export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string;
  readonly role: Role;
}

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
