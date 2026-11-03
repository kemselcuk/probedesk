import { describe, expect, it, vi } from 'vitest';
import {
  SIMULATOR_VERSION,
  SimulatorInputError,
  simulate,
  type SimulationInput,
  type SimulatorErrorCode,
  type SimulatorStepDefinition,
} from './simulator.js';

const CANONICAL_VALUE = /^-?(?:0|[1-9]\d*)\.\d{6}$/;

const voltageStep = {
  logicalStepId: '11111111-1111-4111-8111-111111111111',
  name: 'Output Voltage',
  unit: 'V',
  minimum: '4.750000',
  maximum: '5.250000',
  sampleCount: 30,
  intervalMs: 200,
} satisfies SimulatorStepDefinition;

const currentStep = {
  logicalStepId: '22222222-2222-4222-8222-222222222222',
  name: 'Current Draw',
  unit: 'A',
  minimum: '0.450000',
  maximum: '0.550000',
  sampleCount: 30,
  intervalMs: 200,
} satisfies SimulatorStepDefinition;

const temperatureStep = {
  logicalStepId: '33333333-3333-4333-8333-333333333333',
  name: 'Case Temperature',
  unit: '°C',
  minimum: '20',
  maximum: '60',
  sampleCount: 30,
  intervalMs: 200,
} satisfies SimulatorStepDefinition;

/**
 * Values below were produced by an independent reference implementation of
 * the algorithm documented in `simulator.ts` and `docs/decisions/0009-*`.
 * They are intentionally hard-coded: a change to the PRNG, call order or
 * mapping must fail these tests and require a new simulatorVersion.
 */
const NORMAL_CURRENT_GOLDEN: readonly string[] = [
  '0.452902',
  '0.452359',
  '0.509971',
  '0.453224',
  '0.543303',
  '0.527520',
  '0.468372',
  '0.495663',
  '0.546715',
  '0.532772',
  '0.529725',
  '0.472896',
  '0.455627',
  '0.521505',
  '0.541052',
  '0.508154',
  '0.477379',
  '0.455761',
  '0.549549',
  '0.476151',
  '0.524918',
  '0.524995',
  '0.530585',
  '0.506404',
  '0.470169',
  '0.512796',
  '0.494422',
  '0.484088',
  '0.532606',
  '0.500105',
];

const RANDOM_ZERO_CURRENT_GOLDEN: readonly string[] = [
  '0.527965',
  '0.536998',
  '0.494066',
  '0.451999',
  '0.470780',
  '0.547835',
  '0.495853',
  '0.453657',
  '0.489516',
  '0.522120',
  '0.509971',
  '0.527520',
  '0.546715',
  '0.472896',
  '0.541052',
  '0.455761',
  '0.524918',
  '0.506404',
  '0.494422',
  '0.500105',
  '0.468569',
  '0.509223',
  '0.468551',
  '0.511308',
  '0.455606',
  '0.538165',
  '0.519876',
  '0.452018',
  '0.473220',
  '0.514203',
];

const RANDOM_ONE_CURRENT_GOLDEN: readonly string[] = [
  '0.588983',
  '0.406501',
  '0.572033',
  '0.551000',
  '0.560391',
  '0.401082',
  '0.572927',
  '0.551829',
  '0.430242',
  '0.586061',
  '0.420014',
  '0.588760',
  '0.401642',
  '0.561448',
  '0.595526',
  '0.447119',
  '0.412541',
  '0.578203',
  '0.572211',
  '0.575053',
  '0.559285',
  '0.579612',
  '0.440724',
  '0.580654',
  '0.447196',
  '0.594083',
  '0.584939',
  '0.551010',
  '0.561611',
  '0.582102',
];

function valuesOf(result: ReturnType<typeof simulate>, index = 0): string[] {
  return result.steps[index].samples.map((sample) => sample.value);
}

function microUnits(value: string): bigint {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [integerPart = '0', fractionPart = ''] = unsigned.split('.');
  const magnitude =
    BigInt(integerPart) * 1_000_000n + BigInt(fractionPart.padEnd(6, '0'));

  return negative ? -magnitude : magnitude;
}

