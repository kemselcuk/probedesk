import { readFileSync } from 'node:fs';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { API_ERROR_CODES } from '../src/common/errors/api-error-code.js';
import { createOpenApiDocument } from '../src/common/openapi/openapi.js';
import { createTestApplication } from './support/create-test-application.js';

describe('OpenAPI document (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // The document must be generated without contacting PostgreSQL. Point the
    // application at a port that has no listener and never query it.
    app = await createTestApplication(
      {
        databaseUrl:
          'postgresql://probedesk:probedesk@127.0.0.1:59999/probedesk_test?schema=public',
      },
      { swagger: true },
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('documents health and auth routes with cookie and CSRF schemes', () => {
    const document = createOpenApiDocument(app);

    expect(Object.keys(document.paths).sort()).toEqual([
      '/api/auth/login',
      '/api/auth/logout',
      '/api/auth/me',
      '/api/device-profiles',
      '/api/health/live',
      '/api/health/ready',
      '/api/plans',
      '/api/plans/{id}',
      '/api/plans/{id}/draft',
    ]);

    expect(document.paths['/api/auth/login']?.post?.responses).toHaveProperty(
      '200',
    );
    expect(document.paths['/api/auth/login']?.post?.responses).toHaveProperty(
      '400',
    );
    expect(document.paths['/api/auth/login']?.post?.responses).toHaveProperty(
      '401',
    );
    expect(document.paths['/api/auth/login']?.post?.responses).toHaveProperty(
      '403',
    );
    expect(document.paths['/api/auth/login']?.post?.responses).toHaveProperty(
      '429',
    );
    expect(document.paths['/api/auth/login']?.post?.responses).toHaveProperty(
      '503',
    );
    expect(
      document.paths['/api/auth/login']?.post?.responses['403'],
    ).toMatchObject({
      description: 'The request Origin is not same-origin.',
    });
    expect(
      document.paths['/api/auth/login']?.post?.responses['429'],
    ).toMatchObject({
      headers: {
        'Retry-After': {
          description: 'Seconds until another login attempt is allowed.',
        },
      },
    });
    expect(document.paths['/api/auth/login']?.post?.security).toBeUndefined();
    expect(document.paths['/api/auth/me']?.get?.security).toEqual([
      { session: [] },
    ]);
    expect(document.paths['/api/auth/me']?.get?.responses).toHaveProperty(
      '401',
    );
    expect(document.paths['/api/auth/logout']?.post?.security).toEqual([
      { session: [], csrfToken: [] },
    ]);
    expect(document.paths['/api/auth/logout']?.post?.responses).toHaveProperty(
      '204',
    );
    expect(document.paths['/api/auth/logout']?.post?.responses).toHaveProperty(
       '403',
    );

    expect(document.paths['/api/device-profiles']?.get?.security).toEqual([
      { session: [] },
    ]);
    expect(document.paths['/api/plans']?.get?.security).toEqual([
      { session: [] },
    ]);
    expect(document.paths['/api/plans']?.post?.security).toEqual([
      { session: [], csrfToken: [] },
    ]);
    expect(document.paths['/api/plans/{id}']?.get?.security).toEqual([
      { session: [] },
    ]);
    expect(
      document.paths['/api/plans/{id}/draft']?.put?.security,
    ).toEqual([{ session: [], csrfToken: [] }]);
    expect(document.paths['/api/plans']?.post?.responses).toHaveProperty('201');
    expect(document.paths['/api/plans']?.post?.responses).toHaveProperty('400');
    expect(document.paths['/api/plans']?.post?.responses).toHaveProperty('403');
    expect(
      document.paths['/api/plans/{id}/draft']?.put?.responses,
    ).toHaveProperty('409');
    expect(document.paths['/api/plans/{id}']?.get?.responses).toHaveProperty(
      '404',
    );

    expect(document.components?.securitySchemes).toMatchObject({
      session: {
        type: 'apiKey',
        in: 'cookie',
        name: 'probedesk_session',
      },
      csrfToken: {
        type: 'apiKey',
        in: 'header',
        name: 'X-XSRF-TOKEN',
      },
    });

    expect(document.components?.schemas).toHaveProperty('AuthUserDto');
    expect(document.components?.schemas).toHaveProperty('LoginDto');
    expect(document.components?.schemas).toHaveProperty('ApiErrorDto');
    expect(document.components?.schemas).toHaveProperty('PlanDetailDto');
    expect(document.components?.schemas).toHaveProperty('PlanListItemDto');
    expect(document.components?.schemas).toHaveProperty(
      'PublishedVersionSummaryDto',
    );
    expect(document.components?.schemas).toHaveProperty('DraftRevisionDto');
    expect(document.components?.schemas).toHaveProperty('PublishedRevisionDto');
    expect(document.components?.schemas).toHaveProperty('PlanStepDto');
    expect(document.components?.schemas).toHaveProperty('DeviceProfileDto');
    expect(document.components?.schemas?.AuthUserDto).toMatchObject({
      required: ['id', 'email', 'role'],
    });
    expect(document.components?.schemas?.LoginDto).toMatchObject({
      required: ['email', 'password'],
    });

    const errorCodeSchema = document.components?.schemas?.ApiErrorDto as {
      properties?: { code?: { enum?: unknown[] } };
    };
    expect(errorCodeSchema.properties?.code?.enum).toEqual([
      ...API_ERROR_CODES,
    ]);
  });

  it('serves the JSON document from the application', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);

    expect(response.body.paths).toHaveProperty('/api/health/live');
    expect(response.body.paths).toHaveProperty('/api/auth/login');
    expect(response.body.components.securitySchemes.session.name).toBe(
      'probedesk_session',
    );
  });

  it('keeps the committed document in sync with the application', () => {
    const generated = createOpenApiDocument(app);
    const committed = JSON.parse(
      readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'),
    ) as unknown;

    expect(committed).toEqual(generated);
  });
});
