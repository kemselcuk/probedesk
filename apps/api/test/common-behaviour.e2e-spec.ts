import { Logger, Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/common/bootstrap/configure-app.js';
import { APP_CONFIG, loadEnv } from '../src/config/env.js';
import { ValidationProbeController } from './fixtures/validation-probe.controller.js';

@Module({
  imports: [AppModule],
  controllers: [ValidationProbeController],
})
class ValidationProbeModule {}

describe('common API behaviour (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [ValidationProbeModule],
    })
      .overrideProvider(APP_CONFIG)
      .useValue(loadEnv(process.env))
      .compile();

    app = moduleFixture.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts a valid body and applies transformation', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/test-validation')
      .send({
        name: 'Main supply',
        sampleCount: 3,
        steps: [
          {
            name: 'Voltage',
            measurement: { value: 0.5 },
          },
        ],
      })
      .expect(201);

    expect(response.body.received.name).toBe('Main supply');
    expect(response.body.received.steps[0].measurement.value).toBe(0.5);
  });

  it('rejects invalid and nested values with field paths', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/test-validation')
      .send({
        name: 'Main supply',
        sampleCount: 'three',
        steps: [
          {
            name: 'Voltage',
            measurement: { value: 'high' },
          },
        ],
      })
      .expect(400);

    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(response.body.message).toBe('The request contains invalid fields.');
    expect(response.body.requestId).toEqual(expect.any(String));

    const fieldErrors = response.body.fieldErrors as Array<{
      path: string;
      code: string;
      message: string;
    }>;

    expect(fieldErrors).toContainEqual(
      expect.objectContaining({
        path: 'sampleCount',
        code: 'INVALID_TYPE',
      }),
    );
    expect(fieldErrors).toContainEqual(
      expect.objectContaining({
        path: 'steps.0.measurement.value',
        code: 'INVALID_TYPE',
      }),
    );
  });

  it('rejects unknown writable fields instead of stripping them', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/test-validation')
      .send({
        name: 'Main supply',
        sampleCount: 3,
        steps: [
          {
            name: 'Voltage',
            measurement: { value: 0.5, unit: 'V' },
          },
        ],
        status: 'COMPLETED',
      })
      .expect(400);

    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(response.body.fieldErrors).toContainEqual(
      expect.objectContaining({
        path: 'status',
        code: 'UNKNOWN_FIELD',
      }),
    );
    expect(response.body.fieldErrors).toContainEqual(
      expect.objectContaining({
        path: 'steps.0.measurement.unit',
        code: 'UNKNOWN_FIELD',
      }),
    );
    expect(JSON.stringify(response.body)).not.toContain('COMPLETED');
  });

  it('marks missing required fields', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/test-validation')
      .send({ steps: [] })
      .expect(400);

    expect(response.body.fieldErrors).toContainEqual(
      expect.objectContaining({
        path: 'name',
        code: 'REQUIRED',
      }),
    );
  });

  it('rejects non-finite numbers from raw JSON input', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/test-validation')
      .set('Content-Type', 'application/json')
      .send('{"name":"Main supply","sampleCount":1e999,"steps":[]}')
      .expect(400);

    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(response.body.fieldErrors).toContainEqual(
      expect.objectContaining({
        path: 'sampleCount',
        code: 'INVALID_TYPE',
      }),
    );
  });

  it('does not leak unexpected error messages, SQL or stacks', async () => {
    const logSpy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    try {
      const response = await request(app.getHttpServer())
        .get('/api/test-validation/boom')
        .expect(500);

      expect(response.body).toMatchObject({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
        requestId: expect.any(String),
      });
      expect(Object.keys(response.body).sort()).toEqual([
        'code',
        'message',
        'requestId',
      ]);

      const serialised = JSON.stringify(response.body);
      expect(serialised).not.toContain('SELECT');
      expect(serialised).not.toContain('supersecret');
      expect(serialised).not.toContain('at ');
      expect(serialised).not.toContain('stack');

      expect(logSpy).toHaveBeenCalled();
      const logged = logSpy.mock.calls
        .flat()
        .map((value) => String(value))
        .join(' ');
      expect(logged).not.toContain('SELECT');
      expect(logged).not.toContain('supersecret');
      expect(logged).not.toContain('stack');
      expect(logged).toContain(response.body.requestId);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('does not forward an exception message supplied by a thrown HttpException', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/test-validation/http-error')
      .expect(400);

    expect(response.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'The request is invalid.',
    });
    expect(JSON.stringify(response.body)).not.toContain('supersecret');
  });

  it('maps malformed JSON to the common validation error', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/test-validation')
      .set('Content-Type', 'application/json')
      .send('{"name":"broken", "password":"supersecret",')
      .expect(400);

    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(response.body)).not.toContain('supersecret');
  });
});
