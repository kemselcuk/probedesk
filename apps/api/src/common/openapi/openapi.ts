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

  const document = SwaggerModule.createDocument(app, config);
  sortOperationParameters(document);
  return document;
}

const HTTP_OPERATION_KEYS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
] as const;

/**
 * OpenAPI parameters are an unordered set, but the committed document is
 * byte-compared in tests. Nest derives route parameters and decorator-provided
 * parameters through different metadata paths, whose relative order can vary
 * with the TypeScript transformer. Sorting here makes `openapi:emit` and the
 * in-process test document deterministic across `tsx` and Vitest.
 */
function sortOperationParameters(document: OpenAPIObject): void {
  for (const pathItem of Object.values(document.paths)) {
    for (const method of HTTP_OPERATION_KEYS) {
      const operation = pathItem[method];
      if (!operation || !Array.isArray(operation.parameters)) {
        continue;
      }

      operation.parameters.sort((left, right) => {
        const leftKey = parameterSortKey(left);
        const rightKey = parameterSortKey(right);
        if (leftKey === rightKey) {
          return 0;
        }
        return leftKey < rightKey ? -1 : 1;
      });
    }
  }
}

function parameterSortKey(parameter: unknown): string {
  if (!isRecord(parameter)) {
    return '';
  }

  const location = typeof parameter.in === 'string' ? parameter.in : '';
  const name = typeof parameter.name === 'string' ? parameter.name : '';
  return `${location}:${name}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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
