import { FormControl, FormGroup } from '@angular/forms';
import { describe, expect, it } from 'vitest';
import {
  MAX_NOMINAL_DURATION_MS,
  MAX_TOTAL_SAMPLES,
  decimalString,
  draftFingerprint,
  formatDuration,
  nominalTotals,
  planTotalsValidator,
  scaledDecimal,
  stepLimitValidator,
  stepRangeValidator,
  toSaveDraftStep,
  trimmedMaxLength,
  trimmedRequired,
  type StepFormValue,
} from './plan-draft-form';

function step(overrides: Partial<StepFormValue> = {}): StepFormValue {
  return {
    clientId: 'client-1',
    logicalStepId: 'step-1',
    name: 'Voltage',
    unit: 'V',
    minimum: '0',
    maximum: '5',
    sampleCount: 10,
    intervalMs: 1000,
    ...overrides,
  };
}

function valueControl(value: string): FormControl<string> {
  return new FormControl(value, { nonNullable: true });
}

function stepGroup(minimum: string, maximum: string): FormGroup {
  return new FormGroup(
    {
      minimum: new FormControl(minimum, { nonNullable: true }),
      maximum: new FormControl(maximum, { nonNullable: true }),
    },
    { validators: stepRangeValidator },
  );
}

function stepsValueControl(steps: readonly StepFormValue[]): FormControl<StepFormValue[]> {
  return new FormControl([...steps], { nonNullable: true });
}

describe('plan draft validation', () => {
  it('requires a non-blank value after trimming and enforces trimmed lengths', () => {
    expect(trimmedRequired(valueControl('   '))).toEqual({ required: true });
    expect(trimmedRequired(valueControl(' Voltage '))).toBeNull();

    const limit = trimmedMaxLength(10);
    expect(limit(valueControl('  1234567890  '))).toBeNull();
    expect(limit(valueControl('  12345678901  '))).toEqual({
      maxlength: { requiredLength: 10, actualLength: 11 },
    });
  });

  it('accepts only canonical decimal strings with at most six decimals', () => {
    for (const value of [
      '4.75',
      ' 4.75 ',
      '-1000000000',
      '1000000000',
      '0.123456',
      '999999999.999999',
    ]) {
      expect(decimalString(valueControl(value))).toBeNull();
    }

    for (const value of ['1e3', '1,5', '.5', '1.', '01', '00.5', '+1', 'NaN', 'Infinity']) {
      expect(decimalString(valueControl(value))).toEqual({ decimalFormat: true });
    }

    expect(decimalString(valueControl('0.1234567'))).toEqual({
      decimalPlaces: { max: 6 },
    });
    expect(decimalString(valueControl('1000000000.000001'))).toEqual({
      decimalRange: { min: '-1000000000', max: '1000000000' },
    });
    expect(decimalString(valueControl('-1000000000.000001'))).toEqual({
      decimalRange: { min: '-1000000000', max: '1000000000' },
    });
    expect(decimalString(valueControl(''))).toBeNull();
  });

  it('compares decimal boundaries with scaled integers instead of floats', () => {
    expect(scaledDecimal('5')).toBe(5_000_000n);
    expect(scaledDecimal('4.75')).toBe(4_750_000n);
    expect(scaledDecimal('-0.000001')).toBe(-1n);
    expect(scaledDecimal('1.1234567')).toBeNull();

    expect(stepGroup('5', '5').errors).toBeNull();
    expect(stepGroup('4.75', '5.25').errors).toBeNull();
    expect(stepGroup('5.000001', '5').errors).toEqual({
      minimumGreaterThanMaximum: true,
    });
  });

  it('enforces sample and duration totals at their exact limits', () => {
    const atLimits = stepsValueControl([step({ sampleCount: 10_000, intervalMs: 60 })]);
    expect(planTotalsValidator(atLimits)).toBeNull();

    expect(
      planTotalsValidator(
        stepsValueControl([step({ sampleCount: MAX_TOTAL_SAMPLES + 1, intervalMs: 1 })]),
      ),
    ).toEqual({
      totalSamples: { max: MAX_TOTAL_SAMPLES, actual: MAX_TOTAL_SAMPLES + 1 },
    });

    expect(
      planTotalsValidator(
        stepsValueControl([
          step({ sampleCount: 1000, intervalMs: 600 }),
          step({ sampleCount: 1, intervalMs: 1 }),
        ]),
      ),
    ).toEqual({
      totalDuration: {
        max: MAX_NOMINAL_DURATION_MS,
        actual: MAX_NOMINAL_DURATION_MS + 1,
      },
    });

    expect(planTotalsValidator(stepsValueControl([]))).toBeNull();
  });

  it('limits the draft to thirty steps while allowing zero', () => {
    const thirty = Array.from({ length: 30 }, (_, index) => step({ clientId: `c-${index}` }));
    const thirtyOne = [...thirty, step({ clientId: 'c-31' })];

    expect(stepLimitValidator(stepsValueControl(thirty))).toBeNull();
    expect(stepLimitValidator(stepsValueControl(thirtyOne))).toEqual({
      stepLimit: { max: 30, actual: 31 },
    });
    expect(stepLimitValidator(stepsValueControl([]))).toBeNull();
  });

  it('computes nominal totals and formats durations for the summary', () => {
    const totals = nominalTotals([
      step({ sampleCount: 10, intervalMs: 1000 }),
      step({ sampleCount: 5, intervalMs: 2000 }),
    ]);

    expect(totals).toEqual({
      stepCount: 2,
      totalSamples: 15,
      totalDurationMs: 20_000,
    });
    expect(formatDuration(500)).toBe('500 ms');
    expect(formatDuration(20_000)).toBe('20.0 s');
    expect(formatDuration(90_000)).toBe('1 min 30 s');
    expect(formatDuration(MAX_NOMINAL_DURATION_MS)).toBe('10 min 0 s');
  });

  it('trims the wire payload and fingerprints only editable content', () => {
    const first = step({ name: '  Voltage  ', unit: ' V ', minimum: ' 4.75 ' });
    const sameContent = step({
      logicalStepId: 'other',
      clientId: 'other-client',
      minimum: '4.75',
    });
    const other = step({ name: 'Current' });

    expect(toSaveDraftStep(first)).toEqual({
      logicalStepId: 'step-1',
      name: 'Voltage',
      unit: 'V',
      minimum: '4.75',
      maximum: '5',
      sampleCount: 10,
      intervalMs: 1000,
    });
    expect(draftFingerprint(' Plan ', [first])).toBe(draftFingerprint('Plan', [sameContent]));
    expect(draftFingerprint('Plan', [first, other])).not.toBe(
      draftFingerprint('Plan', [other, first]),
    );
  });
});
