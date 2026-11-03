import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Accept caller-supplied correlation IDs only when they are short and safe for
 * logs and response headers. Anything else is replaced with a fresh UUID.
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

export interface RequestWithRequestId extends Request {
  requestId: string;
}

export function isValidRequestId(value: string | undefined): value is string {
  return value !== undefined && REQUEST_ID_PATTERN.test(value);
}

export function requestIdMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const incoming = request.header(REQUEST_ID_HEADER);
  const requestId = isValidRequestId(incoming) ? incoming : randomUUID();

  (request as RequestWithRequestId).requestId = requestId;
  response.setHeader('X-Request-Id', requestId);
  next();
}

export function getRequestId(request: Request): string {
  const candidate = (request as Partial<RequestWithRequestId>).requestId;
  return typeof candidate === 'string' && candidate.length > 0
    ? candidate
    : randomUUID();
}
