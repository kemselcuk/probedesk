import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ApiException } from '../common/errors/api.exception.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedUser, AuthContext } from './auth.types.js';
import { SESSION_TTL_MS } from './auth.constants.js';
import { readSessionToken } from './cookie.js';
import { assertCsrfRequest } from './csrf.js';
import { LoginRateLimiter } from './login-rate-limiter.js';
import { verifyAgainstDummyPassword, verifyPassword } from './password.js';
import { generateOpaqueToken, hashToken } from './token.js';

export interface LoginResult {
  user: AuthenticatedUser;
  sessionToken: string;
  csrfToken: string;
  expiresAt: Date;
}

/**
 * Session lifecycle and credential checks. Controllers own cookies and HTTP
 * status codes; this service owns persistence and state transitions.
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LoginRateLimiter) private readonly rateLimiter: LoginRateLimiter,
  ) {}

  async login(
    email: string,
    password: string,
    clientAddress: string,
  ): Promise<LoginResult> {
    const rateLimitKey = `${clientAddress}|${email}`;

    if (this.rateLimiter.check(rateLimitKey).limited) {
      throw new ApiException(
        HttpStatus.TOO_MANY_REQUESTS,
        'TOO_MANY_REQUESTS',
        'Too many login attempts. Try again later.',
      );
    }

    const user = await this.prisma.user.findUnique({ where: { email } });
    const passwordMatches = user
      ? await verifyPassword(user.passwordHash, password)
      : await verifyAgainstDummyPassword(password);

    if (!user || !passwordMatches) {
      this.rateLimiter.recordFailure(rateLimitKey);
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
        'Invalid email or password.',
      );
    }

    this.rateLimiter.reset(rateLimitKey);

    const sessionToken = generateOpaqueToken();
    const csrfToken = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await this.prisma.session.create({
      data: {
        tokenHash: hashToken(sessionToken),
        csrfTokenHash: hashToken(csrfToken),
        userId: user.id,
        expiresAt,
      },
    });

    return {
      user: { id: user.id, email: user.email, role: user.role },
      sessionToken,
      csrfToken,
      expiresAt,
    };
  }

  /**
   * Resolves a raw cookie value to the server-side session. Expired and revoked
   * records are rejected; expiry is absolute and never extended here.
   */
  async findSession(token: string): Promise<AuthContext | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        user: {
          select: { id: true, email: true, role: true },
        },
      },
    });

    if (
      !session ||
      session.revokedAt !== null ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      return null;
    }

    return {
      sessionId: session.id,
      user: session.user,
      csrfTokenHash: session.csrfTokenHash,
      expiresAt: session.expiresAt,
    };
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Issues a replacement readable CSRF token when a session does not have one.
   * Returns null when the session disappeared or expired in the meantime.
   */
  async renewCsrfToken(sessionId: string): Promise<string | null> {
    const csrfToken = generateOpaqueToken();
    const result = await this.prisma.session.updateMany({
      where: {
        id: sessionId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { csrfTokenHash: hashToken(csrfToken) },
    });

    return result.count === 1 ? csrfToken : null;
  }

  /**
   * Revokes a live session when present. A missing, expired or already revoked
   * session is a successful signed-out state; a live session without a valid
   * CSRF header is rejected before anything is changed.
   */
  async logout(request: Request): Promise<void> {
    const token = readSessionToken(request);
    if (!token) {
      return;
    }

    const auth = await this.findSession(token);
    if (!auth) {
      return;
    }

    assertCsrfRequest(request, auth);
    await this.revokeSession(auth.sessionId);
  }
}
