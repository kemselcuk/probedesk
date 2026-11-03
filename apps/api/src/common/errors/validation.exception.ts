import { HttpStatus } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import { ApiException } from './api.exception.js';
import type { FieldError } from './field-error.js';

export class ValidationFailedException extends ApiException {
  constructor(fieldErrors: readonly FieldError[]) {
    super(
      HttpStatus.BAD_REQUEST,
      'VALIDATION_ERROR',
      'The request contains invalid fields.',
      { fieldErrors },
    );
  }
}

const TYPE_CONSTRAINTS = new Set([
  'isArray',
  'isBoolean',
  'isDate',
  'isDateString',
  'isDecimal',
  'isEnum',
  'isInt',
  'isNumber',
  'isNumberString',
  'isObject',
  'isString',
  'isUuid',
]);

function codeForConstraint(constraint: string): string {
  if (constraint === 'whitelistValidation') {
    return 'UNKNOWN_FIELD';
  }

  if (constraint === 'isDefined' || constraint === 'isNotEmpty') {
    return 'REQUIRED';
  }

  return TYPE_CONSTRAINTS.has(constraint) ? 'INVALID_TYPE' : 'INVALID_VALUE';
}

function constraintPriority(constraint: string): number {
  if (constraint === 'whitelistValidation') {
    return 0;
  }

  if (constraint === 'isDefined' || constraint === 'isNotEmpty') {
    return 1;
  }

  if (TYPE_CONSTRAINTS.has(constraint)) {
    return 2;
  }

  return 3;
}

function collectFieldErrors(
  errors: readonly ValidationError[],
  parentPath: string,
  output: FieldError[],
  seen: Set<string>,
): void {
  for (const error of errors) {
    const path = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;
    const constraint = error.constraints
      ? Object.entries(error.constraints).sort(
          ([left], [right]) =>
            constraintPriority(left) - constraintPriority(right),
        )[0]
      : undefined;

    if (constraint && !seen.has(path)) {
      const [name, message] = constraint;
      seen.add(path);
      output.push({
        path,
        code: codeForConstraint(name),
        message,
      });
    }

    if (error.children && error.children.length > 0) {
      collectFieldErrors(error.children, path, output, seen);
    }
  }
}

/**
 * Converts class-validator errors into the API field error shape. Nested paths
 * stay aligned with the submitted document, including array indexes.
 */
export function toFieldErrors(
  errors: readonly ValidationError[],
): readonly FieldError[] {
  const output: FieldError[] = [];
  collectFieldErrors(errors, '', output, new Set());

  if (output.length === 0) {
    return [
      {
        path: 'body',
        code: 'INVALID_VALUE',
        message: 'The request body is invalid.',
      },
    ];
  }

  return output;
}

export function validationExceptionFactory(
  errors: readonly ValidationError[],
): ValidationFailedException {
  return new ValidationFailedException(toFieldErrors(errors));
}
