import {
  HttpStatus,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
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
 * Login accepts JSON only and, when a browser supplies an Origin header, that
 * origin must match the host the request was sent to. Non-browser clients such
 * as curl do not send Origin and are still subject to CSRF on mutations.
 */
@Injectable()
export class LoginOriginGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const contentType = request.headers['content-type'];

    if (
      typeof contentType !== 'string' ||
      !/^application\/json(?:\s*;|$)/i.test(contentType.trim())
    ) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Content-Type must be application/json.',
      );
    }

    const origin = request.headers.origin;
    if (origin === undefined) {
      return true;
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

    return true;
  }
}

function forbiddenOrigin(): ApiException {
  return new ApiException(
    HttpStatus.FORBIDDEN,
    'FORBIDDEN',
    'The request origin is not allowed.',
  );
}
