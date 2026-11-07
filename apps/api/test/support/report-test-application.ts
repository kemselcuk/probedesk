import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/common/bootstrap/configure-app.js';
import { APP_CONFIG, loadEnv, type AppConfig } from '../../src/config/env.js';
import { ReportsModule } from '../../src/reports/reports.module.js';

/**
 * Compiles the production application plus the not-yet-registered ReportsModule
 * for this targeted suite. Production AppModule registration belongs to the
 * lead, so the test never assumes the module is already wired there.
 */
export async function createReportTestApplication(): Promise<INestApplication> {
  const config: AppConfig = Object.freeze(loadEnv(process.env));

  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule, ReportsModule],
  })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .compile();

  const app = moduleFixture.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();

  return app;
}
