import {
  HttpStatus,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiException } from '../common/errors/api.exception.js';
import { AuthService } from './auth.service.js';
import { assertCsrfRequest } from './csrf.js';
import { readSessionToken } from './cookie.js';

/**
 * Requires a live server-side session. Missing, expired, revoked and unknown
 * cookies all produce the same contract-shaped 401 without touching the DB with
 * an unhashed value.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = readSessionToken(request);

    if (!token) {
      throw unauthenticated();
    }

    const auth = await this.authService.findSession(token);
    if (!auth) {
      throw unauthenticated();
    }

    request.auth = auth;
    // Defence in depth: an authenticated mutation never proceeds without the
    // session-bound CSRF header, even if a controller forgot the CsrfGuard.
    assertCsrfRequest(request, auth);
    return true;
  }
}

function unauthenticated(): ApiException {
  return new ApiException(
    HttpStatus.UNAUTHORIZED,
    'UNAUTHENTICATED',
    'Authentication is required.',
  );
}
