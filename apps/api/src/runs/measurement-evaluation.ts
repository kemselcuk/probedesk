import type { RunOutcome } from '../prisma/generated/enums.js';

/**
 * Exact decimal evaluation for recorded measurements.
 *
 * Values are represented as integers scaled by 10^6 (one micro-unit). The
 * tolerance verdict and step/run summaries are therefore independent of
 * JavaScript binary floating point. The stored `NUMERIC(18,6)` range allows
 * twelve integer digits, which is wider than the accepted tolerance input range
 * so a simulated forced failure can legitimately sit above the maximum.
 */
export const MEASUREMENT_SCALE = 6;
export const MEASUREMENT_SCALE_FACTOR = 1_000_000n;

/** Exclusive upper magnitude of NUMERIC(18,6): |value| < 1,000,000,000,000. */
export const MAX_MEASUREMENT_SCALED = 999_999_999_999_999_999n;

const CANONICAL_SIX_PLACE = /^-?(?:0|[1-9]\d{0,11})\.\d{6}$/;

export type MeasurementErrorCode =
  | 'INVALID_MEASUREMENT_VALUE'
  | 'INVALID_TOLERANCE_BOUNDS';

/** A defensive validation failure. It is a technical error, not a verdict. */
export class MeasurementValidationError extends Error {
  override readonly name = 'MeasurementValidationError';

