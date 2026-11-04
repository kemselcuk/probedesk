import * as argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/prisma/generated/client.js';
import { DEMO_USERS, DEMO_USER_EMAILS } from '../prisma/seed-data.js';
import { deleteDemoSeedFixture } from '../prisma/seed-demo-cleanup.js';
import { seedDemoDeviceProfiles } from '../prisma/seed-device-profiles.js';
import { seedDemoUsers } from '../prisma/seed-users.js';

describe('demo user seed (e2e)', () => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  let prisma: PrismaClient;

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error(
        'TEST_DATABASE_URL must be set for the demo seed integration test.',
      );
    }

    prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: testDatabaseUrl,
        application_name: 'probedesk-demo-seed-e2e',
        connectionTimeoutMillis: 2000,
      }),
    });

    await deleteDemoSeedFixture(prisma);
  });

  afterAll(async () => {
    if (!prisma) {
      return;
    }

    await deleteDemoSeedFixture(prisma);
    await prisma.$disconnect();
  });

  it('creates exactly three Argon2id accounts without storing plaintext', async () => {
    const summary = await seedDemoUsers(prisma);

    expect(summary).toEqual({ created: 3, existing: 0, total: 3 });

    const users = await prisma.user.findMany({
      where: { email: { in: [...DEMO_USER_EMAILS] } },
      orderBy: { email: 'asc' },
    });
    expect(users).toHaveLength(3);

    for (const demoUser of DEMO_USERS) {
      const user = users.find(
        (candidate) => candidate.email === demoUser.email,
      );
      expect(user).toBeDefined();
      expect(user?.role).toBe(demoUser.role);
      expect(user?.passwordHash).toMatch(
        /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/,
      );
      expect(user?.passwordHash).not.toContain(demoUser.password);
      expect(await argon2.verify(user!.passwordHash, demoUser.password)).toBe(
        true,
      );
      expect(JSON.stringify(user)).not.toContain(demoUser.password);
    }

    expect(
      await prisma.session.count({
        where: { user: { email: { in: [...DEMO_USER_EMAILS] } } },
      }),
    ).toBe(0);
  });

  it('is idempotent and never updates an existing account', async () => {
    const before = await prisma.user.findMany({
      where: { email: { in: [...DEMO_USER_EMAILS] } },
      orderBy: { email: 'asc' },
    });
    expect(before).toHaveLength(3);

    const secondRun = await seedDemoUsers(prisma);
    expect(secondRun).toEqual({ created: 0, existing: 3, total: 3 });

    const after = await prisma.user.findMany({
      where: { email: { in: [...DEMO_USER_EMAILS] } },
      orderBy: { email: 'asc' },
    });
    expect(after).toEqual(before);

    const plannerEmail = 'planner@probedesk.local';
    const original = after.find((user) => user.email === plannerEmail)!;
    await prisma.user.update({
      where: { email: plannerEmail },
      data: { role: 'VIEWER', passwordHash: 'existing-operator-value' },
    });

    const thirdRun = await seedDemoUsers(prisma);
    expect(thirdRun).toEqual({ created: 0, existing: 3, total: 3 });

    const untouched = await prisma.user.findUniqueOrThrow({
      where: { email: plannerEmail },
    });
    expect(untouched.id).toBe(original.id);
    expect(untouched.role).toBe('VIEWER');
    expect(untouched.passwordHash).toBe('existing-operator-value');
  });

  it('seeds the DC Power Module profile once and never overwrites it', async () => {
    const first = await seedDemoDeviceProfiles(prisma);
    expect(first).toEqual({ created: 1, existing: 0, total: 1 });

    const profile = await prisma.deviceProfile.findUniqueOrThrow({
      where: { code: 'DC_POWER_MODULE' },
    });
    expect(profile).toMatchObject({
      code: 'DC_POWER_MODULE',
      name: 'DC Power Module',
    });

    const second = await seedDemoDeviceProfiles(prisma);
    expect(second).toEqual({ created: 0, existing: 1, total: 1 });

    await prisma.deviceProfile.update({
      where: { code: 'DC_POWER_MODULE' },
      data: { name: 'Operator edited profile', description: null },
    });

    const third = await seedDemoDeviceProfiles(prisma);
    expect(third).toEqual({ created: 0, existing: 1, total: 1 });

    const untouched = await prisma.deviceProfile.findUniqueOrThrow({
      where: { code: 'DC_POWER_MODULE' },
    });
    expect(untouched.name).toBe('Operator edited profile');
    expect(untouched.description).toBeNull();
  });
});
