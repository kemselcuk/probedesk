import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentAuth } from '../../src/auth/current-auth.decorator.js';
import { CsrfGuard } from '../../src/auth/csrf.guard.js';
import type { AuthContext } from '../../src/auth/auth.types.js';
import { Roles } from '../../src/auth/roles.decorator.js';
import { RolesGuard } from '../../src/auth/roles.guard.js';
import { SessionAuthGuard } from '../../src/auth/session-auth.guard.js';
import { Role } from '../../src/prisma/generated/client.js';

/**
 * Test-only protected routes. They exist only in the e2e fixture module so the
 * product API does not expose an artificial authorization endpoint.
 */
@Controller('test-auth')
@UseGuards(SessionAuthGuard, CsrfGuard)
export class AuthProbeController {
  @Get('session')
  session(@CurrentAuth() auth: AuthContext): AuthContext['user'] {
    return auth.user;
  }

  @Get('planner-only')
  @UseGuards(RolesGuard)
  @Roles(Role.PLANNER)
  plannerOnly(@CurrentAuth() auth: AuthContext): { role: string } {
    return { role: auth.user.role };
  }

  @Get('operator-only')
  @UseGuards(RolesGuard)
  @Roles(Role.OPERATOR)
  operatorOnly(@CurrentAuth() auth: AuthContext): { role: string } {
    return { role: auth.user.role };
  }

  @Get('viewer-only')
  @UseGuards(RolesGuard)
  @Roles(Role.VIEWER)
  viewerOnly(@CurrentAuth() auth: AuthContext): { role: string } {
    return { role: auth.user.role };
  }

  @Post('planner')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(Role.PLANNER)
  plannerMutation(@CurrentAuth() auth: AuthContext): { role: string } {
    return { role: auth.user.role };
  }
}
