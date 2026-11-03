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

  it('generates the health routes and error schema without a database', () => {
    const document = createOpenApiDocument(app);

    expect(Object.keys(document.paths).sort()).toEqual([
      '/api/health/live',
      '/api/health/ready',
    ]);
    expect(document.components?.schemas).toHaveProperty('ApiErrorDto');
    expect(document.paths['/api/health/ready']?.get?.responses).toHaveProperty(
      '503',
    );
  });

  it('serves the JSON document from the application', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);

    expect(response.body.paths).toHaveProperty('/api/health/live');
  });
});