  constructor(
    readonly code: MeasurementErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface ToleranceBounds {
  readonly minimumScaled: bigint;
  readonly maximumScaled: bigint;
}

export interface EvaluatedMeasurement {
  /** Canonical six-fraction-digit representation. */
  readonly value: string;
  readonly scaledValue: bigint;
  readonly isWithinTolerance: boolean;
}

export interface StepStatistics {
  readonly minimum: string | null;
  readonly maximum: string | null;
  readonly average: string | null;
  readonly sampleCount: number;
}

export interface FailureProgress {
  readonly outOfToleranceCount: number;
  readonly firstFailureSampleIndex: number | null;
}

/**
 * Parses a canonical six-place decimal into micro-units. The simulator always
 * returns this exact shape; anything else (NaN, Infinity, scientific notation,
 * commas, a different precision or an out-of-range value) is rejected before a
 * measurement is written.
 */
export function parseMeasurementDecimal(value: unknown): bigint | null {
  if (typeof value !== 'string' || !CANONICAL_SIX_PLACE.test(value)) {
    return null;
  }

  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [integerPart = '0', fractionPart = ''] = unsigned.split('.');
  const scaled =
    BigInt(integerPart) * MEASUREMENT_SCALE_FACTOR +
    BigInt(fractionPart.padEnd(MEASUREMENT_SCALE, '0'));
  const magnitude = negative ? -scaled : scaled;

  if (
    magnitude > MAX_MEASUREMENT_SCALED ||
    magnitude < -MAX_MEASUREMENT_SCALED
  ) {
    return null;
  }

  return magnitude;
}

/** Formats micro-units with exactly six fractional digits and no negative zero. */
export function formatMeasurementDecimal(value: bigint): string {
  if (value < 0n) {
    return `-${formatMagnitude(-value)}`;
  }

  return formatMagnitude(value);
}

/**
 * Reads the immutable step limits. They come from the validated run snapshot,
 * but parsing again keeps a malformed snapshot from silently producing a
 * verdict.
 */
export function parseToleranceBounds(
  minimum: string,
  maximum: string,
): ToleranceBounds {
  const minimumScaled = parseMeasurementDecimal(minimum);
  const maximumScaled = parseMeasurementDecimal(maximum);

  if (minimumScaled === null || maximumScaled === null) {
    throw new MeasurementValidationError(
      'INVALID_TOLERANCE_BOUNDS',
      'The step tolerance bounds are not canonical six-place decimals.',
    );
  }

  if (minimumScaled > maximumScaled) {
    throw new MeasurementValidationError(
      'INVALID_TOLERANCE_BOUNDS',
      'The step minimum is greater than its maximum.',
    );
  }

  return { minimumScaled, maximumScaled };
}

/** Inclusive comparison: minimum <= value <= maximum. */
export function evaluateMeasurementValue(
  value: unknown,
  bounds: ToleranceBounds,
): EvaluatedMeasurement {
  const scaledValue = parseMeasurementDecimal(value);

  if (scaledValue === null) {
    throw new MeasurementValidationError(
      'INVALID_MEASUREMENT_VALUE',
      'The simulator returned a value outside the canonical measurement range.',
    );
  }

  return {
    value: formatMeasurementDecimal(scaledValue),
    scaledValue,
    isWithinTolerance:
      bounds.minimumScaled <= scaledValue &&
      scaledValue <= bounds.maximumScaled,
  };
}

/**
 * Adds one sample to the preserved failure state. The first failure index is
 * never replaced or cleared by a later normal sample.
 */
export function advanceFailureProgress(
  current: FailureProgress,
  sampleIndex: number,
  isWithinTolerance: boolean,
): FailureProgress {
  if (isWithinTolerance) {
    return current;
  }

  return {
    outOfToleranceCount: current.outOfToleranceCount + 1,
    firstFailureSampleIndex: current.firstFailureSampleIndex ?? sampleIndex,
  };
}

/** A step passes only when it recorded at least one sample and no violation. */
export function stepOutcome(
  outOfToleranceCount: number,
  recordedCount: number,
): RunOutcome {
  if (recordedCount < 1) {
    throw new MeasurementValidationError(
      'INVALID_MEASUREMENT_VALUE',
      'A completed step must have at least one recorded sample.',
    );
  }

  return outOfToleranceCount === 0 ? 'PASSED' : 'FAILED';
}

/**
 * PASSED requires every step to be COMPLETED/PASSED and every expected sample
 * to exist. A single failed step makes the whole run FAILED.
 */
export function runOutcome(
  stepOutcomes: readonly (RunOutcome | null)[],
  recordedSampleCount: number,
  expectedSampleCount: number,
): RunOutcome {
  if (
    stepOutcomes.length === 0 ||
    recordedSampleCount !== expectedSampleCount
  ) {
    throw new MeasurementValidationError(
      'INVALID_MEASUREMENT_VALUE',
      'A run cannot complete before every expected sample is recorded.',
    );
  }

  return stepOutcomes.every((outcome) => outcome === 'PASSED')
    ? 'PASSED'
    : 'FAILED';
}

/**
 * Summarises recorded samples exactly. Minimum and maximum are exact sample
 * values; the average rounds half away from zero at the sixth decimal place.
 * With no samples every numeric field is null, never zero.
 */
export function calculateStatistics(values: readonly bigint[]): StepStatistics {
  if (values.length === 0) {
    return {
      minimum: null,
      maximum: null,
      average: null,
      sampleCount: 0,
    };
  }

  let minimum = values[0]!;
  let maximum = values[0]!;
  let total = 0n;

  for (const value of values) {
    if (value < minimum) {
      minimum = value;
    }
    if (value > maximum) {
      maximum = value;
    }
    total += value;
  }

  return {
    minimum: formatMeasurementDecimal(minimum),
    maximum: formatMeasurementDecimal(maximum),
    average: formatMeasurementDecimal(
      roundedDivide(total, BigInt(values.length)),
    ),
    sampleCount: values.length,
  };
}

/** Exact division rounded half away from zero, in micro-units. */
function roundedDivide(total: bigint, count: bigint): bigint {
  if (count <= 0n) {
    throw new RangeError('The divisor must be positive.');
  }

  const negative = total < 0n;
  const magnitude = negative ? -total : total;
  const quotient = magnitude / count;
  const remainder = magnitude % count;
  const rounded = remainder * 2n >= count ? quotient + 1n : quotient;

  return negative ? -rounded : rounded;
}

function formatMagnitude(magnitude: bigint): string {
  const integerPart = magnitude / MEASUREMENT_SCALE_FACTOR;
  const fractionPart = (magnitude % MEASUREMENT_SCALE_FACTOR)
    .toString()
    .padStart(MEASUREMENT_SCALE, '0');

  return `${integerPart.toString()}.${fractionPart}`;
}
