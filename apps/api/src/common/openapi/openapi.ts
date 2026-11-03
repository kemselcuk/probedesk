import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger';

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('ProbeDesk API')
    .setDescription(
      'Versioned measurement plans, deterministic simulated runs and run comparison. All routes are served under /api.',
    )
    .setVersion('0.1.0')
    .addTag('health', 'Liveness and readiness probes.')
    .build();

  return SwaggerModule.createDocument(app, config);
}

/**
 * Serves the interactive docs and the machine-readable document. The JSON URL
 * matches the file produced by `npm run openapi:emit`.
 */
export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup('api/docs', app, createOpenApiDocument(app), {
    jsonDocumentUrl: 'api/docs-json',
    customSiteTitle: 'ProbeDesk API',
  });
}
