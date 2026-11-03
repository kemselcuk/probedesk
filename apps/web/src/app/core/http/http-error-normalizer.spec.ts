import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { HttpErrorNormalizer } from './http-error-normalizer';

describe('HttpErrorNormalizer', () => {
  const normalizer = new HttpErrorNormalizer();

  it('maps the API error body including field errors', () => {
    const error = new HttpErrorResponse({
      status: 400,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'The plan contains invalid values.',
        requestId: 'req-123',
        fieldErrors: [
          {
            path: 'steps.1.maximum',
            code: 'GREATER_THAN',
            message: 'Maximum must be greater than minimum.',
          },
          { path: 7, code: 'IGNORED', message: 'Malformed entry.' },
        ],
      },
    });

    expect(normalizer.normalize(error)).toEqual({
      kind: 'api',
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'The plan contains invalid values.',
      requestId: 'req-123',
      fieldErrors: [
        {
          path: 'steps.1.maximum',
          code: 'GREATER_THAN',
          message: 'Maximum must be greater than minimum.',
        },
      ],
      reason: null,
      currentRevision: null,
    });
  });

  it('exposes only the safe conflict details used for plan guidance', () => {
    const error = new HttpErrorResponse({
      status: 409,
      error: {
        code: 'DRAFT_CONFLICT',
        message: 'The draft was changed by another save.',
        requestId: 'req-conflict-7',
        details: {
          reason: 'OPEN_DRAFT_EXISTS',
          currentRevision: 9,
          secret: 'must not reach the screen',
        },
      },
    });

    const view = normalizer.normalize(error);

    expect(view.reason).toBe('OPEN_DRAFT_EXISTS');
    expect(view.currentRevision).toBe(9);
    expect(view).not.toHaveProperty('details');
  });

  it('distinguishes a network failure from an API response', () => {
    const error = new HttpErrorResponse({
      status: 0,
      statusText: 'Unknown Error',
      url: '/api/plans',
    });

    const view = normalizer.normalize(error);

    expect(view.kind).toBe('network');
    expect(view.status).toBeNull();
    expect(view.code).toBe('NETWORK_ERROR');
    expect(view.message).toContain('could not be reached');
    expect(view.requestId).toBeNull();
  });

  it('keeps a safe fallback for a server response without a contract body', () => {
    const error = new HttpErrorResponse({
      status: 503,
      statusText: 'Service Unavailable',
      error: 'upstream unavailable',
    });

    const view = normalizer.normalize(error);

    expect(view.kind).toBe('api');
    expect(view.status).toBe(503);
    expect(view.code).toBe('SERVER_ERROR');
    expect(view.requestId).toBeNull();
    expect(view.fieldErrors).toEqual([]);
  });

  it('does not expose an unexpected exception message', () => {
    const view = normalizer.normalize(new Error('database password leaked'));

    expect(view.kind).toBe('unknown');
    expect(view.status).toBeNull();
    expect(view.code).toBe('UNKNOWN_ERROR');
    expect(view.message).not.toContain('password');
  });
});
