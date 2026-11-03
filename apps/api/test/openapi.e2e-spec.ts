import { readFileSync } from 'node:fs';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
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
      '/api/health/live',
      '/api/health/ready',
    ]);

    expect(document.paths['/api/auth/login']?.post?.responses).toHaveProperty(
      '200',
    );
    expect(document.paths['/api/auth/login']?.post?.responses).toHaveProperty(
      '401',
    );
    expect(document.paths['/api/auth/login']?.post?.responses).toHaveProperty(
      '429',
    );
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
    expect(document.components?.schemas?.AuthUserDto).toMatchObject({
      required: ['id', 'email', 'role'],
    });
    expect(document.components?.schemas?.LoginDto).toMatchObject({
      required: ['email', 'password'],
    });
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
