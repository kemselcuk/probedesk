import { HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';

/** A field-level validation message returned by the API. */
export interface ApiFieldErrorView {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

/**
 * Normalized HTTP failure used by screens and facades.
 *
 * `requestId` is the value from the API error body, when the API supplied one.
 * It is shown as a support detail and is never used to infer the failure kind.
 */
export interface ApiErrorView {
  readonly kind: 'api' | 'network' | 'unknown';
  readonly status: number | null;
  readonly code: string;
  readonly message: string;
  readonly requestId: string | null;
  readonly fieldErrors: readonly ApiFieldErrorView[];
}

const NETWORK_ERROR_MESSAGE =
  'The server could not be reached. Check your connection and try again.';
const UNKNOWN_ERROR_MESSAGE = 'The request failed unexpectedly. Please try again.';
const SERVER_ERROR_MESSAGE =
  'The server could not complete the request. Please try again.';

/**
 * Maps an unknown thrown value into the typed error model the UI renders.
 *
 * The API contract is `{ code, message, requestId, fieldErrors?, details? }`;
 * `details` is intentionally not exposed to screens because it is optional and
 * may not be display-safe.
 */
@Injectable({ providedIn: 'root' })
export class HttpErrorNormalizer {
  normalize(error: unknown): ApiErrorView {
    if (error instanceof HttpErrorResponse) {
      return this.fromHttpError(error);
    }

    return {
      kind: 'unknown',
      status: null,
      code: 'UNKNOWN_ERROR',
      message: UNKNOWN_ERROR_MESSAGE,
      requestId: null,
      fieldErrors: [],
    };
  }

  private fromHttpError(error: HttpErrorResponse): ApiErrorView {
    if (error.status === 0) {
      return {
        kind: 'network',
        status: null,
        code: 'NETWORK_ERROR',
        message: NETWORK_ERROR_MESSAGE,
        requestId: null,
        fieldErrors: [],
      };
    }

    const body = asRecord(error.error);
    const code = body === null ? null : readString(body, 'code');
    const message = body === null ? null : readString(body, 'message');

    if (body !== null && code !== null && message !== null) {
      return {
        kind: 'api',
        status: error.status,
        code,
        message,
        requestId: readString(body, 'requestId'),
        fieldErrors: readFieldErrors(body),
      };
    }

    return {
      kind: 'api',
      status: error.status,
      code: error.status >= 500 ? 'SERVER_ERROR' : 'HTTP_ERROR',
      message:
        error.status >= 500
          ? SERVER_ERROR_MESSAGE
          : `The request failed with status ${error.status}. Please try again.`,
      requestId: null,
      fieldErrors: [],
    };
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function readFieldErrors(body: Record<string, unknown>): ApiFieldErrorView[] {
  const value = body['fieldErrors'];
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    const fieldError = asRecord(entry);
    if (fieldError === null) {
      return [];
    }

    const path = readString(fieldError, 'path');
    const code = readString(fieldError, 'code');
    const message = readString(fieldError, 'message');

    return path !== null && code !== null && message !== null
      ? [{ path, code, message }]
      : [];
  });
}
