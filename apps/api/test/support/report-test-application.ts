import { requireIsolatedApplicationDatabase } from '../../src/common/database/test-database-guard.js';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/common/bootstrap/configure-app.js';
import { APP_CONFIG, loadEnv, type AppConfig } from '../../src/config/env.js';

/** Uses the production AppModule so missing report registration fails this suite. */
export async function createReportTestApplication(): Promise<INestApplication> {
  requireIsolatedApplicationDatabase(process.env);
  const config: AppConfig = Object.freeze(loadEnv(process.env));

  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .compile();

  const app = moduleFixture.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();

  return app;
}
