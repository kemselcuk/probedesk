import type { Role } from '../prisma/generated/client.js';

/** The only user fields that may leave the API. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
}

/** Validated server-side session attached to an authenticated request. */
export interface AuthContext {
  sessionId: string;
  user: AuthenticatedUser;
  csrfTokenHash: string | null;
  expiresAt: Date;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}
