import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Role } from '../src/prisma/generated/client.js';

interface MigrationRow {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
}

const codePrefix = 'e2e-';
const emailPrefix = 'e2e-';

describe('PostgreSQL schema and migrations (e2e)', () => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  let prisma: PrismaClient;

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error(
        'TEST_DATABASE_URL must be set for the database integration test.',
      );
    }

    prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: testDatabaseUrl,
        application_name: 'probedesk-e2e',
        connectionTimeoutMillis: 2000,
      }),
    });

    await prisma.session.deleteMany({
      where: { user: { email: { startsWith: emailPrefix } } },
    });
    await prisma.user.deleteMany({
      where: { email: { startsWith: emailPrefix } },
    });
    await prisma.deviceProfile.deleteMany({
      where: { code: { startsWith: codePrefix } },
    });
  });

  afterAll(async () => {
    if (!prisma) {
      return;
    }

    await prisma.session.deleteMany({
      where: { user: { email: { startsWith: emailPrefix } } },
    });
    await prisma.user.deleteMany({
      where: { email: { startsWith: emailPrefix } },
    });
    await prisma.deviceProfile.deleteMany({
      where: { code: { startsWith: codePrefix } },
    });
    await prisma.$disconnect();
  });

  it('has applied the registered migration without failures', async () => {
    const migrations = await prisma.$queryRaw<MigrationRow[]>`
      SELECT migration_name, finished_at, rolled_back_at
      FROM "_prisma_migrations"
      ORDER BY started_at
    `;

    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations.every((row) => row.finished_at !== null)).toBe(true);
    expect(migrations.every((row) => row.rolled_back_at === null)).toBe(true);
    expect(migrations.map((row) => row.migration_name)).toContain(
      '20261103120000_init',
    );
  });

  it('persists a device profile across independent connections', async () => {
    const suffix = randomUUID();
    const code = `${codePrefix}${suffix}`;

    const created = await prisma.deviceProfile.create({
      data: {
        code,
        name: 'E2E Device',
        description: 'Integration smoke record',
      },
    });

    await prisma.$disconnect();

    prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: testDatabaseUrl,
        application_name: 'probedesk-e2e-reconnect',
        connectionTimeoutMillis: 2000,
      }),
    });

    const reloaded = await prisma.deviceProfile.findUnique({ where: { code } });
    expect(reloaded).toMatchObject({
      id: created.id,
      code,
      name: 'E2E Device',
    });
  });

  it('enforces unique device profile codes', async () => {
    const code = `${codePrefix}${randomUUID()}`;
    await prisma.deviceProfile.create({
      data: { code, name: 'Unique Device' },
    });

    try {
      await prisma.deviceProfile.create({
        data: { code, name: 'Duplicate Device' },
      });
      expect.unreachable(
        'the duplicate device profile code should be rejected',
      );
    } catch (error) {
      expect(readPrismaErrorCode(error)).toBe('P2002');
    }
  });

  it('enforces unique user emails and the role enum', async () => {
    const email = `${emailPrefix}${randomUUID()}@example.test`;
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: 'test-hash',
        role: Role.PLANNER,
      },
    });

    expect(user.role).toBe('PLANNER');

    try {
      await prisma.user.create({
        data: {
          email,
          passwordHash: 'another-test-hash',
          role: Role.VIEWER,
        },
      });
      expect.unreachable('the duplicate email should be rejected');
    } catch (error) {
      expect(readPrismaErrorCode(error)).toBe('P2002');
    }
  });

  it('rejects a session for a missing user and restricts user deletion', async () => {
    try {
      await prisma.session.create({
        data: {
          tokenHash: `missing-user-${randomUUID()}`,
          csrfTokenHash: 'csrf-hash',
          expiresAt: new Date(Date.now() + 60_000),
          userId: randomUUID(),
        },
      });
      expect.unreachable('the missing user foreign key should be rejected');
    } catch (error) {
      expect(readPrismaErrorCode(error)).toBe('P2003');
    }

    const email = `${emailPrefix}${randomUUID()}@example.test`;
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: 'test-hash',
        role: Role.OPERATOR,
      },
    });

    await prisma.session.create({
      data: {
        tokenHash: `valid-${randomUUID()}`,
        csrfTokenHash: 'csrf-hash',
        expiresAt: new Date(Date.now() + 60_000),
        userId: user.id,
      },
    });

    try {
      await prisma.user.delete({ where: { id: user.id } });
      expect.unreachable('deleting a user with sessions should be restricted');
    } catch (error) {
      expect(readPrismaErrorCode(error)).toBe('P2003');
    }
  });
});

function readPrismaErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }

  return undefined;
}
