import { describe, expect, it } from 'vitest';
import { Prisma } from '../prisma/generated/client.js';
import {
  formatScaledDecimal,
  isCanonicalDecimal,
  parseScaledDecimal,
} from './plan-decimal.js';

describe('canonical decimal input', () => {
  it('accepts canonical decimal strings at the range and precision edges', () => {
    expect(parseScaledDecimal('0')).toBe(0n);
    expect(parseScaledDecimal('5.25')).toBe(5_250_000n);
    expect(parseScaledDecimal('0.000001')).toBe(1n);
    expect(parseScaledDecimal('-0.000001')).toBe(-1n);
    expect(parseScaledDecimal('1000000000.000000')).toBe(
      1_000_000_000_000_000n,
    );
    expect(parseScaledDecimal('-1000000000.000000')).toBe(
      -1_000_000_000_000_000n,
    );
  });

  it('rejects exponent, comma, whitespace, NaN, Infinity and over-precision', () => {
    for (const value of [
      '',
      ' 1',
      '1 ',
      '1,5',
      '5e2',
      '.5',
      '00.5',
      '1.1234567',
      'NaN',
      'Infinity',
      '-Infinity',
      '1000000001',
      '99999999999999999999',
    ]) {
      expect(isCanonicalDecimal(value), value).toBe(false);
    }
  });

  it('formats Prisma decimals with exactly six fractional digits', () => {
    expect(formatScaledDecimal(new Prisma.Decimal('5.5'))).toBe('5.500000');
    expect(formatScaledDecimal(new Prisma.Decimal('-0.25'))).toBe('-0.250000');
    expect(formatScaledDecimal(new Prisma.Decimal(0))).toBe('0.000000');
  });
});
