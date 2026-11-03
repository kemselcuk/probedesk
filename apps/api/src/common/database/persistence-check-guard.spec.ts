import {
  requirePersistenceCheckEnvironment,
  UnsafePersistenceCheckError,
} from './persistence-check-guard.js';

const validEnvironment = {
  NODE_ENV: 'development',
  PROBEDESK_ALLOW_PERSISTENCE_CHECK: '1',
  DATABASE_URL:
    'postgresql://probedesk:probedesk@127.0.0.1:5432/probedesk?schema=public',
  TEST_DATABASE_URL:
    'postgresql://probedesk:probedesk@localhost:5433/probedesk_test?schema=public',
};

describe('persistence check guard', () => {
  it('accepts an explicit local development opt-in', () => {
    const url = requirePersistenceCheckEnvironment(validEnvironment);

    expect(url.hostname).toBe('127.0.0.1');
    expect(url.pathname).toBe('/probedesk');
  });

  it('rejects anything other than NODE_ENV=development', () => {
    for (const NODE_ENV of ['production', 'test', undefined]) {
      expect(() =>
        requirePersistenceCheckEnvironment({
          ...validEnvironment,
          NODE_ENV,
        }),
      ).toThrowError(/NODE_ENV is not "development"/);
    }
  });

  it('requires the explicit PROBEDESK_ALLOW_PERSISTENCE_CHECK=1 opt-in', () => {
    for (const PROBEDESK_ALLOW_PERSISTENCE_CHECK of [
      undefined,
      'true',
      '0',
      '',
    ]) {
      expect(() =>
        requirePersistenceCheckEnvironment({
          ...validEnvironment,
          PROBEDESK_ALLOW_PERSISTENCE_CHECK,
        }),
      ).toThrowError(/PROBEDESK_ALLOW_PERSISTENCE_CHECK=1 is not set/);
    }
  });

  it('requires DATABASE_URL', () => {
    expect(() =>
      requirePersistenceCheckEnvironment({
        ...validEnvironment,
        DATABASE_URL: undefined,
      }),
    ).toThrowError(/DATABASE_URL is not set/);
  });

  it('rejects a DATABASE_URL that is not a PostgreSQL URL', () => {
    expect(() =>
      requirePersistenceCheckEnvironment({
        ...validEnvironment,
        DATABASE_URL: 'mysql://probedesk:secret@127.0.0.1:3306/probedesk',
      }),
    ).toThrowError(/postgres:\/\/ or postgresql:\/\//);
  });

  it('rejects a DATABASE_URL outside the local machine', () => {
    for (const DATABASE_URL of [
      'postgresql://probedesk:secret@db.example.test:5432/probedesk',
      'postgresql://probedesk:secret@192.168.1.10:5432/probedesk',
    ]) {
      try {
        requirePersistenceCheckEnvironment({
          ...validEnvironment,
          DATABASE_URL,
        });
        expect.unreachable('the guard should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(UnsafePersistenceCheckError);
        expect((error as Error).message).toContain('local database');
        expect((error as Error).message).not.toContain('secret');
        expect((error as Error).message).not.toContain('db.example.test');
      }
    }
  });

  it('requires TEST_DATABASE_URL', () => {
    expect(() =>
      requirePersistenceCheckEnvironment({
        ...validEnvironment,
        TEST_DATABASE_URL: undefined,
      }),
    ).toThrowError(/TEST_DATABASE_URL is not set/);
  });

  it('rejects a TEST_DATABASE_URL that is not a PostgreSQL URL', () => {
    expect(() =>
      requirePersistenceCheckEnvironment({
        ...validEnvironment,
        TEST_DATABASE_URL: 'not-a-url',
      }),
    ).toThrowError(/TEST_DATABASE_URL is not a valid connection URL/);
  });

  it('rejects a TEST_DATABASE_URL with the same identity as DATABASE_URL', () => {
    expect(() =>
      requirePersistenceCheckEnvironment({
        ...validEnvironment,
        TEST_DATABASE_URL:
          'postgresql://other:credentials@localhost:5432/probedesk?schema=other',
      }),
    ).toThrowError(/points at the integration-test database/);
  });
});
