import {
  HttpStatus,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiException } from '../common/errors/api.exception.js';
import { assertSameOrigin } from './origin.js';

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

    assertSameOrigin(request);
    return true;
  }
}
