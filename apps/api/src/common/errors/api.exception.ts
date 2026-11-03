import { HttpException, type HttpStatus } from '@nestjs/common';
import type { ApiErrorCode } from './api-error-code.js';
import type { FieldError } from './field-error.js';

export interface ApiExceptionOptions {
  fieldErrors?: readonly FieldError[];
  details?: Record<string, unknown>;
}

/**
 * An HTTP error whose response code and safe details are part of the API
 * contract. Messages passed here are shown to clients, so they must never
 * include SQL, stack traces, cookies, passwords or other secrets.
 */
export class ApiException extends HttpException {
  readonly code: ApiErrorCode;
  readonly fieldErrors?: readonly FieldError[];
  readonly details?: Record<string, unknown>;

  constructor(
    status: HttpStatus,
    code: ApiErrorCode,
    message: string,
    options: ApiExceptionOptions = {},
  ) {
    super(message, status);
    this.code = code;
    this.fieldErrors = options.fieldErrors;
    this.details = options.details;
  }
}
