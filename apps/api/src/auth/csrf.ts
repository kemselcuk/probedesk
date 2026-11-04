import { HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { ApiException } from '../common/errors/api.exception.js';
import { CSRF_HEADER_NAME } from './auth.constants.js';
import type { AuthContext } from './auth.types.js';
import { assertSameOrigin } from './origin.js';
import { hashToken, tokenHashMatches } from './token.js';

/** Safe methods never require the double-submit header. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}

/**
 * Validates the Angular-style header against the digest stored on the session.
 * The raw token is never compared or logged.
 */
export function hasValidCsrfToken(
  headerValue: unknown,
  storedHash: string | null | undefined,
): boolean {
  if (typeof headerValue !== 'string' || headerValue.length === 0) {
    return false;
  }

  return tokenHashMatches(hashToken(headerValue), storedHash);
}

export function assertCsrfRequest(request: Request, auth: AuthContext): void {
  if (isSafeMethod(request.method)) {
    return;
  }

  // A browser cannot read the CSRF cookie cross-origin, but an attacker can
  // still submit a form with an Origin it controls. Reject that Origin before
  // evaluating the token; non-browser clients without Origin keep working.
  assertSameOrigin(request);

  if (
    !hasValidCsrfToken(request.headers[CSRF_HEADER_NAME], auth.csrfTokenHash)
  ) {
    throw new ApiException(
      HttpStatus.FORBIDDEN,
      'FORBIDDEN',
      'The CSRF token is missing or invalid.',
    );
  }
}
