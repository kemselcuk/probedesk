/**
 * Guards destructive database helpers. The development URL and test URL are
 * compared by server identity and database name, ignoring credentials, query
 * parameters and common localhost spellings.
 */
export interface TestDatabaseEnvironment {
  NODE_ENV?: string | undefined;
  DATABASE_URL?: string | undefined;
  TEST_DATABASE_URL?: string | undefined;
}

export class UnsafeTestDatabaseError extends Error {
  override readonly name = 'UnsafeTestDatabaseError';

  constructor(message: string) {
    super(message);
  }
}

function parseConnectionUrl(value: string, name: string): URL {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new UnsafeTestDatabaseError(`${name} is not a valid connection URL.`);
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new UnsafeTestDatabaseError(
      `${name} must use the postgres:// or postgresql:// scheme.`,
    );
  }

  if (url.pathname.length <= 1) {
    throw new UnsafeTestDatabaseError(`${name} must include a database name.`);
  }

  return url;
}

/**
 * Normalises loopback spellings so that `127.0.0.1`, `::1` and `localhost` are
 * treated as the same database host without changing external hostnames.
 */
export function normaliseDatabaseHost(hostname: string): string {
  const host = hostname.toLowerCase();
  return host === '127.0.0.1' || host === '::1' || host === '[::1]'
    ? 'localhost'
    : host;
}

/**
 * Identifies a PostgreSQL database without credentials or connection options.
 */
export function databaseIdentity(connectionUrl: string): string {
  const url = parseConnectionUrl(connectionUrl, 'Database URL');
  const port = url.port || '5432';
  const database = decodeURIComponent(url.pathname).replace(/\/+$/, '');

  return `${normaliseDatabaseHost(url.hostname)}:${port}${database}`;
}

/**
 * Returns the test database URL only when the environment is clearly a test
 * one. Both URLs are mandatory: the development URL identifies the database
 * that must never be touched, so its absence is a rejection rather than a
 * skipped check.
 */
export function requireTestDatabaseUrl(
  environment: TestDatabaseEnvironment,
): URL {
  if (environment.NODE_ENV !== 'test') {
    throw new UnsafeTestDatabaseError(
      'Refusing to use the test database because NODE_ENV is not "test".',
    );
  }

  if (!environment.DATABASE_URL) {
    throw new UnsafeTestDatabaseError(
      'Refusing to use the test database because DATABASE_URL is not set; the development database cannot be identified.',
    );
  }

  if (!environment.TEST_DATABASE_URL) {
    throw new UnsafeTestDatabaseError(
      'Refusing to use the test database because TEST_DATABASE_URL is not set.',
    );
  }

  const databaseUrl = parseConnectionUrl(
    environment.DATABASE_URL,
    'DATABASE_URL',
  );
  const testUrl = parseConnectionUrl(
    environment.TEST_DATABASE_URL,
    'TEST_DATABASE_URL',
  );

  if (
    databaseIdentity(databaseUrl.toString()) ===
    databaseIdentity(testUrl.toString())
  ) {
    throw new UnsafeTestDatabaseError(
      'Refusing to use the test database because TEST_DATABASE_URL points at the development database.',
    );
  }

  const testDatabaseName = decodeURIComponent(testUrl.pathname)
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');

  if (!/_test$/i.test(testDatabaseName)) {
    throw new UnsafeTestDatabaseError(
      'Refusing to use the test database because the TEST_DATABASE_URL database name must end with "_test".',
    );
  }

  return testUrl;
}

/**
 * Reset helper. It uses the same mandatory checks as every other test database
 * consumer; the name is kept so destructive callers read clearly at the call
 * site.
 */
export function requireSafeTestDatabaseReset(
  environment: TestDatabaseEnvironment,
): URL {
  return requireTestDatabaseUrl(environment);
}
