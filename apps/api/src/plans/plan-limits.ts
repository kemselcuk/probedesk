import { ValidationFailedException } from '../common/errors/validation.exception.js';
import type { FieldError } from '../common/errors/field-error.js';
import type { SaveDraftDto } from './dto/save-draft.dto.js';
import { parseScaledDecimal } from './plan-decimal.js';

export const MAX_STEPS = 30;
export const MAX_TOTAL_SAMPLES = 10_000;
export const MAX_TOTAL_DURATION_MS = 600_000;

const DECIMAL_RANGE_MESSAGE =
  'must be between -1000000000 and 1000000000 with at most 6 fractional digits';

/**
 * Cross-field checks that class-validator cannot express per property. Field
 * paths point at the submitted array index so a re-sorted form can still attach
 * the error to the row the user actually sent.
 *
 * Run after the field-level ValidationPipe, before any database write.
 */
export function assertDraftLimits(dto: SaveDraftDto): void {
  const errors: FieldError[] = [];

  for (const [index, step] of dto.steps.entries()) {
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
  }

  const totalSamples = dto.steps.reduce(
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

  const totalDurationMs = dto.steps.reduce(
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

  if (errors.length > 0) {
    throw new ValidationFailedException(errors);
  }
}
