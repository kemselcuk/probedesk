import { Global, Module } from '@nestjs/common';
import { config as loadDotEnvFile } from 'dotenv';
import { z } from 'zod';

/**
 * Loads a workspace or repository-root .env file without overriding values that
 * are already present in the process environment. Tests can set
 * PROBEDESK_SKIP_DOTENV=1 to exercise startup validation without local files.
 */
export function loadDotEnv(): void {
  if (process.env.PROBEDESK_SKIP_DOTENV === '1') {
    return;
  }

  loadDotEnvFile({
    path: ['.env', '../../.env'],
    quiet: true,
  });
}

const booleanStringSchema = z
  .enum(['true', 'false'], {
    error: 'SESSION_COOKIE_SECURE must be "true" or "false".',
  })
  .default('false')
  .transform((value) => value === 'true');

function isPostgresConnectionString(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'postgres:' || url.protocol === 'postgresql:') &&
      url.pathname.length > 1
    );
  } catch {
    return false;
  }
}

export const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'], {
        error: 'NODE_ENV must be one of development, test or production.',
      })
      .default('development'),
    PORT: z.coerce
      .number({
        error: 'PORT must be an integer between 1 and 65535.',
      })
      .int({ error: 'PORT must be an integer between 1 and 65535.' })
      .min(1, { error: 'PORT must be an integer between 1 and 65535.' })
      .max(65535, { error: 'PORT must be an integer between 1 and 65535.' })
      .default(3000),
    DATABASE_URL: z
      .string({
        error:
          'DATABASE_URL is required and must be a PostgreSQL connection URL.',
      })
      .min(1, {
        error:
          'DATABASE_URL is required and must be a PostgreSQL connection URL.',
      })
      .refine(isPostgresConnectionString, {
        error:
          'DATABASE_URL must be a valid postgres:// or postgresql:// connection URL with a database name.',
      }),
    SESSION_COOKIE_SECURE: booleanStringSchema,
  })
  .transform((value) => ({
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    databaseUrl: value.DATABASE_URL,
    sessionCookieSecure: value.SESSION_COOKIE_SECURE,
  }));

export type AppConfig = Readonly<z.infer<typeof environmentSchema>>;

export const APP_CONFIG = Symbol('APP_CONFIG');

export class EnvironmentValidationError extends Error {
  override readonly name = 'EnvironmentValidationError';

  constructor(message: string) {
    super(message);
  }
}

/**
 * Validates the runtime environment. Messages only mention configuration names
 * and constraints; values (which may contain passwords) are never echoed.
 */
export function loadEnv(
  source: Record<string, string | undefined> = process.env,
): AppConfig {
  const parsed = environmentSchema.safeParse(source);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'environment';
      return `- ${path}: ${issue.message}`;
    });

    throw new EnvironmentValidationError(
      `Invalid environment configuration:\n${issues.join('\n')}`,
    );
  }

  return Object.freeze(parsed.data);
}

/**
 * Global configuration module. The factory runs when the Nest application is
 * created, so a missing critical value stops startup before any listener opens.
 */
@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: () => loadEnv(process.env),
    },
  ],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
