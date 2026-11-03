import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { CsrfGuard } from './csrf.guard.js';
import { LoginOriginGuard } from './login-origin.guard.js';
import { LoginRateLimiter } from './login-rate-limiter.js';
import { RolesGuard } from './roles.guard.js';
import { SessionAuthGuard } from './session-auth.guard.js';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    LoginRateLimiter,
    LoginOriginGuard,
    SessionAuthGuard,
    CsrfGuard,
    RolesGuard,
  ],
  exports: [AuthService, SessionAuthGuard, CsrfGuard, RolesGuard],
})
export class AuthModule {}
