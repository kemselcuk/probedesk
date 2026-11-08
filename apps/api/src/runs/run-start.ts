import { createHash } from 'node:crypto';
import type { FieldError } from '../common/errors/field-error.js';
import { ValidationFailedException } from '../common/errors/validation.exception.js';
import { parseScaledDecimal } from '../plans/plan-decimal.js';
import { RunScenario } from '../prisma/generated/client.js';
import {
  BATCH_NUMBER_MAX_LENGTH,
  BATCH_NUMBER_PATTERN,
  normalizeRunBatch,
} from './run-metadata.js';
import { MAX_RUN_SEED } from './run-domain.js';

/**
 * Idempotency keys are opaque client values. The contract only requires a
 * non-empty, bounded header, so the API stores the exact submitted value.
 */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

const MAX_SEED = Number(MAX_RUN_SEED);

export interface RunStartInput {
  planVersionId: string;
  scenario: RunScenario;
  seed: number;
  failureStepId?: string | null;
  errorProbability?: string | null;
  deviceId?: string | null;
  batchNumber?: string | null;
}

/**
 * A validated start request with canonical scalar values. This is both the
 * input of the snapshot builder and the source of the stored request hash.
 */
export interface NormalizedRunStart {
  planVersionId: string;
  scenario: RunScenario;
  seed: number;
  failureStepId: string | null;
  errorProbability: string | null;
  /**
   * Optional so the historical no-metadata fixture shape remains assignable.
   * Absent values are the same canonical state as null and hash as v1.
   */
  deviceId?: string | null;
  batchNumber?: string | null;
  batchNumberKey?: string | null;
}

/**
 * Reads the `Idempotency-Key` header. A missing, blank or overlong value is a
 * field-level 400 before any database access.
 */
export function normalizeIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationFailedException([
      {
        path: 'Idempotency-Key',
        code: 'REQUIRED',
        message: 'Idempotency-Key header is required and must not be blank',
      },
    ]);
  }

  if (value.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new ValidationFailedException([
      {
        path: 'Idempotency-Key',
        code: 'INVALID_VALUE',
        message: `Idempotency-Key header must be at most ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`,
      },
    ]);
  }

  return value;
}

/**
 * Applies the scenario-specific settings from simulation.md and canonicalises
 * the values that participate in the request hash. A failureStepId belonging to
 * the version is checked later against the immutable published snapshot.
 */
export function normalizeRunStart(input: RunStartInput): NormalizedRunStart {
  const issues: FieldError[] = [];
  const planVersionId = normalizeUuid(
    input.planVersionId,
    'planVersionId',
    issues,
  );
  const failureStepId = normalizeUuid(
    input.failureStepId,
    'failureStepId',
    issues,
  );
  const deviceId = normalizeUuid(input.deviceId, 'deviceId', issues);
  const batch = normalizeBatch(input.batchNumber, issues);
  const hasErrorProbability =
    input.errorProbability !== undefined && input.errorProbability !== null;
  let errorProbability: string | null = null;

  if (
    !Number.isInteger(input.seed) ||
    input.seed < 0 ||
    input.seed > MAX_SEED
  ) {
    issues.push({
      path: 'seed',
      code: 'INVALID_VALUE',
      message: `seed must be an integer between 0 and ${MAX_SEED}`,
    });
  }

  switch (input.scenario) {
    case RunScenario.NORMAL: {
      if (failureStepId !== null) {
        issues.push({
          path: 'failureStepId',
          code: 'INVALID_VALUE',
          message:
            'failureStepId is only allowed for the FORCED_FAILURE scenario',
        });
      }
      if (hasErrorProbability) {
        issues.push({
          path: 'errorProbability',
          code: 'INVALID_VALUE',
          message: 'errorProbability is only allowed for the RANDOM scenario',
        });
      }
      break;
    }

    case RunScenario.FORCED_FAILURE: {
      if (hasErrorProbability) {
        issues.push({
          path: 'errorProbability',
          code: 'INVALID_VALUE',
          message:
            'errorProbability is not allowed for the FORCED_FAILURE scenario',
        });
      }
      if (failureStepId === null) {
        issues.push({
          path: 'failureStepId',
          code: 'REQUIRED',
          message: 'failureStepId is required for the FORCED_FAILURE scenario',
        });
      }
      break;
    }

    case RunScenario.RANDOM: {
      if (failureStepId !== null) {
        issues.push({
          path: 'failureStepId',
          code: 'INVALID_VALUE',
          message: 'failureStepId is not allowed for the RANDOM scenario',
        });
      }
      if (!hasErrorProbability) {
        issues.push({
          path: 'errorProbability',
          code: 'REQUIRED',
          message: 'errorProbability is required for the RANDOM scenario',
        });
        break;
      }

      if (typeof input.errorProbability !== 'string') {
        issues.push({
          path: 'errorProbability',
          code: 'INVALID_TYPE',
          message: 'errorProbability must be a decimal string between 0 and 1',
        });
        break;
      }

      const scaled = parseScaledDecimal(input.errorProbability);
      if (scaled === null || scaled < 0n || scaled > 1_000_000n) {
        issues.push({
          path: 'errorProbability',
          code: 'INVALID_VALUE',
          message:
            'errorProbability must be a decimal between 0 and 1 with at most 6 fractional digits',
        });
        break;
      }

      errorProbability = formatScaled(scaled);
      break;
    }

    default: {
      issues.push({
        path: 'scenario',
        code: 'INVALID_VALUE',
        message: `scenario must be one of ${Object.values(RunScenario).join(', ')}`,
      });
      break;
    }
  }

  if (issues.length > 0) {
    throw new ValidationFailedException(issues);
  }

  return {
    planVersionId: planVersionId ?? input.planVersionId,
    scenario: input.scenario,
    seed: input.seed,
    failureStepId,
    errorProbability,
    deviceId,
    batchNumber: batch.batchNumber,
    batchNumberKey: batch.batchNumberKey,
  };
}

