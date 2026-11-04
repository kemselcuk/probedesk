import type { Request, Response } from 'express';
import {
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
} from './auth.constants.js';

const BASE_COOKIE_OPTIONS = {
  path: '/',
  sameSite: 'lax',
  maxAge: SESSION_TTL_MS,
} as const;

export interface IssuedCookies {
  sessionToken: string;
  csrfToken: string;
  expiresAt: Date;
}

/**
 * Writes the session and CSRF cookies. The CSRF cookie is deliberately readable
 * because Angular's default XSRF handler copies it to the X-XSRF-TOKEN header.
 */
export function setAuthCookies(
  response: Response,
  secure: boolean,
  issued: IssuedCookies,
): void {
  response.cookie(SESSION_COOKIE_NAME, issued.sessionToken, {
    path: BASE_COOKIE_OPTIONS.path,
    sameSite: BASE_COOKIE_OPTIONS.sameSite,
    secure,
    httpOnly: true,
    expires: issued.expiresAt,
    maxAge: BASE_COOKIE_OPTIONS.maxAge,
  });

  response.cookie(CSRF_COOKIE_NAME, issued.csrfToken, {
    path: BASE_COOKIE_OPTIONS.path,
    sameSite: BASE_COOKIE_OPTIONS.sameSite,
    secure,
    httpOnly: false,
    expires: issued.expiresAt,
    maxAge: BASE_COOKIE_OPTIONS.maxAge,
  });
}

export function setCsrfCookie(
  response: Response,
  secure: boolean,
  csrfToken: string,
  expiresAt: Date,
): void {
  response.cookie(CSRF_COOKIE_NAME, csrfToken, {
    path: BASE_COOKIE_OPTIONS.path,
    sameSite: BASE_COOKIE_OPTIONS.sameSite,
    secure,
    httpOnly: false,
    expires: expiresAt,
    maxAge: Math.max(0, expiresAt.getTime() - Date.now()),
  });
}

/** Clears both cookies with the same attributes used when they were written. */
export function clearAuthCookies(response: Response, secure: boolean): void {
  const options = {
    path: BASE_COOKIE_OPTIONS.path,
    sameSite: BASE_COOKIE_OPTIONS.sameSite,
    secure,
  } as const;

  response.clearCookie(SESSION_COOKIE_NAME, {
    ...options,
    httpOnly: true,
  });
  response.clearCookie(CSRF_COOKIE_NAME, {
    ...options,
    httpOnly: false,
  });
}

/** Reads only an explicitly named, non-empty session cookie. */
export function readSessionToken(request: Request): string | undefined {
  const value: unknown = request.cookies?.[SESSION_COOKIE_NAME];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Reads the readable CSRF cookie, if the browser still has it. */
export function readCsrfToken(request: Request): string | undefined {
  const value: unknown = request.cookies?.[CSRF_COOKIE_NAME];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
