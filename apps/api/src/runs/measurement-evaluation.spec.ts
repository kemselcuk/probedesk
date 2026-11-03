import { describe, expect, it } from 'vitest';
import {
  advanceFailureProgress,
  calculateStatistics,
  evaluateMeasurementValue,
  formatMeasurementDecimal,
  parseMeasurementDecimal,
  parseToleranceBounds,
  runOutcome,
  stepOutcome,
} from './measurement-evaluation.js';

describe('measurement evaluation (T01–T05)', () => {
  it('accepts both inclusive boundaries and rejects one micro-unit outside', () => {
    const bounds = parseToleranceBounds('4.750000', '5.250000');

    expect(evaluateMeasurementValue('4.750000', bounds).isWithinTolerance).toBe(
      true,
    );
    expect(evaluateMeasurementValue('5.250000', bounds).isWithinTolerance).toBe(
      true,
    );
    expect(evaluateMeasurementValue('4.749999', bounds).isWithinTolerance).toBe(
      false,
    );
    expect(evaluateMeasurementValue('5.250001', bounds).isWithinTolerance).toBe(
      false,
    );
  });

  it('treats an equal minimum and maximum as a single accepted value', () => {
    const same = parseToleranceBounds('1.000000', '1.000000');

    expect(evaluateMeasurementValue('1.000000', same)).toMatchObject({
      value: '1.000000',
      isWithinTolerance: true,
    });
    expect(evaluateMeasurementValue('1.000001', same).isWithinTolerance).toBe(
      false,
    );
    expect(evaluateMeasurementValue('0.999999', same).isWithinTolerance).toBe(
      false,
    );
    expect(evaluateMeasurementValue('-0.000000', same).isWithinTolerance).toBe(
      false,
    );
  });

  it('compares negative values with the same inclusive rule', () => {
    const bounds = parseToleranceBounds('-0.550000', '-0.450000');

    expect(
      evaluateMeasurementValue('-0.550000', bounds).isWithinTolerance,
    ).toBe(true);
    expect(
      evaluateMeasurementValue('-0.450000', bounds).isWithinTolerance,
    ).toBe(true);
    expect(
      evaluateMeasurementValue('-0.550001', bounds).isWithinTolerance,
    ).toBe(false);
  });

  it('rejects non-canonical, non-finite and out-of-range simulator output', () => {
    for (const value of [
      'NaN',
      'Infinity',
      '-Infinity',
      '1e-6',
      '0,500000',
      ' 1.000000',
      '1.0000000',
      '1',
      '.500000',
      '01.000000',
      '1000000000000.000000',
      1,
      null,
      undefined,
    ]) {
      expect(parseMeasurementDecimal(value), String(value)).toBeNull();
    }

    expect(parseMeasurementDecimal('999999999999.999999')).toBe(
      999_999_999_999_999_999n,
    );
    expect(parseMeasurementDecimal('-999999999999.999999')).toBe(
      -999_999_999_999_999_999n,
    );
    expect(formatMeasurementDecimal(0n)).toBe('0.000000');
  });

  it('does not clear the first out-of-tolerance sample', () => {
    const first = advanceFailureProgress(
      { outOfToleranceCount: 0, firstFailureSampleIndex: null },
      2,
      false,
    );
    const afterNormal = advanceFailureProgress(first, 3, true);
    const afterSecondFailure = advanceFailureProgress(afterNormal, 4, false);

    expect(first).toEqual({
      outOfToleranceCount: 1,
      firstFailureSampleIndex: 2,
    });
    expect(afterNormal).toEqual(first);
    expect(afterSecondFailure).toEqual({
      outOfToleranceCount: 2,
      firstFailureSampleIndex: 2,
    });
  });

  it('derives step and run outcomes without trusting client verdicts', () => {
    expect(stepOutcome(0, 2)).toBe('PASSED');
    expect(stepOutcome(1, 2)).toBe('FAILED');
    expect(() => stepOutcome(0, 0)).toThrow();

    expect(runOutcome(['PASSED', 'PASSED'], 4, 4)).toBe('PASSED');
    expect(runOutcome(['PASSED', 'FAILED'], 4, 4)).toBe('FAILED');
    expect(() => runOutcome(['PASSED'], 3, 4)).toThrow();
    expect(() => runOutcome([], 0, 0)).toThrow();
  });

  it('summarises recorded samples exactly, with nulls when empty', () => {
    expect(calculateStatistics([])).toEqual({
      minimum: null,
      maximum: null,
      average: null,
      sampleCount: 0,
    });

    expect(calculateStatistics([1_000_000n, 2_000_000n, 3_000_000n])).toEqual({
      minimum: '1.000000',
      maximum: '3.000000',
      average: '2.000000',
      sampleCount: 3,
    });

    expect(calculateStatistics([1_000_000n, 1_000_001n])).toEqual({
      minimum: '1.000000',
      maximum: '1.000001',
      average: '1.000001',
      sampleCount: 2,
    });

    expect(calculateStatistics([-1_000_000n, -1_000_001n])).toEqual({
      minimum: '-1.000001',
      maximum: '-1.000000',
      average: '-1.000001',
      sampleCount: 2,
    });
  });
});
