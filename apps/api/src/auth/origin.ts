import { HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { ApiException } from '../common/errors/api.exception.js';

function firstHeaderValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value.split(',')[0]?.trim().toLowerCase();
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0].split(',')[0]?.trim().toLowerCase();
  }

  return undefined;
}

/**
 * Rejects a browser-supplied Origin that does not match the host the request
 * was sent to. Requests without an Origin (non-browser clients) are allowed;
 * the session-bound CSRF token still protects them. This guard is used by login
 * and by every authenticated mutation.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.origin;
  if (origin === undefined) {
    return;
  }

  if (typeof origin !== 'string' || origin === 'null') {
    throw forbiddenOrigin();
  }

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    throw forbiddenOrigin();
  }

  if (
    parsedOrigin.username ||
    parsedOrigin.password ||
    parsedOrigin.origin === 'null'
  ) {
    throw forbiddenOrigin();
  }

  const host = request.headers.host;
  if (typeof host !== 'string' || host.length === 0) {
    throw forbiddenOrigin();
  }

  const forwardedProtocol = firstHeaderValue(
    request.headers['x-forwarded-proto'],
  );
  const protocol =
    forwardedProtocol === 'http' || forwardedProtocol === 'https'
      ? forwardedProtocol
      : request.protocol;

  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(`${protocol}://${host}`).origin;
  } catch {
    throw forbiddenOrigin();
  }

  if (parsedOrigin.origin !== expectedOrigin) {
    throw forbiddenOrigin();
  }
}

function forbiddenOrigin(): ApiException {
  return new ApiException(
    HttpStatus.FORBIDDEN,
    'FORBIDDEN',
    'The request origin is not allowed.',
  );
}
