/**
 * Canonical decimal text helper for tolerance limits.
 *
 * The API accepts plain decimal strings only: no exponent, no comma, no
 * surrounding whitespace and at most six fractional digits. Values inside the
 * accepted range fit NUMERIC(18,6) because the integer part is at most ten
 * digits (|value| <= 1,000,000,000).
 */
export const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;

const MAX_INTEGER_DIGITS = 10;
const SCALE = 6;
const SCALE_FACTOR = 10n ** BigInt(SCALE);
export const MAX_ABSOLUTE_SCALED = 1_000_000_000n * SCALE_FACTOR;

/** Parses a canonical decimal string to a bigint scaled by 10^6, or null. */
export function parseScaledDecimal(value: string): bigint | null {
  if (value.length > 32 || !DECIMAL_PATTERN.test(value)) {
    return null;
  }

  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [integerPart = '0', fractionPart = ''] = unsigned.split('.');

  if (integerPart.length > MAX_INTEGER_DIGITS) {
    return null;
  }

  const scaled =
    BigInt(integerPart) * SCALE_FACTOR +
    BigInt(fractionPart.padEnd(SCALE, '0'));
  const magnitude = negative ? -scaled : scaled;

  if (magnitude > MAX_ABSOLUTE_SCALED || magnitude < -MAX_ABSOLUTE_SCALED) {
    return null;
  }

  return magnitude;
}

/** Formats a Prisma Decimal as the canonical API string with six decimals. */
export function formatScaledDecimal(value: {
  toFixed(digits: number): string;
}): string {
  return value.toFixed(SCALE);
}

/** True when a string fits the accepted canonical decimal contract. */
export function isCanonicalDecimal(value: string): boolean {
  return parseScaledDecimal(value) !== null;
}
