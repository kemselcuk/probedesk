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

function normaliseHost(hostname: string): string {
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

  return `${normaliseHost(url.hostname)}:${port}${database}`;
}

/**
 * Returns the test database URL when the environment is clearly a test one.
 * Used by migration helpers that must never target the development database.
 */
export function requireTestDatabaseUrl(
  environment: TestDatabaseEnvironment,
): URL {
  if (environment.NODE_ENV !== 'test') {
    throw new UnsafeTestDatabaseError(
      'Refusing to use the test database because NODE_ENV is not "test".',
    );
  }

  if (!environment.TEST_DATABASE_URL) {
    throw new UnsafeTestDatabaseError(
      'Refusing to use the test database because TEST_DATABASE_URL is not set.',
    );
  }

  const testUrl = parseConnectionUrl(
    environment.TEST_DATABASE_URL,
    'TEST_DATABASE_URL',
  );

  if (
    environment.DATABASE_URL &&
    databaseIdentity(environment.DATABASE_URL) ===
      databaseIdentity(testUrl.toString())
  ) {
    throw new UnsafeTestDatabaseError(
      'Refusing to use the test database because TEST_DATABASE_URL points at the development database.',
    );
  }

  return testUrl;
}

/**
 * Stricter variant for `prisma migrate reset`. The development URL must be
 * present so that the distinct-database check can actually be performed.
 */
export function requireSafeTestDatabaseReset(
  environment: TestDatabaseEnvironment,
): URL {
  if (!environment.DATABASE_URL) {
    throw new UnsafeTestDatabaseError(
      'Refusing to reset the test database because DATABASE_URL is not set; the development database cannot be identified.',
    );
  }

  return requireTestDatabaseUrl(environment);
}
