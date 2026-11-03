import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger';
import {
  CSRF_HEADER_DISPLAY_NAME,
  SESSION_COOKIE_NAME,
} from '../../auth/auth.constants.js';

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('ProbeDesk API')
    .setDescription(
      'Versioned measurement plans, deterministic simulated runs and run comparison. All routes are served under /api.',
    )
    .setVersion('0.1.0')
    .addTag('health', 'Liveness and readiness probes.')
    .addTag('auth', 'Session login, logout, current user and CSRF protection.')
    .addCookieAuth(
      SESSION_COOKIE_NAME,
      {
        type: 'apiKey',
        description:
          'HttpOnly session cookie. The raw value is never returned in a response body.',
      },
      'session',
    )
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: CSRF_HEADER_DISPLAY_NAME,
        description:
          'Session-bound double-submit token. Echo the readable XSRF-TOKEN cookie value on every authenticated mutation.',
      },
      'csrfToken',
    )
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
