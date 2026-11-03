import { loadDotEnv } from '../src/config/env.js';
import {
  requireTestDatabaseUrl,
  UnsafeTestDatabaseError,
} from '../src/common/database/test-database-guard.js';

loadDotEnv();
process.env.NODE_ENV = 'test';

try {
  // Point the application under test at the isolated test database. The guard
  // also rejects a TEST_DATABASE_URL that aliases the development database.
  const testUrl = requireTestDatabaseUrl(process.env);
  process.env.DATABASE_URL = testUrl.toString();
} catch (error) {
  if (error instanceof UnsafeTestDatabaseError) {
    throw new Error(
      `API end-to-end tests require an isolated test database. ${error.message}`,
    );
  }

  throw error;
}
