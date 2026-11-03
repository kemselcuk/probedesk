import {
  databaseIdentity,
  requireSafeTestDatabaseReset,
  requireTestDatabaseUrl,
  UnsafeTestDatabaseError,
} from './test-database-guard.js';

const developmentUrl =
  'postgresql://probedesk:probedesk@localhost:5432/probedesk?schema=public';
const testUrl =
  'postgresql://probedesk:probedesk@127.0.0.1:5433/probedesk_test?schema=public';

describe('test database guard', () => {
  it('accepts a distinct test database in a test environment', () => {
    const url = requireSafeTestDatabaseReset({
      NODE_ENV: 'test',
      DATABASE_URL: developmentUrl,
      TEST_DATABASE_URL: testUrl,
    });

    expect(url.port).toBe('5433');
    expect(url.pathname).toBe('/probedesk_test');
  });

  it('rejects destructive use outside NODE_ENV=test', () => {
    expect(() =>
      requireSafeTestDatabaseReset({
        NODE_ENV: 'development',
        DATABASE_URL: developmentUrl,
        TEST_DATABASE_URL: testUrl,
      }),
    ).toThrowError(/NODE_ENV is not "test"/);
  });

  it('rejects a missing TEST_DATABASE_URL', () => {
    expect(() =>
      requireSafeTestDatabaseReset({
        NODE_ENV: 'test',
        DATABASE_URL: developmentUrl,
      }),
    ).toThrowError(/TEST_DATABASE_URL is not set/);
  });

  it('rejects a reset when the development URL is unknown', () => {
    expect(() =>
      requireSafeTestDatabaseReset({
        NODE_ENV: 'test',
        TEST_DATABASE_URL: testUrl,
      }),
    ).toThrowError(/DATABASE_URL is not set/);
  });

  it('rejects a non-reset test consumer when the development URL is unknown', () => {
    expect(() =>
      requireTestDatabaseUrl({
        NODE_ENV: 'test',
        TEST_DATABASE_URL: testUrl,
      }),
    ).toThrowError(/DATABASE_URL is not set/);
  });

  it('rejects a test URL that aliases the development database through the non-reset entry point', () => {
    expect(() =>
      requireTestDatabaseUrl({
        NODE_ENV: 'test',
        DATABASE_URL: developmentUrl,
        TEST_DATABASE_URL:
          'postgresql://someone:else@127.0.0.1:5432/probedesk?schema=public',
      }),
    ).toThrowError(/points at the development database/);
  });

  it('rejects the same database even when localhost spellings differ', () => {
    expect(() =>
      requireSafeTestDatabaseReset({
        NODE_ENV: 'test',
        DATABASE_URL: developmentUrl,
        TEST_DATABASE_URL:
          'postgresql://other:credentials@127.0.0.1:5432/probedesk?schema=other',
      }),
    ).toThrowError(/points at the development database/);
  });

  it('rejects a test URL that only differs by credential or schema', () => {
    expect(() =>
      requireSafeTestDatabaseReset({
        NODE_ENV: 'test',
        DATABASE_URL: developmentUrl,
        TEST_DATABASE_URL:
          'postgresql://someone:else@localhost:5432/probedesk?schema=other',
      }),
    ).toThrowError(/points at the development database/);
  });

  it('rejects malformed test URLs', () => {
    expect(() =>
      requireTestDatabaseUrl({
        NODE_ENV: 'test',
        DATABASE_URL: developmentUrl,
        TEST_DATABASE_URL: 'not-a-url',
      }),
    ).toThrowError(UnsafeTestDatabaseError);
  });

  it('normalises database identity without credentials', () => {
    expect(databaseIdentity(developmentUrl)).toBe('localhost:5432/probedesk');
  });
});
