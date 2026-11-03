import { FormControl, FormGroup, Validators } from '@angular/forms';
import { describe, expect, it } from 'vitest';
import {
  MAX_SEED,
  RunStartAttempt,
  applyScenarioValidation,
  buildStartRunRequest,
  probabilityValue,
  seedValue,
} from './run-start-form';
import type { RunStartFormControls, RunStartFormValue } from './run-start-form';
import type { RunScenario } from './runs-api.types';

function valueControl(value: string): FormControl<string> {
  return new FormControl(value, { nonNullable: true });
}

function formWith(value: Partial<RunStartFormValue> = {}) {
  return new FormGroup<RunStartFormControls>({
    scenario: new FormControl<RunScenario>(value.scenario ?? 'NORMAL', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    seed: valueControl(value.seed ?? '42'),
    failureStepId: valueControl(value.failureStepId ?? ''),
    errorProbability: valueControl(value.errorProbability ?? ''),
  });
}

describe('start run form validation', () => {
  it('accepts only uint32 seed text and trims surrounding whitespace', () => {
    for (const value of ['0', String(MAX_SEED), ' 42 ']) {
      expect(seedValue(valueControl(value))).toBeNull();
    }

    for (const value of ['-1', '4294967296', '1.5', '1e3', '0x10', 'abc']) {
      expect(seedValue(valueControl(value))).toEqual({ seed: true });
    }
  });

  it('accepts only canonical probabilities between 0 and 1 with six decimals', () => {
    for (const value of ['0', '1', '0.05', '0.123456', ' 0.050000 ', '1.000000']) {
      expect(probabilityValue(valueControl(value))).toBeNull();
    }

    for (const value of [
      '-0.1',
      '1.000001',
      '0.1234567',
      '1e-2',
      '0,05',
      '2',
      '00.5',
      'abc',
    ]) {
      expect(probabilityValue(valueControl(value))).toEqual({ probability: true });
    }
  });

  it('requires a failure step only for FORCED_FAILURE and a probability only for RANDOM', () => {
    const form = formWith();

    applyScenarioValidation(form, 'NORMAL');
    expect(form.valid).toBe(true);

    applyScenarioValidation(form, 'FORCED_FAILURE');
    expect(form.controls.failureStepId.hasError('required')).toBe(true);
    expect(form.controls.errorProbability.hasError('required')).toBe(false);

    form.controls.failureStepId.setValue('11111111-1111-4111-8111-111111111111');
    expect(form.valid).toBe(true);

    applyScenarioValidation(form, 'RANDOM');
    expect(form.controls.failureStepId.hasError('required')).toBe(false);
    expect(form.controls.errorProbability.hasError('required')).toBe(true);

    form.controls.errorProbability.setValue('0.25');
    expect(form.valid).toBe(true);
  });
});

describe('start run payload', () => {
  const VERSION_ID = '22222222-2222-4222-8222-222222222222';

  it('sends only plan version, scenario, and seed for NORMAL', () => {
    expect(
      buildStartRunRequest(VERSION_ID, {
        scenario: 'NORMAL',
        seed: ' 4294967295 ',
        failureStepId: 'ignored',
        errorProbability: '0.5',
      }),
    ).toEqual({
      planVersionId: VERSION_ID,
      scenario: 'NORMAL',
      seed: 4294967295,
    });
  });

  it('sends the selected failure step for FORCED_FAILURE', () => {
    expect(
      buildStartRunRequest(VERSION_ID, {
        scenario: 'FORCED_FAILURE',
        seed: '7',
        failureStepId: ' 33333333-3333-4333-8333-333333333333 ',
        errorProbability: '0.5',
      }),
    ).toEqual({
      planVersionId: VERSION_ID,
      scenario: 'FORCED_FAILURE',
      seed: 7,
      failureStepId: '33333333-3333-4333-8333-333333333333',
    });
  });

  it('sends the probability as decimal text for RANDOM', () => {
    expect(
      buildStartRunRequest(VERSION_ID, {
        scenario: 'RANDOM',
        seed: '0',
        failureStepId: 'ignored',
        errorProbability: ' 0.050000 ',
      }),
    ).toEqual({
      planVersionId: VERSION_ID,
      scenario: 'RANDOM',
      seed: 0,
      errorProbability: '0.050000',
    });
  });

  it('refuses to invent a missing seed or scenario setting', () => {
    expect(() =>
      buildStartRunRequest(VERSION_ID, {
        scenario: 'NORMAL',
        seed: '',
        failureStepId: '',
        errorProbability: '',
      }),
    ).toThrow();

    expect(() =>
      buildStartRunRequest(VERSION_ID, {
        scenario: 'FORCED_FAILURE',
        seed: '1',
        failureStepId: '',
        errorProbability: '',
      }),
    ).toThrow();

    expect(() =>
      buildStartRunRequest(VERSION_ID, {
        scenario: 'RANDOM',
        seed: '1',
        failureStepId: '',
        errorProbability: '2',
      }),
    ).toThrow();
  });
});

describe('RunStartAttempt', () => {
  const REQUEST = {
    planVersionId: '22222222-2222-4222-8222-222222222222',
    scenario: 'NORMAL' as const,
    seed: 42,
  };

  it('reuses the key for the same request and creates a new one after a change', () => {
    let sequence = 0;
    const attempt = new RunStartAttempt(() => `key-${++sequence}`);

    expect(attempt.keyFor(REQUEST)).toBe('key-1');
    expect(attempt.keyFor({ ...REQUEST })).toBe('key-1');

    expect(attempt.keyFor({ ...REQUEST, seed: 43 })).toBe('key-2');
    expect(attempt.keyFor({ ...REQUEST, seed: 43 })).toBe('key-2');

    attempt.reset();
    expect(attempt.keyFor(REQUEST)).toBe('key-3');
  });

  it('keeps the key stable when optional settings are absent', () => {
    let sequence = 0;
    const attempt = new RunStartAttempt(() => `key-${++sequence}`);

    const forced = {
      ...REQUEST,
      scenario: 'FORCED_FAILURE' as const,
      failureStepId: '33333333-3333-4333-8333-333333333333',
    };

    expect(attempt.keyFor(forced)).toBe('key-1');
    expect(attempt.keyFor({ ...forced })).toBe('key-1');
    expect(attempt.keyFor({ ...forced, failureStepId: '44444444-4444-4444-8444-444444444444' })).toBe(
      'key-2',
    );
  });
});
