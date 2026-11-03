import {
  HttpStatus,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiException } from '../common/errors/api.exception.js';
import { assertCsrfRequest } from './csrf.js';

/**
 * Enforces the session-bound double-submit token on POST/PUT/PATCH/DELETE.
 * Safe methods pass through; the guard relies on SessionAuthGuard having
 * attached the validated session.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const auth = request.auth;

    if (!auth) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
        'Authentication is required.',
      );
    }

    assertCsrfRequest(request, auth);
    return true;
  }
}
