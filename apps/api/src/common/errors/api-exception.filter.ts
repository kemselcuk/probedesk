import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ApiErrorCode } from './api-error-code.js';
import { ApiException } from './api.exception.js';
import type { FieldError } from './field-error.js';
import { isDatabaseInfrastructureError } from '../database/prisma-error.js';
import {
  getRequestId,
  REQUEST_ID_HEADER,
  type RequestWithRequestId,
} from '../http/request-id.js';

export interface ApiErrorResponse {
  code: ApiErrorCode;
  message: string;
  requestId: string;
  fieldErrors?: readonly FieldError[];
  details?: Record<string, unknown>;
}

const STATUS_CODES: Partial<Record<number, ApiErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_ERROR',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'DRAFT_CONFLICT',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'VALIDATION_ERROR',
  [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_REQUESTS',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'INTERNAL_ERROR',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
};

const STATUS_MESSAGES: Partial<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: 'The request is invalid.',
  [HttpStatus.UNAUTHORIZED]: 'Authentication is required.',
  [HttpStatus.FORBIDDEN]: 'You do not have permission to perform this action.',
  [HttpStatus.NOT_FOUND]: 'The requested resource was not found.',
  [HttpStatus.CONFLICT]: 'The request conflicts with the current state.',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'The request could not be processed.',
  [HttpStatus.TOO_MANY_REQUESTS]: 'Too many requests.',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'An unexpected error occurred.',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'The service is currently unavailable.',
};

function fallbackCode(status: number): ApiErrorCode {
  if (status >= 500) {
    return 'INTERNAL_ERROR';
  }

  return 'VALIDATION_ERROR';
}

function fallbackMessage(status: number): string {
  return (
    STATUS_MESSAGES[status] ??
    (status >= 500
      ? 'An unexpected error occurred.'
      : 'The request could not be processed.')
  );
}

function toErrorResponse(
  exception: unknown,
  requestId: string,
): { status: number; body: ApiErrorResponse } {
  if (exception instanceof ApiException) {
    const status = exception.getStatus();
    return {
      status,
      body: {
        code: exception.code,
        message: exception.message,
        requestId,
        ...(exception.fieldErrors && exception.fieldErrors.length > 0
          ? { fieldErrors: exception.fieldErrors }
          : {}),
        ...(exception.details ? { details: exception.details } : {}),
      },
    };
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    return {
      status,
      body: {
        code: STATUS_CODES[status] ?? fallbackCode(status),
        message: fallbackMessage(status),
        requestId,
      },
    };
  }

  // A database that cannot be reached or has not been migrated is an
  // infrastructure condition, not an application defect. Keep every other
  // unexpected error as INTERNAL_ERROR so programming bugs stay visible.
  if (isDatabaseInfrastructureError(exception)) {
    return {
      status: HttpStatus.SERVICE_UNAVAILABLE,
      body: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'The service is currently unavailable.',
        requestId,
      },
    };
  }

  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    body: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      requestId,
    },
  };
}

/**
 * Normalises every failure into `{ code, message, requestId, fieldErrors?,
 * details? }`. Original exception messages, stacks and SQL are never copied to
 * the response; unexpected failures are logged without their message or stack.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<RequestWithRequestId>();

    if (response.headersSent) {
      return;
    }

    const requestId = getRequestId(request);
    response.setHeader(REQUEST_ID_HEADER, requestId);

    if (
      exception instanceof ApiException &&
      exception.retryAfterSeconds !== undefined
    ) {
      response.setHeader('Retry-After', String(exception.retryAfterSeconds));
    }

    const { status, body } = toErrorResponse(exception, requestId);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      const errorName =
        exception instanceof Error
          ? exception.constructor.name
          : typeof exception;
      this.logger.error(
        `Request failed requestId=${requestId} method=${request.method} path=${request.path} status=${status} code=${body.code} error=${errorName}`,
      );
    }

    response.status(status).json(body);
  }
}
