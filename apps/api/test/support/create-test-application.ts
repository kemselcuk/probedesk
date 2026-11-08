import { requireIsolatedApplicationDatabase } from '../../src/common/database/test-database-guard.js';
import { Test } from '@nestjs/testing';
import type {
  INestApplication,
  InjectionToken,
  LoggerService,
} from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/common/bootstrap/configure-app.js';
import { setupSwagger } from '../../src/common/openapi/openapi.js';
import { APP_CONFIG, loadEnv, type AppConfig } from '../../src/config/env.js';

export interface TestProviderOverride {
  provide: InjectionToken;
  useValue: unknown;
}

export interface TestApplicationOptions {
  swagger?: boolean;
  /** Replaces providers such as the run scheduler for a deterministic test. */
  overrides?: readonly TestProviderOverride[];
  /**
   * Receives Nest's log calls instead of discarding them. Tests use this to
   * assert that secrets never reach the log sink.
   */
  logger?: LoggerService;
}

export async function createTestApplication(
  configOverrides: Partial<AppConfig> = {},
  options: TestApplicationOptions = {},
): Promise<INestApplication> {
  requireIsolatedApplicationDatabase(process.env);
  const config: AppConfig = Object.freeze({
    ...loadEnv(process.env),
    ...configOverrides,
  });

  requireIsolatedApplicationDatabase({
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: config.databaseUrl,
    TEST_DATABASE_URL: config.databaseUrl,
  });

  const builder = Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(APP_CONFIG)
    .useValue(config);

  for (const override of options.overrides ?? []) {
    builder.overrideProvider(override.provide).useValue(override.useValue);
  }

  const moduleFixture = await builder.compile();
  const app = moduleFixture.createNestApplication(
    options.logger ? { logger: options.logger } : { logger: false },
  );
  configureApp(app);

  if (options.swagger) {
    setupSwagger(app);
  }

  await app.init();

  return app;
}
