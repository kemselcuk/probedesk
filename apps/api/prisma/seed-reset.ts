import { PrismaPg } from '@prisma/adapter-pg';
import { loadDotEnv, loadEnv } from '../src/config/env.js';
import { PrismaClient } from '../src/prisma/generated/client.js';
import { deleteDemoSeedFixture } from './seed-demo-cleanup.js';

/**
 * Explicit, guarded destructive demo reset.
 *
 * This is deliberately not part of `npm run demo:seed`. Run it only from
 * apps/api after setting PROBEDESK_DEMO_RESET=confirm, and only against the
 * documented local demo database (name `probedesk`) or a database whose name
 * ends in `_demo`. It refuses production and every other database.
 */
const RESET_CONFIRMATION = 'confirm';

loadDotEnv();

const config = loadEnv(process.env);
const databaseName = readDatabaseName(config.databaseUrl);
const confirmation = process.env.PROBEDESK_DEMO_RESET;

if (config.nodeEnv === 'production') {
  reject('Refusing to reset demo data with NODE_ENV=production.');
} else if (confirmation !== RESET_CONFIRMATION) {
  reject(
    `Refusing to reset demo data without PROBEDESK_DEMO_RESET=${RESET_CONFIRMATION}.`,
  );
} else if (!isDemoDatabaseName(databaseName)) {
  reject(
    `Refusing to reset database "${databaseName}". Use the local demo database "probedesk" or a name ending in "_demo".`,
  );
} else {
  await resetDemoData();
}

async function resetDemoData(): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: config.databaseUrl,
      application_name: 'probedesk-demo-reset',
      connectionTimeoutMillis: 2000,
    }),
  });

  try {
    const summary = await deleteDemoSeedFixture(prisma);
    console.log(
      `Demo data reset on "${databaseName}": ${summary.runs} runs, ${summary.plans} plans, ${summary.users} accounts and ${summary.profiles} device profiles deleted.`,
    );
  } catch {
    // Driver errors may contain the connection string; never print them.
    console.error(
      'Demo reset failed. Check DATABASE_URL and that migrations are applied.',
    );
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

function readDatabaseName(connectionUrl: string): string {
  return decodeURIComponent(new URL(connectionUrl).pathname)
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

function isDemoDatabaseName(name: string): boolean {
  return name === 'probedesk' || name.endsWith('_demo');
}

function reject(message: string): void {
  console.error(message);
  process.exitCode = 1;
}
