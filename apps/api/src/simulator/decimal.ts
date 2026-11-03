/**
 * Fixed-point decimal helpers for the simulator.
 *
 * Limits, probabilities and generated values are represented as integers scaled
 * by 10^6 (one micro-unit). No binary floating-point arithmetic is used for a
 * value that can end up in a measurement, so inclusive limits and the exact
 * six-fraction-digit output do not depend on the JavaScript number type.
 */
export const SIMULATOR_SCALE = 6;
export const SIMULATOR_SCALE_FACTOR = 1_000_000n;

/** Accepted limit magnitude: |value| <= 1,000,000,000. */
export const MAX_ABSOLUTE_SCALED = 1_000_000_000n * SIMULATOR_SCALE_FACTOR;

const MAX_INTEGER_DIGITS = 10;
const MAX_TEXT_LENGTH = 32;
const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;

/**
 * Parses a canonical decimal string into micro-units, or returns null.
 *
 * The accepted form is the same as the plan API: an optional minus sign, a
 * canonical integer part, an optional dot and one to six fractional digits.
 * Scientific notation, commas, whitespace, NaN, Infinity and values outside
 * +/-1,000,000,000 are rejected.
 */
export function parseSimulatorDecimal(value: unknown): bigint | null {
  if (
    typeof value !== 'string' ||
    value.length > MAX_TEXT_LENGTH ||
    !DECIMAL_PATTERN.test(value)
  ) {
    return null;
  }

  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [integerPart = '0', fractionPart = ''] = unsigned.split('.');

  if (integerPart.length > MAX_INTEGER_DIGITS) {
    return null;
  }

  const scaled =
    BigInt(integerPart) * SIMULATOR_SCALE_FACTOR +
    BigInt(fractionPart.padEnd(SIMULATOR_SCALE, '0'));
  const magnitude = negative ? -scaled : scaled;

  if (magnitude > MAX_ABSOLUTE_SCALED || magnitude < -MAX_ABSOLUTE_SCALED) {
    return null;
  }

  return magnitude;
}

/**
 * Formats micro-units as the canonical API representation with exactly six
 * fractional digits. Values slightly beyond the accepted input range (which a
 * forced failure may produce) are formatted without clamping.
 */
export function formatSimulatorDecimal(value: bigint): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const integerPart = magnitude / SIMULATOR_SCALE_FACTOR;
  const fractionPart = (magnitude % SIMULATOR_SCALE_FACTOR)
    .toString()
    .padStart(SIMULATOR_SCALE, '0');

  return `${negative ? '-' : ''}${integerPart.toString()}.${fractionPart}`;
}
