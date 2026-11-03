import type { PrismaClient } from '../src/prisma/generated/client.js';
import { hashPassword } from '../src/auth/password.js';
import { DEMO_USERS } from './seed-data.js';

export interface DemoSeedSummary {
  created: number;
  existing: number;
  total: number;
}

/**
 * Creates the three pre-provisioned accounts only when their email is absent.
 * Existing rows are never updated, so re-running the seed cannot silently change
 * a role or password that an operator has modified.
 */
export async function seedDemoUsers(
  prisma: PrismaClient,
): Promise<DemoSeedSummary> {
  const emails = DEMO_USERS.map((user) => user.email);
  const existingUsers = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { email: true },
  });
  const existingEmails = new Set(existingUsers.map((user) => user.email));

  let created = 0;

  for (const demoUser of DEMO_USERS) {
    if (existingEmails.has(demoUser.email)) {
      continue;
    }

    const passwordHash = await hashPassword(demoUser.password);

    try {
      await prisma.user.create({
        data: {
          email: demoUser.email,
          passwordHash,
          role: demoUser.role,
        },
      });
      created += 1;
    } catch (error) {
      // A concurrent seed may have inserted the same email first. Treat that as
      // an existing account instead of overwriting it.
      if (!isUniqueConstraintViolation(error)) {
        throw error;
      }
    }
  }

  return {
    created,
    existing: DEMO_USERS.length - created,
    total: DEMO_USERS.length,
  };
}

function isUniqueConstraintViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }

  return (error as { code?: unknown }).code === 'P2002';
}
