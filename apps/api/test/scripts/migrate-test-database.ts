import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadDotEnv } from '../../src/config/env.js';
import {
  requireTestDatabaseUrl,
  UnsafeTestDatabaseError,
} from '../../src/common/database/test-database-guard.js';

const apiRoot = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const prismaCli = require.resolve('prisma/build/index.js');

loadDotEnv();
process.env.NODE_ENV = 'test';

try {
  const testUrl = requireTestDatabaseUrl(process.env);

  console.log('Applying migrations to the isolated test database.');

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
