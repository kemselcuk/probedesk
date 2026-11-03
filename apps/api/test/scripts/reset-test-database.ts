import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Client } from 'pg';
import { loadDotEnv } from '../../src/config/env.js';
import {
  requireSafeTestDatabaseReset,
  UnsafeTestDatabaseError,
} from '../../src/common/database/test-database-guard.js';

const apiRoot = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const prismaCli = require.resolve('prisma/build/index.js');

loadDotEnv();

async function resetTestSchema(connectionString: string): Promise<void> {
  const client = new Client({
    connectionString,
    application_name: 'probedesk-test-reset',
    connectionTimeoutMillis: 2000,
  });

  await client.connect();

  try {
    // The guard above has already proven that this is an isolated test
    // database. Dropping the schema also removes _prisma_migrations so the
    // following deploy replays every registered migration from scratch.
    console.log(
      'Dropping and recreating the public schema in the isolated test database.',
    );
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }
}

try {
  const testUrl = requireSafeTestDatabaseReset(process.env);

  await resetTestSchema(testUrl.toString());

  const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: apiRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: testUrl.toString(),
    },
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  process.exitCode = result.status ?? 1;
} catch (error) {
  if (error instanceof UnsafeTestDatabaseError) {
    console.error(error.message);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
