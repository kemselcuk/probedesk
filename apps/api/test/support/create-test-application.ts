import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/common/bootstrap/configure-app.js';
import { setupSwagger } from '../../src/common/openapi/openapi.js';
import { APP_CONFIG, loadEnv, type AppConfig } from '../../src/config/env.js';

export async function createTestApplication(
  configOverrides: Partial<AppConfig> = {},
  options: { swagger?: boolean } = {},
): Promise<INestApplication> {
  const config: AppConfig = Object.freeze({
    ...loadEnv(process.env),
    ...configOverrides,
  });

  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .compile();

  const app = moduleFixture.createNestApplication({ logger: false });
  configureApp(app);

  if (options.swagger) {
    setupSwagger(app);
  }

  await app.init();

  return app;
}
