import { EnvironmentValidationError, loadEnv, type AppConfig } from './env.js';

const validEnvironment = {
  NODE_ENV: 'test',
  PORT: '3100',
  DATABASE_URL:
    'postgresql://probedesk:probedesk@127.0.0.1:5432/probedesk?schema=public',
  SESSION_COOKIE_SECURE: 'false',
} satisfies Record<string, string>;

describe('loadEnv', () => {
  it('returns a typed configuration object', () => {
    const config: AppConfig = loadEnv(validEnvironment);

    expect(config).toEqual({
      nodeEnv: 'test',
      port: 3100,
      databaseUrl: validEnvironment.DATABASE_URL,
      sessionCookieSecure: false,
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('applies defaults for optional values', () => {
    const config = loadEnv({
      DATABASE_URL: validEnvironment.DATABASE_URL,
    });

    expect(config.nodeEnv).toBe('development');
    expect(config.port).toBe(3000);
    expect(config.sessionCookieSecure).toBe(false);
  });

  it('interprets SESSION_COOKIE_SECURE as a boolean', () => {
    expect(
      loadEnv({
        DATABASE_URL: validEnvironment.DATABASE_URL,
        SESSION_COOKIE_SECURE: 'true',
      }).sessionCookieSecure,
    ).toBe(true);
  });

  it('rejects a missing DATABASE_URL with a clear English message', () => {
    expect(() => loadEnv({ NODE_ENV: 'test' })).toThrowError(
      EnvironmentValidationError,
    );

    try {
      loadEnv({ NODE_ENV: 'test' });
    } catch (error) {
      expect((error as Error).message).toContain(
        'Invalid environment configuration',
      );
      expect((error as Error).message).toContain('DATABASE_URL');
      expect((error as Error).message).toContain('required');
    }
  });

  it('rejects non-PostgreSQL connection URLs without echoing credentials', () => {
    const secret = 'supersecret';
    const invalid = `mysql://probedesk:${secret}@127.0.0.1:3306/probedesk`;

    expect(() =>
      loadEnv({
        ...validEnvironment,
        DATABASE_URL: invalid,
      }),
    ).toThrowError(EnvironmentValidationError);

    try {
      loadEnv({ ...validEnvironment, DATABASE_URL: invalid });
    } catch (error) {
      expect((error as Error).message).toContain('DATABASE_URL');
      expect((error as Error).message).not.toContain(secret);
    }
  });

  it('rejects invalid numbers without echoing the supplied value', () => {
    const invalidPort = 'not-a-port';

    try {
      loadEnv({ ...validEnvironment, PORT: invalidPort });
      expect.unreachable('loadEnv should have thrown');
    } catch (error) {
      expect((error as Error).message).toContain('PORT');
      expect((error as Error).message).not.toContain(invalidPort);
    }
  });

  it('refuses production when the session cookie would not be Secure', () => {
    const productionEnvironment = {
      ...validEnvironment,
      NODE_ENV: 'production',
    };

    for (const SESSION_COOKIE_SECURE of ['false', undefined] as const) {
      const environment = { ...productionEnvironment, SESSION_COOKIE_SECURE };

      expect(() => loadEnv(environment)).toThrowError(
        EnvironmentValidationError,
      );

      try {
        loadEnv(environment);
        expect.unreachable('loadEnv should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('SESSION_COOKIE_SECURE');
        expect((error as Error).message).toContain('production');
        expect((error as Error).message).not.toContain('probedesk:probedesk');
      }
    }
  });

  it('accepts production with a Secure session cookie', () => {
    const config = loadEnv({
      NODE_ENV: 'production',
      PORT: '8443',
      DATABASE_URL:
        'postgresql://deploy:secret@db.example.test:5432/probedesk?schema=public',
      SESSION_COOKIE_SECURE: 'true',
    });

    expect(config.nodeEnv).toBe('production');
    expect(config.sessionCookieSecure).toBe(true);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() =>
      loadEnv({ ...validEnvironment, NODE_ENV: 'staging' }),
    ).toThrowError(/NODE_ENV must be one of development, test or production/);
  });
});
