import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import { EXPECTED_MIGRATIONS } from '../src/prisma/migration-manifest.js';
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

    it('reports readiness after a real database query and migration check', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/health/ready')
        .expect(200);

      expect(response.body).toEqual({
        status: 'ok',
        checks: { database: 'ok', migrations: 'ok' },
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

    it('maps a database connection failure during login to SERVICE_UNAVAILABLE', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'planner@probedesk.local', password: 'irrelevant-pass' })
        .expect(503);

      expect(response.body).toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        message: 'The service is currently unavailable.',
        requestId: expect.stringMatching(/^[A-Za-z0-9._-]{8,128}$/),
      });
      expect(Object.keys(response.body).sort()).toEqual([
        'code',
        'message',
        'requestId',
      ]);

      const serialised = JSON.stringify(response.body);
      expect(serialised).not.toContain('probedesk:probedesk');
      expect(serialised).not.toContain('59999');
      expect(serialised).not.toContain('SELECT');
      expect(serialised).not.toContain('P1001');
      expect(serialised).not.toContain('stack');
    });
  });

  describe('with a reachable database that has no migrations', () => {
    let app: INestApplication | undefined;
    let admin: Client | undefined;
    let emptyDatabaseUrl: string;
    const databaseName = `probedesk_ready_${randomUUID().replaceAll('-', '').slice(0, 12)}`;

    beforeAll(async () => {
      const testDatabaseUrl = process.env.TEST_DATABASE_URL;
      if (!testDatabaseUrl) {
        throw new Error(
          'TEST_DATABASE_URL is required to create a temporary empty database.',
        );
      }

      const adminUrl = new URL(testDatabaseUrl);
      adminUrl.pathname = '/postgres';
      admin = new Client({
        connectionString: adminUrl.toString(),
        application_name: 'probedesk-readiness-test',
      });
      await admin.connect();
      await admin.query(`CREATE DATABASE "${databaseName}"`);

      const emptyUrl = new URL(testDatabaseUrl);
      emptyUrl.pathname = `/${databaseName}`;
      emptyDatabaseUrl = emptyUrl.toString();

      app = await createTestApplication({ databaseUrl: emptyDatabaseUrl });
    });

    afterAll(async () => {
      if (app) {
        await app.close();
      }

      if (admin) {
        try {
          await admin.query(
            `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
          );
        } finally {
          await admin.end();
        }
      }
    });

    it('returns 503 because the schema has no applied migrations', async () => {
      const response = await request(app!.getHttpServer())
        .get('/api/health/ready')
        .expect(503);

      expect(response.body).toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        message: 'The service is not ready.',
        requestId: expect.stringMatching(/^[A-Za-z0-9._-]{8,128}$/),
        details: {
          checks: { database: 'ok', migrations: 'pending' },
        },
      });

      const serialised = JSON.stringify(response.body);
      expect(serialised).not.toContain(databaseName);
      expect(serialised).not.toContain('_prisma_migrations');
      expect(serialised).not.toContain('SELECT');
      expect(serialised).not.toContain('42P01');
      expect(serialised).not.toContain('stack');
    });

    it('returns 503 until every registered migration is applied, then 200', async () => {
      const client = new Client({
        connectionString: emptyDatabaseUrl,
        application_name: 'probedesk-readiness-test',
      });
      await client.connect();

      try {
        await client.query(`
          CREATE TABLE "_prisma_migrations" (
            "migration_name" text,
            "finished_at" timestamptz,
            "rolled_back_at" timestamptz
          )
        `);
        await client.query(
          `INSERT INTO "_prisma_migrations" ("migration_name", "finished_at", "rolled_back_at")
           VALUES ($1, now(), NULL)`,
          [EXPECTED_MIGRATIONS[0]],
        );

        // Only the first registered migration is applied: not ready.
        const missingMigration = await request(app!.getHttpServer())
          .get('/api/health/ready')
          .expect(503);

        expect(missingMigration.body).toMatchObject({
          code: 'SERVICE_UNAVAILABLE',
          message: 'The service is not ready.',
          details: {
            checks: { database: 'ok', migrations: 'pending' },
          },
        });

        // The remaining migrations exist but have not finished: still not ready.
        for (const migrationName of EXPECTED_MIGRATIONS.slice(1)) {
          await client.query(
            `INSERT INTO "_prisma_migrations" ("migration_name", "finished_at", "rolled_back_at")
             VALUES ($1, NULL, NULL)`,
            [migrationName],
          );
        }

        const unfinished = await request(app!.getHttpServer())
          .get('/api/health/ready')
          .expect(503);

        expect(unfinished.body).toMatchObject({
          details: {
            checks: { database: 'ok', migrations: 'pending' },
          },
        });

        await client.query(`
          UPDATE "_prisma_migrations"
          SET "finished_at" = now()
          WHERE "finished_at" IS NULL
        `);

        const ready = await request(app!.getHttpServer())
          .get('/api/health/ready')
          .expect(200);

        expect(ready.body).toEqual({
          status: 'ok',
          checks: { database: 'ok', migrations: 'ok' },
        });
      } finally {
        await client.end();
      }
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
