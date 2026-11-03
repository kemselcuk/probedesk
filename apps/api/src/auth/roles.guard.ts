import {
  HttpStatus,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ApiException } from '../common/errors/api.exception.js';
import type { Role } from '../prisma/generated/client.js';
import { ROLES_METADATA_KEY } from './roles.decorator.js';

/**
 * Applies the role matrix declared with @Roles. A missing session is 401 even
 * when this guard is used on its own; an authenticated user without one of the
 * required roles is 403. Handlers without @Roles accept any authenticated user.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(
      ROLES_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const auth = request.auth;

    if (!auth) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
        'Authentication is required.',
      );
    }

    if (!requiredRoles.includes(auth.user.role)) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'You do not have permission to perform this action.',
      );
    }

    return true;
  }
}
