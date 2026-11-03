/**
 * Thrown when a successful HTTP response does not match the generated schema
 * the screen consumes.
 *
 * The error is deliberately separate from `HttpErrorResponse`: the status was
 * 2xx, so the UI shows a normal, retryable error state instead of guessing
 * measurement values or dropping steps.
 */
export class MalformedApiResponseError extends Error {
  constructor(
    readonly endpoint: string,
    readonly reason: string,
  ) {
    super(`The ${endpoint} response did not match the API contract: ${reason}`);
    this.name = 'MalformedApiResponseError';
  }
}