function expectAllWithin(
  values: readonly string[],
  minimum: string,
  maximum: string,
): void {
  const minimumScaled = microUnits(minimum);
  const maximumScaled = microUnits(maximum);

  for (const value of values) {
    expect(
      microUnits(value) >= minimumScaled && microUnits(value) <= maximumScaled,
      `${value} must be within [${minimum}, ${maximum}]`,
    ).toBe(true);
  }
}

function outsideIndices(
  values: readonly string[],
  minimum: string,
  maximum: string,
): number[] {
  const minimumScaled = microUnits(minimum);
  const maximumScaled = microUnits(maximum);

  return values.flatMap((value, index) => {
    const scaled = microUnits(value);
    return scaled < minimumScaled || scaled > maximumScaled ? [index] : [];
  });
}

function makeStep(
  overrides: Record<string, unknown>,
): SimulatorStepDefinition {
  return {
    ...currentStep,
    ...overrides,
  } as unknown as SimulatorStepDefinition;
}

function rawInput(value: Record<string, unknown>): SimulationInput {
  return value as unknown as SimulationInput;
}

function expectInputError(input: unknown, code: SimulatorErrorCode): void {
  let caught: unknown;

  try {
    simulate(input as SimulationInput);
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(SimulatorInputError);
  expect((caught as SimulatorInputError).code).toBe(code);
}

describe('NORMAL simulation', () => {
  it('matches the documented golden sequence for a negative range', () => {
    const step = makeStep({
      name: 'Small negative range',
      unit: 'u',
      minimum: '-1.250000',
      maximum: '1.250000',
      sampleCount: 8,
      intervalMs: 100,
    });
    const result = simulate({ scenario: 'NORMAL', seed: 12345, steps: [step] });

    expect(result.simulatorVersion).toBe(SIMULATOR_VERSION);
    expect(valuesOf(result)).toEqual([
      '1.199321',
      '-0.483120',
      '-0.039486',
      '0.794836',
      '0.023571',
      '-0.381321',
      '-1.065607',
      '0.665991',
    ]);
    for (const value of valuesOf(result)) {
      expect(value).toMatch(CANONICAL_VALUE);
      expect(value).not.toBe('-0.000000');
    }
  });

  it('matches the Demo Current Draw golden fixture and stays inclusive', () => {
    const result = simulate({
      scenario: 'NORMAL',
      seed: 20261103,
      steps: [voltageStep, currentStep, temperatureStep],
    });

    expect(result.steps.map((step) => step.logicalStepId)).toEqual([
      voltageStep.logicalStepId,
      currentStep.logicalStepId,
      temperatureStep.logicalStepId,
    ]);
    expect(valuesOf(result, 0)).toHaveLength(30);
    expect(valuesOf(result, 1)).toEqual(NORMAL_CURRENT_GOLDEN);
    expect(valuesOf(result, 2)).toHaveLength(30);
    expectAllWithin(valuesOf(result, 0), '4.750000', '5.250000');
    expectAllWithin(valuesOf(result, 1), '0.450000', '0.550000');
    expectAllWithin(valuesOf(result, 2), '20', '60');
  });

  it('returns the inclusive minimum and maximum for a one-micro-unit span', () => {
    const step = makeStep({
      minimum: '0',
      maximum: '0.000001',
      sampleCount: 1,
    });

    expect(
      valuesOf(simulate({ scenario: 'NORMAL', seed: 0, steps: [step] })),
    ).toEqual(['0.000000']);
    expect(
      valuesOf(simulate({ scenario: 'NORMAL', seed: 1, steps: [step] })),
    ).toEqual(['0.000001']);
  });

  it('returns the constant value when minimum equals maximum', () => {
    const step = makeStep({
      minimum: '-5.250000',
      maximum: '-5.250000',
      sampleCount: 3,
    });

    expect(
      valuesOf(simulate({ scenario: 'NORMAL', seed: 7, steps: [step] })),
    ).toEqual(['-5.250000', '-5.250000', '-5.250000']);
  });

  it('supports seed 0 and the largest uint32 seed', () => {
    const seedZero = valuesOf(
      simulate({ scenario: 'NORMAL', seed: 0, steps: [currentStep] }),
    );
    const maxSeed = valuesOf(
      simulate({
        scenario: 'NORMAL',
        seed: 4_294_967_295,
        steps: [currentStep],
      }),
    );

    expect(seedZero[0]).toBe('0.476643');
    expect(maxSeed[0]).toBe('0.539643');
    expectAllWithin(seedZero, '0.450000', '0.550000');
    expectAllWithin(maxSeed, '0.450000', '0.550000');
  });

  it('keeps step order and zero-based sample indexes', () => {
    const first = makeStep({ logicalStepId: 'first', sampleCount: 2 });
    const second = makeStep({ logicalStepId: 'second', sampleCount: 3 });
    const result = simulate({
      scenario: 'NORMAL',
      seed: 5,
      steps: [first, second],
    });

    expect(result.steps.map((step) => step.logicalStepId)).toEqual([
      'first',
      'second',
    ]);
    expect(
      result.steps.map((step) => step.samples.map((sample) => sample.sampleIndex)),
    ).toEqual([
      [0, 1],
      [0, 1, 2],
    ]);
  });
});

describe('FORCED_FAILURE simulation', () => {
  it('produces exactly one out-of-tolerance sample at the Demo midpoint', () => {
    const result = simulate({
      scenario: 'FORCED_FAILURE',
      seed: 20261103,
      failureStepId: currentStep.logicalStepId,
      steps: [voltageStep, currentStep, temperatureStep],
    });
    const currentValues = valuesOf(result, 1);
    const expected = [
      ...NORMAL_CURRENT_GOLDEN.slice(0, 14),
      '0.600000',
      ...NORMAL_CURRENT_GOLDEN.slice(15),
    ];

    expect(currentValues).toEqual(expected);
    expect(result.steps[1].samples[14]).toEqual({
      sampleIndex: 14,
      value: '0.600000',
    });
    expect(outsideIndices(currentValues, '0.450000', '0.550000')).toEqual([
      14,
    ]);
    expectAllWithin(
      currentValues.filter((_, index) => index !== 14),
      '0.450000',
      '0.550000',
    );
    expectAllWithin(valuesOf(result, 0), '4.750000', '5.250000');
    expectAllWithin(valuesOf(result, 2), '20', '60');
  });

  it('fails the only sample of a one-sample step', () => {
    const step = makeStep({
      logicalStepId: 'one',
      minimum: '0',
      maximum: '1',
      sampleCount: 1,
      intervalMs: 100,
    });
    const values = valuesOf(
      simulate({
        scenario: 'FORCED_FAILURE',
        seed: 7,
        failureStepId: 'one',
        steps: [step],
      }),
    );

    expect(values).toEqual(['1.500000']);
    expect(microUnits(values[0])).toBeGreaterThan(microUnits('1'));
  });

  it('places the forced sample at floor((sampleCount - 1) / 2)', () => {
    for (const [sampleCount, expectedIndex] of [
      [1, 0],
      [4, 1],
      [5, 2],
      [30, 14],
    ] as const) {
      const step = makeStep({
        logicalStepId: 'indexed',
        minimum: '0',
        maximum: '1',
        sampleCount,
        intervalMs: 100,
      });
      const values = valuesOf(
        simulate({
          scenario: 'FORCED_FAILURE',
          seed: 7,
          failureStepId: 'indexed',
          steps: [step],
        }),
      );

      expect(values.indexOf('1.500000'), String(sampleCount)).toBe(
        expectedIndex,
      );
    }
  });

  it('keeps equal bounds constant except at the forced index', () => {
    const step = makeStep({
      logicalStepId: 'equal',
      minimum: '-5.250000',
      maximum: '-5.250000',
      sampleCount: 4,
      intervalMs: 100,
    });
    const values = valuesOf(
      simulate({
        scenario: 'FORCED_FAILURE',
        seed: 7,
        failureStepId: 'equal',
        steps: [step],
      }),
    );

    expect(values).toEqual([
      '-5.250000',
      '-5.249999',
      '-5.250000',
      '-5.250000',
    ]);
  });

  it('rounds an odd micro-unit half-range upward', () => {
    const step = makeStep({
      logicalStepId: 'odd',
      minimum: '0',
      maximum: '0.000003',
      sampleCount: 5,
      intervalMs: 100,
    });
    const values = valuesOf(
      simulate({
        scenario: 'FORCED_FAILURE',
        seed: 7,
        failureStepId: 'odd',
        steps: [step],
      }),
    );

    expect(values).toEqual([
      '0.000000',
      '0.000000',
      '0.000005',
      '0.000002',
      '0.000002',
    ]);
    expect(microUnits(values[2])).toBe(5n);
  });

  it('forces above a negative upper bound', () => {
    const step = makeStep({
      logicalStepId: 'negative',
      minimum: '-5.25',
      maximum: '-4.75',
      sampleCount: 4,
      intervalMs: 100,
    });
    const values = valuesOf(
      simulate({
        scenario: 'FORCED_FAILURE',
        seed: 7,
        failureStepId: 'negative',
        steps: [step],
      }),
    );

    expect(values).toEqual([
      '-5.244148',
      '-4.500000',
      '-4.761546',
      '-4.900485',
    ]);
    expect(microUnits(values[1])).toBeGreaterThan(microUnits('-4.75'));
  });

  it('does not clamp a forced value beyond the accepted input range', () => {
    const step = makeStep({
      logicalStepId: 'maximum',
      minimum: '1000000000',
      maximum: '1000000000',
      sampleCount: 1,
      intervalMs: 100,
    });

    expect(
      valuesOf(
        simulate({
          scenario: 'FORCED_FAILURE',
          seed: 1,
          failureStepId: 'maximum',
          steps: [step],
        }),
      ),
    ).toEqual(['1000000000.000001']);
  });
});

describe('RANDOM simulation', () => {
  it('produces no failures at probability 0 with fixed call order', () => {
    const result = simulate({
      scenario: 'RANDOM',
      seed: 20261103,
      errorProbability: '0',
      steps: [currentStep],
    });
    const values = valuesOf(result);

    expect(values).toEqual(RANDOM_ZERO_CURRENT_GOLDEN);
    expect(outsideIndices(values, '0.450000', '0.550000')).toEqual([]);
  });

  it('produces only failures at probability 1', () => {
    const result = simulate({
      scenario: 'RANDOM',
      seed: 20261103,
      errorProbability: '1.000000',
      steps: [currentStep],
    });
    const values = valuesOf(result);

    expect(values).toEqual(RANDOM_ONE_CURRENT_GOLDEN);
    expect(outsideIndices(values, '0.450000', '0.550000')).toHaveLength(30);
  });

  it('follows the decision, direction, value order at probability 0.5', () => {
    const step = makeStep({
      logicalStepId: 'half',
      minimum: '0',
      maximum: '10',
      sampleCount: 8,
      intervalMs: 100,
    });
    const values = valuesOf(
      simulate({
        scenario: 'RANDOM',
        seed: 7,
        errorProbability: '0.5',
        steps: [step],
      }),
    );

    expect(values).toEqual([
      '-4.884539',
      '4.055217',
      '-2.766629',
      '1.559483',
      '1.971372',
      '-2.673698',
      '11.237668',
      '1.436574',
    ]);
    expect(outsideIndices(values, '0', '10')).toEqual([0, 2, 5, 6]);
  });

  it('keeps zero-width bounds constant except for random failures', () => {
    const step = makeStep({
      logicalStepId: 'equal',
      minimum: '0',
      maximum: '0',
      sampleCount: 4,
      intervalMs: 100,
    });

    expect(
      valuesOf(
        simulate({
          scenario: 'RANDOM',
          seed: 9,
          errorProbability: '0',
          steps: [step],
        }),
      ),
    ).toEqual(['0.000000', '0.000000', '0.000000', '0.000000']);
    expect(
      valuesOf(
        simulate({
          scenario: 'RANDOM',
          seed: 9,
          errorProbability: '1',
          steps: [step],
        }),
      ),
    ).toEqual(['0.000001', '0.000001', '0.000001', '0.000001']);
  });
});

describe('simulator input validation', () => {
  it('rejects an unknown scenario', () => {
    for (const scenario of ['BROKEN', 'normal', 42, undefined]) {
      expectInputError(
        rawInput({ scenario, seed: 1, steps: [currentStep] }),
        'INVALID_SCENARIO',
      );
    }
  });

  it('rejects malformed seeds', () => {
    for (const seed of [
      -1,
      4_294_967_296,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '1',
      undefined,
    ]) {
      expectInputError(
        rawInput({ scenario: 'NORMAL', seed, steps: [currentStep] }),
        'INVALID_SEED',
      );
    }
  });

  it('returns a typed error with an English message and field path', () => {
    let caught: unknown;

    try {
      simulate(rawInput({ scenario: 'NORMAL', seed: -1, steps: [currentStep] }));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SimulatorInputError);
    const simulatorError = caught as SimulatorInputError;
    expect(simulatorError.code).toBe('INVALID_SEED');
    expect(simulatorError.path).toBe('seed');
    expect(simulatorError.message).toBe(
      'seed must be an integer between 0 and 4294967295.',
    );
  });

  it('rejects missing, empty and malformed step collections', () => {
    for (const steps of [undefined, null, 'steps', [], [null], [42]]) {
      expectInputError(
        rawInput({ scenario: 'NORMAL', seed: 1, steps }),
        Array.isArray(steps) && steps.length > 0 ? 'INVALID_STEP' : 'INVALID_STEPS',
      );
    }

    expectInputError(
      rawInput({
        scenario: 'NORMAL',
        seed: 1,
        steps: [
          makeStep({ logicalStepId: 'duplicate' }),
          makeStep({ logicalStepId: 'duplicate' }),
        ],
      }),
      'INVALID_STEP',
    );
  });

  it('rejects malformed step fields', () => {
    const malformedSteps: readonly Record<string, unknown>[] = [
      { logicalStepId: '' },
      { logicalStepId: 42 },
      { name: '' },
      { name: 'x'.repeat(101) },
      { name: 42 },
      { unit: '  ' },
      { unit: 'x'.repeat(17) },
      { unit: 42 },
      { minimum: '1e-6' },
      { minimum: '1,5' },
      { minimum: '.5' },
      { minimum: '0.0000001' },
      { minimum: '1000000001' },
      { maximum: 'NaN' },
      { maximum: '1.0000001' },
      { minimum: '2', maximum: '1' },
      { sampleCount: 0 },
      { sampleCount: 1001 },
      { sampleCount: 1.5 },
      { sampleCount: '30' },
      { intervalMs: 99 },
      { intervalMs: 5001 },
      { intervalMs: 1.5 },
      { intervalMs: '200' },
    ];

    for (const overrides of malformedSteps) {
      expectInputError(
        rawInput({
          scenario: 'NORMAL',
          seed: 1,
          steps: [makeStep(overrides)],
        }),
        'INVALID_STEP',
      );
    }
  });

  it('rejects scenario settings that do not belong to the scenario', () => {
    expectInputError(
      rawInput({
        scenario: 'NORMAL',
        seed: 1,
        steps: [currentStep],
        failureStepId: currentStep.logicalStepId,
      }),
      'INVALID_SCENARIO_SETTINGS',
    );
    expectInputError(
      rawInput({
        scenario: 'NORMAL',
        seed: 1,
        steps: [currentStep],
        errorProbability: '0.1',
      }),
      'INVALID_SCENARIO_SETTINGS',
    );
    expectInputError(
      rawInput({
        scenario: 'FORCED_FAILURE',
        seed: 1,
        steps: [currentStep],
        failureStepId: currentStep.logicalStepId,
        errorProbability: '0.1',
      }),
      'INVALID_SCENARIO_SETTINGS',
    );
    expectInputError(
      rawInput({
        scenario: 'RANDOM',
        seed: 1,
        steps: [currentStep],
        errorProbability: '0.1',
        failureStepId: currentStep.logicalStepId,
      }),
      'INVALID_SCENARIO_SETTINGS',
    );
  });

  it('requires a failureStepId that exists in the ordered steps', () => {
    expectInputError(
      rawInput({ scenario: 'FORCED_FAILURE', seed: 1, steps: [currentStep] }),
      'INVALID_FAILURE_STEP',
    );

    for (const failureStepId of ['missing', 42, '']) {
      expectInputError(
        rawInput({
          scenario: 'FORCED_FAILURE',
          seed: 1,
          steps: [currentStep],
          failureStepId,
        }),
        'INVALID_FAILURE_STEP',
      );
    }
  });

  it('requires a valid errorProbability for RANDOM', () => {
    expectInputError(
      rawInput({ scenario: 'RANDOM', seed: 1, steps: [currentStep] }),
      'INVALID_ERROR_PROBABILITY',
    );

    for (const errorProbability of [
      '1.000001',
      '-0.000001',
      '2',
      '0.1234567',
      '5e-1',
      '0,5',
      '.5',
      ' 0.5',
      'NaN',
      '',
      0.5,
    ]) {
      expectInputError(
        rawInput({
          scenario: 'RANDOM',
          seed: 1,
          steps: [currentStep],
          errorProbability,
        }),
        'INVALID_ERROR_PROBABILITY',
      );
    }
  });

  it('accepts the documented boundary inputs', () => {
    const edgeStep = makeStep({
      minimum: '-1000000000',
      maximum: '1000000000',
      sampleCount: 1000,
      intervalMs: 100,
    });
    const edgeResult = simulate({
      scenario: 'NORMAL',
      seed: 0,
      steps: [edgeStep],
    });

    expect(edgeResult.steps[0].samples).toHaveLength(1000);
    expectAllWithin(valuesOf(edgeResult), '-1000000000', '1000000000');

    expect(() =>
      simulate({
        scenario: 'NORMAL',
        seed: 4_294_967_295,
        steps: [makeStep({ sampleCount: 1, intervalMs: 5000 })],
      }),
    ).not.toThrow();

    for (const errorProbability of [
      '0',
      '1',
      '0.000001',
      '1.000000',
    ]) {
      expect(() =>
        simulate({
          scenario: 'RANDOM',
          seed: 0,
          errorProbability,
          steps: [makeStep({ sampleCount: 1 })],
        }),
      ).not.toThrow();
    }
  });
});

describe('simulator purity and determinism', () => {
  it('returns identical output for the same input', () => {
    const input: SimulationInput = {
      scenario: 'FORCED_FAILURE',
      seed: 20261103,
      failureStepId: currentStep.logicalStepId,
      steps: [voltageStep, currentStep, temperatureStep],
    };

    expect(simulate(input)).toEqual(simulate(input));
  });

  it('changes the sequence when the seed changes', () => {
    const first = valuesOf(
      simulate({ scenario: 'NORMAL', seed: 1, steps: [currentStep] }),
    );
    const second = valuesOf(
      simulate({ scenario: 'NORMAL', seed: 2, steps: [currentStep] }),
    );

    expect(first).not.toEqual(second);
  });

  it('does not read a clock or the global random source', () => {
    const dateNow = vi.spyOn(Date, 'now');
    const mathRandom = vi.spyOn(Math, 'random');

    try {
      simulate({
        scenario: 'RANDOM',
        seed: 20261103,
        errorProbability: '0.5',
        steps: [voltageStep, currentStep, temperatureStep],
      });
    } finally {
      dateNow.mockRestore();
      mathRandom.mockRestore();
    }

    expect(dateNow).not.toHaveBeenCalled();
    expect(mathRandom).not.toHaveBeenCalled();
  });

  it('schedules no timers', () => {
    vi.useFakeTimers();

    try {
      simulate({
        scenario: 'FORCED_FAILURE',
        seed: 1,
        failureStepId: currentStep.logicalStepId,
        steps: [currentStep],
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not mutate immutable step definitions', () => {
    const frozenStep = Object.freeze({ ...currentStep });
    const frozenSteps = Object.freeze([frozenStep]);

    expect(() =>
      simulate({ scenario: 'NORMAL', seed: 1, steps: frozenSteps }),
    ).not.toThrow();
    expect(frozenStep).toEqual(currentStep);
  });
});
