import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  ApiBody,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiException } from '../common/errors/api.exception.js';
import { ApiErrorDto } from '../common/openapi/api-error.dto.js';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { AuthService } from './auth.service.js';
import type { AuthContext } from './auth.types.js';
import { clearAuthCookies, setAuthCookies, setCsrfCookie } from './cookie.js';
import { CurrentAuth } from './current-auth.decorator.js';
import { AuthUserDto } from './dto/auth-user.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { LoginOriginGuard } from './login-origin.guard.js';
import { SessionAuthGuard } from './session-auth.guard.js';

@ApiTags('auth')
@ApiExtraModels(ApiErrorDto)
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @UseGuards(LoginOriginGuard)
  @ApiOperation({
    summary: 'Start a session with a demo account.',
  })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({
    description:
      'Session established. The response contains only the user summary; the raw tokens live in HttpOnly and XSRF cookies.',
    type: AuthUserDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Unknown email or wrong password. The message is generic.',
    type: ApiErrorDto,
  })
  @ApiForbiddenResponse({
    description: 'The request is not JSON or its Origin is not same-origin.',
    type: ApiErrorDto,
  })
  @ApiResponse({
    status: HttpStatus.TOO_MANY_REQUESTS,
    description: 'Too many failed attempts for this address and email.',
    type: ApiErrorDto,
  })
  async login(
    @Body() body: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthUserDto> {
    const clientAddress =
      request.ip || request.socket.remoteAddress || 'unknown';
    const result = await this.authService.login(
      body.email,
      body.password,
      clientAddress,
    );

    setAuthCookies(response, this.config.sessionCookieSecure, result);
    return result.user;
  }

  @Get('me')
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionAuthGuard)
  @ApiSecurity('session')
  @ApiOperation({
    summary: 'Return the signed-in user and renew a missing CSRF token.',
  })
  @ApiOkResponse({ type: AuthUserDto })
  @ApiUnauthorizedResponse({
    description: 'The session is missing, expired or revoked.',
    type: ApiErrorDto,
  })
  async me(
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthUserDto> {
    if (!auth.csrfTokenHash) {
      const csrfToken = await this.authService.renewCsrfToken(auth.sessionId);
      if (!csrfToken) {
        throw new ApiException(
          HttpStatus.UNAUTHORIZED,
          'UNAUTHENTICATED',
          'Authentication is required.',
        );
      }

      setCsrfCookie(
        response,
        this.config.sessionCookieSecure,
        csrfToken,
        auth.expiresAt,
      );
    }

    return auth.user;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', 'no-store')
  @ApiSecurity({ session: [], csrfToken: [] })
  @ApiHeader({
    name: 'X-XSRF-TOKEN',
    required: true,
    description:
      'Read the XSRF-TOKEN cookie and echo its value. Required when a session exists.',
  })
  @ApiOperation({
    summary: 'Revoke the server session and clear both cookies.',
  })
  @ApiNoContentResponse({
    description:
      'The session is revoked (or was already absent) and both cookies are cleared.',
  })
  @ApiForbiddenResponse({
    description: 'The session exists but its CSRF header is missing or wrong.',
    type: ApiErrorDto,
  })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authService.logout(request);
    clearAuthCookies(response, this.config.sessionCookieSecure);
  }
}
