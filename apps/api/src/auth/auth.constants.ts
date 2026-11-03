/**
 * Names of the two cookies that make up a browser session. The session cookie
 * is HttpOnly; the CSRF cookie must stay readable for Angular's
 * HttpClientXsrfModule double-submit header.
 */
export const SESSION_COOKIE_NAME = 'probedesk_session';
export const CSRF_COOKIE_NAME = 'XSRF-TOKEN';
/** Canonical wire name shown in documentation; lookups use lowercase. */
export const CSRF_HEADER_NAME = 'x-xsrf-token';
export const CSRF_HEADER_DISPLAY_NAME = 'X-XSRF-TOKEN';

/** Absolute session lifetime. There is deliberately no sliding renewal. */
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000;

/** Per-process login throttle: failed attempts per IP and email. */
export const LOGIN_RATE_LIMIT_MAX_FAILURES = 10;
export const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
