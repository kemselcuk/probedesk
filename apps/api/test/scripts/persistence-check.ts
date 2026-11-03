import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaPg } from '@prisma/adapter-pg';
import { loadDotEnv } from '../../src/config/env.js';
import {
  requirePersistenceCheckEnvironment,
  UnsafePersistenceCheckError,
} from '../../src/common/database/persistence-check-guard.js';
import { PrismaClient } from '../../src/prisma/generated/client.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const code = '__persistence_check__';

function createClient(url: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: url,
      application_name: 'probedesk-persistence-check',
      connectionTimeoutMillis: 2000,
    }),
  });
}

async function findCommittedRow(url: string, id: string): Promise<boolean> {
  const client = createClient(url);

  try {
    const row = await client.deviceProfile.findUnique({ where: { code } });
    return row?.id === id;
  } finally {
    await client.$disconnect();
  }
}

loadDotEnv();

let connectionString: string;

try {
  // The guard runs before any database write or container command. It requires
  // NODE_ENV=development, an explicit opt-in, local PostgreSQL and a distinct
  // integration-test database.
  connectionString = requirePersistenceCheckEnvironment(process.env).toString();
} catch (error) {
  if (error instanceof UnsafePersistenceCheckError) {
    console.error(error.message);
    process.exit(1);
  }

  throw error;
}

const client = createClient(connectionString);
let createdId: string | undefined;

try {
  await client.deviceProfile.deleteMany({ where: { code } });

  const created = await client.deviceProfile.create({
    data: {
      code,
      name: 'Persistence check',
      description: `created ${new Date().toISOString()}`,
    },
  });
  createdId = created.id;

  console.log(`Inserted device_profiles row ${created.id}.`);
  await client.$disconnect();

  console.log(
    'Recreating the postgres container with the same named volume...',
  );
  execFileSync(
    'docker',
    [
      'compose',
      '-f',
      'compose.yaml',
      'up',
      '-d',
      '--force-recreate',
      'postgres',
    ],
    { cwd: repoRoot, stdio: 'inherit' },
  );

  const deadline = Date.now() + 60_000;
  let found = false;

  while (Date.now() < deadline) {
    try {
      if (await findCommittedRow(connectionString, created.id)) {
        found = true;
        break;
      }
    } catch {
      // The database may still be starting after container recreation.
    }

    await delay(1000);
  }

  if (!found) {
    throw new Error(
      'The persisted device_profiles row was not readable after the container restart.',
    );
  }

  console.log(
    `Row ${created.id} survived container recreation via the probedesk-postgres-data volume.`,
  );
} finally {
  if (createdId) {
    try {
      await client.deviceProfile.deleteMany({ where: { code } });
    } catch {
      // Leave cleanup to the next run if the database is still unavailable.
    }
  }

  await client.$disconnect();
}
