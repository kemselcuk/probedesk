import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './common/bootstrap/configure-app.js';
import { setupSwagger } from './common/openapi/openapi.js';
import {
  APP_CONFIG,
  EnvironmentValidationError,
  loadDotEnv,
  loadEnv,
  type AppConfig,
} from './config/env.js';

loadDotEnv();

async function bootstrap(): Promise<void> {
  try {
    // Fail fast with a readable message before Nest logs any module output.
    loadEnv(process.env);

    const app = await NestFactory.create(AppModule);
    configureApp(app);
    setupSwagger(app);
    app.enableShutdownHooks();

    const config = app.get<AppConfig>(APP_CONFIG);
    await app.listen(config.port);

    Logger.log(
      `ProbeDesk API listening on port ${config.port} under /api`,
      'Bootstrap',
    );
  } catch (error) {
    if (error instanceof EnvironmentValidationError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }

    throw error;
  }
}

await bootstrap();