/**
 * The stable digest of the normalized request. Requests without device/batch
 * metadata keep the exact v1 marker and array the historical implementation
 * used. Metadata requests use a separate marker and only canonical values;
 * current device names and serial numbers are never hash inputs.
 */
export function hashRunStartRequest(request: NormalizedRunStart): string {
  const deviceId = request.deviceId ?? null;
  const batchNumberKey = request.batchNumberKey ?? null;
  const hasMetadata = deviceId !== null || batchNumberKey !== null;
  const canonical = JSON.stringify(
    hasMetadata
      ? [
          'probedesk-run-start-v2',
          request.planVersionId,
          request.scenario,
          request.seed,
          request.failureStepId,
          request.errorProbability,
          deviceId,
          batchNumberKey,
        ]
      : [
          'probedesk-run-start-v1',
          request.planVersionId,
          request.scenario,
          request.seed,
          request.failureStepId,
          request.errorProbability,
        ],
  );

  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function normalizeUuid(
  value: string | null | undefined,
  path: string,
  issues: FieldError[],
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    issues.push({
      path,
      code: 'INVALID_TYPE',
      message: `${path} must be a UUID`,
    });
    return null;
  }

  return value.toLowerCase();
}

/**
 * Batch metadata is optional. Trimming happens before the ASCII/limit check,
 * the display value keeps its case, and only the uppercase key is hashed.
 */
function normalizeBatch(
  value: unknown,
  issues: FieldError[],
): { batchNumber: string | null; batchNumberKey: string | null } {
  if (value === undefined || value === null) {
    return { batchNumber: null, batchNumberKey: null };
  }

  if (typeof value !== 'string') {
    issues.push({
      path: 'batchNumber',
      code: 'INVALID_TYPE',
      message: 'batchNumber must be a string or null',
    });
    return { batchNumber: null, batchNumberKey: null };
  }

  const batch = normalizeRunBatch(value);
  if (batch.batchNumber === null) {
    return batch;
  }

  if (
    batch.batchNumber.length > BATCH_NUMBER_MAX_LENGTH ||
    !BATCH_NUMBER_PATTERN.test(batch.batchNumber)
  ) {
    issues.push({
      path: 'batchNumber',
      code: 'INVALID_VALUE',
      message: `batchNumber must be 1 to ${BATCH_NUMBER_MAX_LENGTH} characters using ASCII letters, digits and ._:/- after trimming`,
    });
    return { batchNumber: null, batchNumberKey: null };
  }

  return batch;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatScaled(scaled: bigint): string {
  const integerPart = scaled / 1_000_000n;
  const fractionPart = (scaled % 1_000_000n).toString().padStart(6, '0');

  return `${integerPart.toString()}.${fractionPart}`;
}
