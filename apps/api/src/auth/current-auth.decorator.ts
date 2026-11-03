import {
  HttpStatus,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiException } from '../common/errors/api.exception.js';
import type { AuthContext } from './auth.types.js';

/** Injects the session attached by SessionAuthGuard. */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthContext => {
    const request = context.switchToHttp().getRequest<Request>();
    if (!request.auth) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
        'Authentication is required.',
      );
    }

    return request.auth;
  },
);
