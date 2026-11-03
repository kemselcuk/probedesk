import { loadDotEnv } from '../src/config/env.js';
import {
  requireTestDatabaseUrl,
  UnsafeTestDatabaseError,
} from '../src/common/database/test-database-guard.js';

loadDotEnv();
process.env.NODE_ENV = 'test';

try {
  // Point the application under test at the isolated test database. The guard
  // requires both URLs and rejects a test URL that aliases the development
  // database, so cleanup code can never target unverified data.
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
