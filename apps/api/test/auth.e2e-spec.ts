import { Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AuthModule } from '../src/auth/auth.module.js';
import {
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
} from '../src/auth/auth.constants.js';
import { generateOpaqueToken, hashToken } from '../src/auth/token.js';
import { configureApp } from '../src/common/bootstrap/configure-app.js';
import { APP_CONFIG, loadEnv } from '../src/config/env.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { Role } from '../src/prisma/generated/client.js';
import { AuthProbeController } from './fixtures/auth-probe.controller.js';
import { createTestApplication } from './support/create-test-application.js';
import {
  cookieHeader,
  createTestUser,
  deleteAuthTestUsers,
  getCookie,
  readSetCookies,
  uniqueAuthEmail,
  type TestUser,
} from './support/auth-helpers.js';

@Module({
  imports: [AppModule, AuthModule],
  controllers: [AuthProbeController],
})
class AuthProbeModule {}

function withoutRequestId(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const { requestId: _requestId, ...rest } = body;
  return rest;
}

describe('authentication and authorization (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const server = () => app.getHttpServer();

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AuthProbeModule],
    })
      .overrideProvider(APP_CONFIG)
      .useValue(loadEnv(process.env))
      .compile();

    app = moduleFixture.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    await deleteAuthTestUsers(prisma);
  });

  afterAll(async () => {
    if (prisma) {
      await deleteAuthTestUsers(prisma);
    }
    if (app) {
      await app.close();
    }
  });

  async function login(
    agent: request.Agent,
    user: Pick<TestUser, 'email' | 'password'>,
  ): Promise<request.Response> {
    return agent
      .post('/api/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(200);
  }

  function loginWithPassword(email: string, password: string): request.Test {
    return request(server())
      .post('/api/auth/login')
      .set('Host', 'probedesk.local')
      .set('Origin', 'http://probedesk.local')
      .send({ email, password });
  }

  async function createSession(
    userId: string,
    options: {
      expiresAt?: Date;
      revokedAt?: Date | null;
      csrfTokenHash?: null;
    } = {},
  ): Promise<{ token: string; csrfToken: string | null }> {
    const token = generateOpaqueToken();
    const csrfToken =
      options.csrfTokenHash === null ? null : generateOpaqueToken();

    await prisma.session.create({
      data: {
        tokenHash: hashToken(token),
        csrfTokenHash: csrfToken ? hashToken(csrfToken) : null,
        userId,
        expiresAt: options.expiresAt ?? new Date(Date.now() + SESSION_TTL_MS),
        revokedAt: options.revokedAt ?? null,
      },
    });

    return { token, csrfToken };
  }

  it('creates an eight-hour session with hardened cookies and only the user summary', async () => {
    const user = await createTestUser(prisma, { role: Role.PLANNER });

    const response = await loginWithPassword(user.email, user.password);

    expect(response.body).toEqual({
      id: user.id,
      email: user.email,
      role: 'PLANNER',
    });
    expect(Object.keys(response.body).sort()).toEqual(['email', 'id', 'role']);
    expect(response.headers['cache-control']).toBe('no-store');

    const cookies = readSetCookies(response);
    const sessionCookie = getCookie(cookies, SESSION_COOKIE_NAME);
    const csrfCookie = getCookie(cookies, CSRF_COOKIE_NAME);

    expect(sessionCookie.raw).toContain('HttpOnly');
    expect(sessionCookie.raw).toContain('SameSite=Lax');
    expect(sessionCookie.raw).toContain('Path=/');
    expect(sessionCookie.raw).toContain('Max-Age=28800');
    expect(sessionCookie.raw).not.toMatch(/;\s*Secure/i);
    expect(Buffer.from(sessionCookie.value, 'base64url')).toHaveLength(32);

    expect(csrfCookie.raw).not.toContain('HttpOnly');
    expect(csrfCookie.raw).toContain('SameSite=Lax');
    expect(csrfCookie.raw).toContain('Path=/');
    expect(Buffer.from(csrfCookie.value, 'base64url')).toHaveLength(32);

    const storedUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(storedUser.passwordHash).toMatch(
      /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/,
    );
    expect(storedUser.passwordHash).not.toContain(user.password);
    expect(await argon2.verify(storedUser.passwordHash, user.password)).toBe(
      true,
    );

    const sessions = await prisma.session.findMany({
      where: { userId: user.id },
    });
    expect(sessions).toHaveLength(1);
    const session = sessions[0]!;
    expect(session.tokenHash).toBe(hashToken(sessionCookie.value));
    expect(session.tokenHash).not.toBe(sessionCookie.value);
    expect(session.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(session.csrfTokenHash).toBe(hashToken(csrfCookie.value));
    expect(session.csrfTokenHash).not.toBe(csrfCookie.value);
    expect(
      Math.abs(session.expiresAt.getTime() - (Date.now() + SESSION_TTL_MS)),
    ).toBeLessThan(5_000);

    const me = await request(server())
      .get('/api/auth/me')
      .set('Cookie', cookieHeader(sessionCookie))
      .expect(200);

    expect(me.body).toEqual(response.body);
    expect(me.headers['cache-control']).toBe('no-store');

    const reloadedSession = await prisma.session.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(reloadedSession.expiresAt).toEqual(session.expiresAt);

    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toContain(sessionCookie.value);
    expect(serialised).not.toContain(csrfCookie.value);
  });

  it('uses the same generic failure for an unknown email and a wrong password', async () => {
    const user = await createTestUser(prisma, { role: Role.OPERATOR });
    const unknownEmail = uniqueAuthEmail();

    const wrongPassword = await loginWithPassword(
      user.email,
      'definitely-wrong',
    ).expect(401);
    const unknownUser = await loginWithPassword(
      unknownEmail,
      'definitely-wrong',
    ).expect(401);

    for (const response of [wrongPassword, unknownUser]) {
      expect(response.body).toMatchObject({
        code: 'UNAUTHENTICATED',
        message: 'Invalid email or password.',
      });
      expect(Object.keys(response.body).sort()).toEqual([
        'code',
        'message',
        'requestId',
      ]);
      expect(response.headers['set-cookie']).toBeUndefined();
    }

    expect(withoutRequestId(unknownUser.body)).toEqual(
      withoutRequestId(wrongPassword.body),
    );

    const serialised = `${JSON.stringify(wrongPassword.body)} ${JSON.stringify(unknownUser.body)}`;
    expect(serialised).not.toContain(user.email);
    expect(serialised).not.toContain(unknownEmail);
    expect(serialised).not.toContain('definitely-wrong');
  });

  it('rejects missing, expired, revoked and unknown sessions with 401', async () => {
    const user = await createTestUser(prisma, { role: Role.PLANNER });
    const expired = await createSession(user.id, {
      expiresAt: new Date(Date.now() - 1_000),
    });
    const revoked = await createSession(user.id, {
      revokedAt: new Date(Date.now() - 1_000),
    });
    const unknownToken = generateOpaqueToken();

    const cases = [
      undefined,
      expired.token,
      revoked.token,
      unknownToken,
    ] as const;

    for (const token of cases) {
      const requestBuilder = request(server()).get('/api/auth/me');
      if (token) {
        requestBuilder.set('Cookie', `${SESSION_COOKIE_NAME}=${token}`);
      }

      const response = await requestBuilder.expect(401);
      expect(response.body).toMatchObject({
        code: 'UNAUTHENTICATED',
        message: 'Authentication is required.',
      });
      expect(response.headers['set-cookie']).toBeUndefined();
    }
  });

  it('renews a missing CSRF token on /me with a readable cookie', async () => {
    const user = await createTestUser(prisma, { role: Role.VIEWER });
    const session = await createSession(user.id, { csrfTokenHash: null });

    const response = await request(server())
      .get('/api/auth/me')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${session.token}`)
      .expect(200);

    expect(response.body).toMatchObject({
      id: user.id,
      email: user.email,
      role: 'VIEWER',
    });

    const cookies = readSetCookies(response);
    const csrfCookie = getCookie(cookies, CSRF_COOKIE_NAME);
    expect(csrfCookie.raw).not.toContain('HttpOnly');
    expect(csrfCookie.raw).toContain('SameSite=Lax');
    expect(Buffer.from(csrfCookie.value, 'base64url')).toHaveLength(32);

    const stored = await prisma.session.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(stored.csrfTokenHash).toBe(hashToken(csrfCookie.value));

    const secondResponse = await request(server())
      .get('/api/auth/me')
      .set(
        'Cookie',
        cookieHeader(
          {
            name: SESSION_COOKIE_NAME,
            value: session.token,
            raw: '',
          },
          csrfCookie,
        ),
      )
      .expect(200);

    expect(secondResponse.headers['set-cookie']).toBeUndefined();
  });

  it('restores a lost or mismatched CSRF cookie for an existing session', async () => {
    const user = await createTestUser(prisma, { role: Role.PLANNER });
    const loginResponse = await loginWithPassword(
      user.email,
      user.password,
    ).expect(200);
    const loginCookies = readSetCookies(loginResponse);
    const sessionCookie = getCookie(loginCookies, SESSION_COOKIE_NAME);
    const originalCsrf = getCookie(loginCookies, CSRF_COOKIE_NAME);

    const restored = await request(server())
      .get('/api/auth/me')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${sessionCookie.value}`)
      .expect(200);

    const restoredCookies = readSetCookies(restored);
    const newCsrf = getCookie(restoredCookies, CSRF_COOKIE_NAME);
    expect(newCsrf.value).not.toBe(originalCsrf.value);
    expect(newCsrf.raw).not.toContain('HttpOnly');

    // The replaced token is no longer accepted...
    await request(server())
      .post('/api/test-auth/planner')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${sessionCookie.value}`)
      .set('X-XSRF-TOKEN', originalCsrf.value)
      .expect(403);

    // ...while the newly issued cookie matches the stored hash.
    await request(server())
      .post('/api/test-auth/planner')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${sessionCookie.value}`)
      .set('X-XSRF-TOKEN', newCsrf.value)
      .expect(200);

    const again = await request(server())
      .get('/api/auth/me')
      .set(
        'Cookie',
        cookieHeader(
          {
            name: SESSION_COOKIE_NAME,
            value: sessionCookie.value,
            raw: '',
          },
          newCsrf,
        ),
      )
      .expect(200);
    expect(again.headers['set-cookie']).toBeUndefined();
  });

  it('revokes the session and clears both cookies on logout', async () => {
    const user = await createTestUser(prisma, { role: Role.OPERATOR });
    const agent = request.agent(server());
    const loginResponse = await login(agent, user);
    const loginCookies = readSetCookies(loginResponse);
    const sessionCookie = getCookie(loginCookies, SESSION_COOKIE_NAME);
    const csrfCookie = getCookie(loginCookies, CSRF_COOKIE_NAME);

    const missingCsrf = await agent.post('/api/auth/logout').expect(403);
    expect(missingCsrf.body.code).toBe('FORBIDDEN');

    await agent.get('/api/auth/me').expect(200);

    const wrongCsrf = await agent
      .post('/api/auth/logout')
      .set('X-XSRF-TOKEN', 'wrong-token')
      .expect(403);
    expect(wrongCsrf.body.code).toBe('FORBIDDEN');

    const logout = await agent
      .post('/api/auth/logout')
      .set('X-XSRF-TOKEN', csrfCookie.value)
      .expect(204);

    expect(logout.text).toBe('');
    const clearedCookies = readSetCookies(logout);
    for (const name of [SESSION_COOKIE_NAME, CSRF_COOKIE_NAME]) {
      const cleared = getCookie(clearedCookies, name);
      expect(cleared.raw).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/);
    }

    const stored = await prisma.session.findUniqueOrThrow({
      where: { tokenHash: hashToken(sessionCookie.value) },
    });
    expect(stored.revokedAt).not.toBeNull();

    await request(server())
      .get('/api/auth/me')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${sessionCookie.value}`)
      .expect(401);

    // A second logout with no cookies is a successful signed-out state.
    const idempotentLogout = await request(server())
      .post('/api/auth/logout')
      .expect(204);
    expect(
      readSetCookies(idempotentLogout)
        .map((cookie) => cookie.name)
        .sort(),
    ).toEqual([CSRF_COOKIE_NAME, SESSION_COOKIE_NAME].sort());
  });

  it('requires a session-bound CSRF header on authenticated mutations', async () => {
    const user = await createTestUser(prisma, { role: Role.PLANNER });
    const agentA = request.agent(server());
    const agentB = request.agent(server());

    const loginA = await login(agentA, user);
    const loginB = await login(agentB, user);
    const csrfA = getCookie(readSetCookies(loginA), CSRF_COOKIE_NAME);
    const csrfB = getCookie(readSetCookies(loginB), CSRF_COOKIE_NAME);
    const sessionA = getCookie(readSetCookies(loginA), SESSION_COOKIE_NAME);

    await agentA.get('/api/test-auth/session').expect(200);

    const missing = await agentA.post('/api/test-auth/planner').expect(403);
    expect(missing.body).toMatchObject({ code: 'FORBIDDEN' });

    const wrong = await agentA
      .post('/api/test-auth/planner')
      .set('X-XSRF-TOKEN', 'not-the-token')
      .expect(403);
    expect(wrong.body.code).toBe('FORBIDDEN');

    await agentA
      .post('/api/test-auth/planner')
      .set('X-XSRF-TOKEN', csrfA.value)
      .expect(200);

    // A token from another session of the same user must not work.
    const crossSession = await request(server())
      .post('/api/test-auth/planner')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${sessionA.value}`)
      .set('X-XSRF-TOKEN', csrfB.value)
      .expect(403);
    expect(crossSession.body.code).toBe('FORBIDDEN');

    await request(server())
      .post('/api/test-auth/planner')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${sessionA.value}`)
      .set('X-XSRF-TOKEN', csrfA.value)
      .expect(200);

    // Safe methods do not require the header.
    await request(server())
      .get('/api/test-auth/planner-only')
      .set('Cookie', cookieHeader(sessionA))
      .expect(200)
      .expect({ role: 'PLANNER' });
  });

  it('enforces the role matrix and distinguishes 401 from 403', async () => {
    const planner = await createTestUser(prisma, { role: Role.PLANNER });
    const operator = await createTestUser(prisma, { role: Role.OPERATOR });
    const viewer = await createTestUser(prisma, { role: Role.VIEWER });

    const plannerAgent = request.agent(server());
    const operatorAgent = request.agent(server());
    const viewerAgent = request.agent(server());

    await login(plannerAgent, planner);
    await login(operatorAgent, operator);
    await login(viewerAgent, viewer);

    await plannerAgent.get('/api/test-auth/session').expect(200);
    await operatorAgent.get('/api/test-auth/session').expect(200);
    await viewerAgent.get('/api/test-auth/session').expect(200);

    await plannerAgent
      .get('/api/test-auth/planner-only')
      .expect(200)
      .expect({ role: 'PLANNER' });
    await plannerAgent.get('/api/test-auth/operator-only').expect(403);
    await plannerAgent.get('/api/test-auth/viewer-only').expect(403);

    await operatorAgent.get('/api/test-auth/planner-only').expect(403);
    await operatorAgent
      .get('/api/test-auth/operator-only')
      .expect(200)
      .expect({ role: 'OPERATOR' });
    await operatorAgent.get('/api/test-auth/viewer-only').expect(403);

    await viewerAgent.get('/api/test-auth/planner-only').expect(403);
    await viewerAgent.get('/api/test-auth/operator-only').expect(403);
    await viewerAgent
      .get('/api/test-auth/viewer-only')
      .expect(200)
      .expect({ role: 'VIEWER' });

    const forbidden = await viewerAgent
      .get('/api/test-auth/planner-only')
      .expect(403);
    expect(forbidden.body).toMatchObject({
      code: 'FORBIDDEN',
      message: 'You do not have permission to perform this action.',
    });

    const missing = await request(server())
      .get('/api/test-auth/planner-only')
      .expect(401);
    expect(missing.body.code).toBe('UNAUTHENTICATED');

    const noSession = await request(server())
      .get('/api/test-auth/session')
      .expect(401);
    expect(noSession.body).toMatchObject({
      code: 'UNAUTHENTICATED',
      message: 'Authentication is required.',
    });
  });

  it('rate limits repeated failures per IP and email without revealing accounts', async () => {
    const known = await createTestUser(prisma, { role: Role.VIEWER });
    const unknownEmail = uniqueAuthEmail();

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await loginWithPassword(unknownEmail, 'wrong-password').expect(401);
    }

    const unknownBlocked = await loginWithPassword(
      unknownEmail,
      'wrong-password',
    ).expect(429);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await loginWithPassword(known.email, 'wrong-password').expect(401);
    }

    const knownBlocked = await loginWithPassword(
      known.email,
      known.password,
    ).expect(429);

    for (const response of [unknownBlocked, knownBlocked]) {
      expect(response.body).toMatchObject({
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many login attempts. Try again later.',
      });
      expect(response.headers['set-cookie']).toBeUndefined();

      const retryAfter = Number(response.headers['retry-after']);
      expect(Number.isInteger(retryAfter)).toBe(true);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(15 * 60);
    }

    expect(withoutRequestId(unknownBlocked.body)).toEqual(
      withoutRequestId(knownBlocked.body),
    );

    const serialised = `${JSON.stringify(unknownBlocked.body)} ${JSON.stringify(knownBlocked.body)}`;
    expect(serialised).not.toContain(known.email);
    expect(serialised).not.toContain(unknownEmail);
  });

  it('throttles many different emails from one address and returns Retry-After', async () => {
    const isolatedApp = await createTestApplication();

    try {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        await request(isolatedApp.getHttpServer())
          .post('/api/auth/login')
          .send({ email: uniqueAuthEmail(), password: 'wrong-password' })
          .expect(401);
      }

      const blocked = await request(isolatedApp.getHttpServer())
        .post('/api/auth/login')
        .send({ email: uniqueAuthEmail(), password: 'wrong-password' })
        .expect(429);

      expect(blocked.body).toMatchObject({
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many login attempts. Try again later.',
      });

      const retryAfter = Number(blocked.headers['retry-after']);
      expect(Number.isInteger(retryAfter)).toBe(true);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(15 * 60);
    } finally {
      await isolatedApp.close();
    }
  });

  it('rejects unknown login fields and keeps login JSON-only and same-origin', async () => {
    const user = await createTestUser(prisma, { role: Role.PLANNER });

    const unknownField = await request(server())
      .post('/api/auth/login')
      .send({
        email: user.email,
        password: user.password,
        role: 'PLANNER',
      })
      .expect(400);

    expect(unknownField.body.code).toBe('VALIDATION_ERROR');
    expect(unknownField.body.fieldErrors).toContainEqual(
      expect.objectContaining({ path: 'role', code: 'UNKNOWN_FIELD' }),
    );
    expect(unknownField.headers['set-cookie']).toBeUndefined();

    const nonJson = await request(server())
      .post('/api/auth/login')
      .set('Content-Type', 'text/plain')
      .send(`email=${user.email}`)
      .expect(400);
    expect(nonJson.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Content-Type must be application/json.',
    });

    const crossOrigin = await request(server())
      .post('/api/auth/login')
      .set('Host', 'probedesk.local')
      .set('Origin', 'https://evil.example')
      .send({ email: user.email, password: user.password })
      .expect(403);
    expect(crossOrigin.body.code).toBe('FORBIDDEN');
    expect(crossOrigin.headers['set-cookie']).toBeUndefined();

    const nullOrigin = await request(server())
      .post('/api/auth/login')
      .set('Origin', 'null')
      .send({ email: user.email, password: user.password })
      .expect(403);
    expect(nullOrigin.body.code).toBe('FORBIDDEN');

    const sameOrigin = await request(server())
      .post('/api/auth/login')
      .set('Host', 'probedesk.local')
      .set('Origin', 'http://probedesk.local')
      .send({ email: user.email, password: user.password })
      .expect(200);
    expect(sameOrigin.body).toMatchObject({ id: user.id, role: 'PLANNER' });
  });

  it('marks cookies Secure when SESSION_COOKIE_SECURE is enabled', async () => {
    const user = await createTestUser(prisma, { role: Role.VIEWER });
    const secureApp = await createTestApplication({
      sessionCookieSecure: true,
    });

    try {
      const response = await request(secureApp.getHttpServer())
        .post('/api/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(200);

      const cookies = readSetCookies(response);
      expect(getCookie(cookies, SESSION_COOKIE_NAME).raw).toContain('Secure');
      expect(getCookie(cookies, CSRF_COOKIE_NAME).raw).toContain('Secure');
    } finally {
      await secureApp.close();
    }
  });
});
