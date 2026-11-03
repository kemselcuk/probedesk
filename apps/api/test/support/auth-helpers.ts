import { randomUUID } from 'node:crypto';
import type { PrismaClient, Role } from '../../src/prisma/generated/client.js';
import { hashPassword } from '../../src/auth/password.js';

export interface TestUserOptions {
  email?: string;
  password?: string;
  role: Role;
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  role: Role;
}

export const AUTH_TEST_EMAIL_PREFIX = 'auth-e2e-';

export function uniqueAuthEmail(): string {
  return `${AUTH_TEST_EMAIL_PREFIX}${randomUUID()}@example.test`;
}

export async function createTestUser(
  prisma: PrismaClient,
  options: TestUserOptions,
): Promise<TestUser> {
  const email = options.email ?? uniqueAuthEmail();
  const password = options.password ?? 'Correct-Horse-Battery-9';
  const passwordHash = await hashPassword(password);

  const user = await prisma.user.create({
    data: { email, passwordHash, role: options.role },
  });

  return { id: user.id, email: user.email, password, role: user.role };
}

export async function deleteAuthTestUsers(
  prisma: PrismaClient,
  prefix = AUTH_TEST_EMAIL_PREFIX,
): Promise<void> {
  await prisma.session.deleteMany({
    where: { user: { email: { startsWith: prefix } } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: prefix } },
  });
}

export interface ParsedCookie {
  name: string;
  value: string;
  raw: string;
}

/**
 * Parses Set-Cookie headers without depending on Supertest internals. Node may
 * deliver one string or an array depending on the agent and HTTP version.
 */
export function readSetCookies(response: {
  headers: Record<string, unknown>;
}): ParsedCookie[] {
  const header = response.headers['set-cookie'];
  const rawCookies = Array.isArray(header)
    ? header.filter((value): value is string => typeof value === 'string')
    : typeof header === 'string'
      ? [header]
      : [];

  return rawCookies.map((raw) => {
    const [pair] = raw.split(';');
    const separator = pair ? pair.indexOf('=') : -1;
    const name = separator >= 0 ? (pair ?? '').slice(0, separator) : '';
    const encodedValue =
      separator >= 0 ? (pair ?? '').slice(separator + 1) : '';

    let value = encodedValue;
    try {
      value = decodeURIComponent(encodedValue);
    } catch {
      // Leave a malformed value untouched; callers assert on the raw header.
    }

    return { name, value, raw };
  });
}

export function getCookie(
  cookies: readonly ParsedCookie[],
  name: string,
): ParsedCookie {
  const cookie = cookies.find((candidate) => candidate.name === name);
  if (!cookie) {
    throw new Error(`Expected Set-Cookie for ${name}`);
  }

  return cookie;
}

export function cookieHeader(...cookies: readonly ParsedCookie[]): string {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}
