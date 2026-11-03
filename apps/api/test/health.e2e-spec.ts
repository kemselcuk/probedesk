import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApplication } from './support/create-test-application.js';

describe('health endpoints (e2e)', () => {
  describe('with an available database', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await createTestApplication();
    });

    afterAll(async () => {
      await app.close();
    });

    it('reports liveness without touching the database', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/health/live')
        .expect(200);

      expect(response.body).toEqual({ status: 'ok' });
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-request-id']).toMatch(
        /^[A-Za-z0-9._-]{8,128}$/,
      );
    });

    it('reports readiness after a real database query', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/health/ready')
        .expect(200);

      expect(response.body).toEqual({
        status: 'ok',
        checks: { database: 'ok' },
      });
    });
  });

  describe('with an unavailable database', () => {
    let app: INestApplication;
    const unavailableDatabaseUrl =
      'postgresql://probedesk:probedesk@127.0.0.1:59999/probedesk_test?schema=public';

    beforeAll(async () => {
      app = await createTestApplication({
        databaseUrl: unavailableDatabaseUrl,
      });
    });

    afterAll(async () => {
      await app.close();
    });

    it('keeps liveness independent from database availability', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/health/live')
        .expect(200);

      expect(response.body).toEqual({ status: 'ok' });
    });

    it('returns a contract-shaped 503 from readiness', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/health/ready')
        .expect(503);

      expect(response.body).toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        message: 'The service is not ready.',
        requestId: expect.stringMatching(/^[A-Za-z0-9._-]{8,128}$/),
        details: {
          checks: { database: 'unavailable' },
        },
      });
      expect(Object.keys(response.body).sort()).toEqual([
        'code',
        'details',
        'message',
        'requestId',
      ]);

      const serialised = JSON.stringify(response.body);
      expect(serialised).not.toContain('probedesk:probedesk');
      expect(serialised).not.toContain('59999');
      expect(serialised).not.toContain('SELECT');
      expect(serialised).not.toContain('stack');
    });

    it('returns the same request id in the header and the error body', async () => {
      const requestId = 'readiness-request-123';
      const response = await request(app.getHttpServer())
        .get('/api/health/ready')
        .set('X-Request-Id', requestId)
        .expect(503);

      expect(response.headers['x-request-id']).toBe(requestId);
      expect(response.body.requestId).toBe(requestId);
    });

    it('replaces an unsafe incoming request id', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/health/live')
        .set('X-Request-Id', 'contains spaces and a very long value'.repeat(10))
        .expect(200);

      expect(response.headers['x-request-id']).not.toContain(' ');
      expect(response.headers['x-request-id']).toMatch(
        /^[A-Za-z0-9._-]{8,128}$/,
      );
    });
  });

  it('shape-maps unknown routes to NOT_FOUND', async () => {
    const app = await createTestApplication();

    try {
      const response = await request(app.getHttpServer())
        .get('/api/does-not-exist')
        .expect(404);

      expect(response.body).toMatchObject({
        code: 'NOT_FOUND',
        message: 'The requested resource was not found.',
        requestId: expect.any(String),
      });
    } finally {
      await app.close();
    }
  });
});
