import { ValidationFailedException } from '../common/errors/validation.exception.js';
import type { FieldError } from '../common/errors/field-error.js';
import type { SaveDraftDto } from './dto/save-draft.dto.js';
import { parseScaledDecimal } from './plan-decimal.js';

export const MAX_STEPS = 30;
export const MAX_TOTAL_SAMPLES = 10_000;
export const MAX_TOTAL_DURATION_MS = 600_000;

const DECIMAL_RANGE_MESSAGE =
  'must be between -1000000000 and 1000000000 with at most 6 fractional digits';

interface LimitStepShape {
  minimum: string;
  maximum: string;
  sampleCount: number;
  intervalMs: number;
}

/** One stored step as read back from PostgreSQL before publishing. */
export interface StoredStepForPublish {
  logicalStepId: string;
  position: number;
  name: string;
  unit: string;
  minimum: string;
  maximum: string;
  sampleCount: number;
  intervalMs: number;
}

/**
 * Cross-field checks that class-validator cannot express per property. Field
 * paths point at the submitted array index so a re-sorted form can still attach
 * the error to the row the user actually sent.
 *
 * Run after the field-level ValidationPipe, before any database write.
 */
export function assertDraftLimits(dto: SaveDraftDto): void {
  throwIfInvalid(collectLimitErrors(dto.steps));
}

/**
 * Re-validates the stored draft content immediately before it becomes
 * immutable. A draft can only reach this point through validated saves, but a
 * migration, manual SQL or a future write path must not be able to publish a
 * revision that violates the measurement contract.
 */
export function assertPublishableSteps(
  steps: readonly StoredStepForPublish[],
): void {
  const errors: FieldError[] = [];

  if (steps.length === 0) {
    errors.push({
      path: 'steps',
      code: 'INVALID_VALUE',
      message: 'A plan must have at least 1 step before publishing',
    });
  }

  if (steps.length > MAX_STEPS) {
    errors.push({
      path: 'steps',
      code: 'INVALID_VALUE',
      message: `A plan must not contain more than ${MAX_STEPS} steps`,
    });
  }

  for (const [index, step] of steps.entries()) {
    if (step.position !== index + 1) {
      errors.push({
        path: `steps.${index}.position`,
        code: 'INVALID_VALUE',
        message: 'Stored steps must be ordered from 1 without gaps',
      });
    }

    const nameLength = step.name.trim().length;
    if (nameLength < 1 || nameLength > 100) {
      errors.push({
        path: `steps.${index}.name`,
        code: 'INVALID_VALUE',
        message: 'name must be 1 to 100 characters after trimming',
      });
    }

    const unitLength = step.unit.trim().length;
    if (unitLength < 1 || unitLength > 16) {
      errors.push({
        path: `steps.${index}.unit`,
        code: 'INVALID_VALUE',
        message: 'unit must be 1 to 16 characters after trimming',
      });
    }

    if (!isUuid(step.logicalStepId)) {
      errors.push({
        path: `steps.${index}.logicalStepId`,
        code: 'INVALID_VALUE',
        message: 'logicalStepId must be a UUID',
      });
    }
  }

  errors.push(...collectLimitErrors(steps));
  throwIfInvalid(errors);
}

function collectLimitErrors(steps: readonly LimitStepShape[]): FieldError[] {
  const errors: FieldError[] = [];

  for (const [index, step] of steps.entries()) {
    const minimum = parseScaledDecimal(step.minimum);
    const maximum = parseScaledDecimal(step.maximum);

    if (minimum === null) {
      errors.push({
        path: `steps.${index}.minimum`,
        code: 'INVALID_VALUE',
        message: `minimum ${DECIMAL_RANGE_MESSAGE}`,
      });
    }

    if (maximum === null) {
      errors.push({
        path: `steps.${index}.maximum`,
        code: 'INVALID_VALUE',
        message: `maximum ${DECIMAL_RANGE_MESSAGE}`,
      });
    }

    if (minimum !== null && maximum !== null && minimum > maximum) {
      errors.push({
        path: `steps.${index}.maximum`,
        code: 'INVALID_VALUE',
        message: 'maximum must be greater than or equal to minimum',
      });
    }

    if (
      !Number.isInteger(step.sampleCount) ||
      step.sampleCount < 1 ||
      step.sampleCount > 1000
    ) {
      errors.push({
        path: `steps.${index}.sampleCount`,
        code: 'INVALID_VALUE',
        message: 'sampleCount must be an integer between 1 and 1000',
      });
    }

    if (
      !Number.isInteger(step.intervalMs) ||
      step.intervalMs < 100 ||
      step.intervalMs > 5000
    ) {
      errors.push({
        path: `steps.${index}.intervalMs`,
        code: 'INVALID_VALUE',
        message: 'intervalMs must be an integer between 100 and 5000',
      });
    }
  }

  const totalSamples = steps.reduce(
    (total, step) => total + step.sampleCount,
    0,
  );
  if (totalSamples > MAX_TOTAL_SAMPLES) {
    errors.push({
      path: 'steps',
      code: 'INVALID_VALUE',
      message: `A plan must not exceed ${MAX_TOTAL_SAMPLES} total samples`,
    });
  }

  const totalDurationMs = steps.reduce(
    (total, step) => total + step.sampleCount * step.intervalMs,
    0,
  );
  if (totalDurationMs > MAX_TOTAL_DURATION_MS) {
    errors.push({
      path: 'steps',
      code: 'INVALID_VALUE',
      message: `A plan must not exceed ${MAX_TOTAL_DURATION_MS} ms of nominal duration`,
    });
  }

  return errors;
}

function throwIfInvalid(errors: FieldError[]): void {
  if (errors.length > 0) {
    throw new ValidationFailedException(errors);
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
