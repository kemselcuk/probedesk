import {
  databaseIdentity,
  normaliseDatabaseHost,
} from './test-database-guard.js';

export interface PersistenceCheckEnvironment {
  NODE_ENV?: string | undefined;
  PROBEDESK_ALLOW_PERSISTENCE_CHECK?: string | undefined;
  DATABASE_URL?: string | undefined;
  TEST_DATABASE_URL?: string | undefined;
}

export class UnsafePersistenceCheckError extends Error {
  override readonly name = 'UnsafePersistenceCheckError';

  constructor(message: string) {
    super(message);
  }
}

function parseDatabaseUrl(value: string, name: string): URL {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new UnsafePersistenceCheckError(
      `${name} is not a valid connection URL.`,
    );
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new UnsafePersistenceCheckError(
      `${name} must use the postgres:// or postgresql:// scheme.`,
    );
  }

  if (url.pathname.length <= 1) {
    throw new UnsafePersistenceCheckError(
      `${name} must include a database name.`,
    );
  }

  return url;
}

/**
 * Guards the destructive persistence check. The script deletes and recreates a
 * `device_profiles` row and recreates the development container, so it runs
 * only for an explicit local development opt-in on a loopback database that is
 * not the integration-test database. Rejections never echo the URL.
 */
export function requirePersistenceCheckEnvironment(
  environment: PersistenceCheckEnvironment,
): URL {
  if (environment.NODE_ENV !== 'development') {
    throw new UnsafePersistenceCheckError(
      'Refusing to run the persistence check because NODE_ENV is not "development".',
    );
  }

  if (environment.PROBEDESK_ALLOW_PERSISTENCE_CHECK !== '1') {
    throw new UnsafePersistenceCheckError(
      'Refusing to run the persistence check because PROBEDESK_ALLOW_PERSISTENCE_CHECK=1 is not set.',
    );
  }

  if (!environment.DATABASE_URL) {
    throw new UnsafePersistenceCheckError(
      'Refusing to run the persistence check because DATABASE_URL is not set.',
    );
  }

  const databaseUrl = parseDatabaseUrl(environment.DATABASE_URL, 'DATABASE_URL');

  if (normaliseDatabaseHost(databaseUrl.hostname) !== 'localhost') {
    throw new UnsafePersistenceCheckError(
      'Refusing to run the persistence check because DATABASE_URL must point at a local database (localhost, 127.0.0.1 or ::1).',
    );
  }

  if (!environment.TEST_DATABASE_URL) {
    throw new UnsafePersistenceCheckError(
      'Refusing to run the persistence check because TEST_DATABASE_URL is not set.',
    );
  }

  const testUrl = parseDatabaseUrl(
    environment.TEST_DATABASE_URL,
    'TEST_DATABASE_URL',
  );

  if (
    databaseIdentity(databaseUrl.toString()) ===
    databaseIdentity(testUrl.toString())
  ) {
    throw new UnsafePersistenceCheckError(
      'Refusing to run the persistence check because DATABASE_URL points at the integration-test database.',
    );
  }

  return databaseUrl;
}
