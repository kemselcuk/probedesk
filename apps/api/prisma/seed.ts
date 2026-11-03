import { PrismaPg } from '@prisma/adapter-pg';
import { loadDotEnv, loadEnv } from '../src/config/env.js';
import { PrismaClient } from '../src/prisma/generated/client.js';
import { seedDemoUsers } from './seed-users.js';
import { seedDemoDeviceProfiles } from './seed-device-profiles.js';

/**
 * Demo account seed. Run from apps/api with `npm run demo:seed`. It is additive
 * and idempotent; it never resets plans, runs or existing users.
 */
loadDotEnv();

const config = loadEnv(process.env);

if (config.nodeEnv === 'production') {
  console.error(
    'Refusing to seed demo accounts with NODE_ENV=production. The documented demo passwords are for local use only.',
  );
  process.exitCode = 1;
} else {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: config.databaseUrl,
      application_name: 'probedesk-demo-seed',
      connectionTimeoutMillis: 2000,
    }),
  });

  try {
    const summary = await seedDemoUsers(prisma);
    console.log(
      `Demo users ready: ${summary.total} accounts (${summary.created} created, ${summary.existing} already present).`,
    );

    const profiles = await seedDemoDeviceProfiles(prisma);
    console.log(
      `Demo device profiles ready: ${profiles.total} profiles (${profiles.created} created, ${profiles.existing} already present).`,
    );
  } catch {
    // Never print driver errors: they can contain the connection string.
    console.error(
      'Demo seed failed. Check DATABASE_URL and apply migrations before retrying.',
    );
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
