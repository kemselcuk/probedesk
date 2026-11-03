import {
  formatSimulatorDecimal,
  parseSimulatorDecimal,
  SIMULATOR_SCALE_FACTOR,
} from './decimal.js';
import {
  createMulberry32,
  UINT32_HALF,
  UINT32_SPACE,
} from './mulberry32.js';

/**
 * Deterministic measurement simulator.
 *
 * This module is intentionally free of HTTP, database, filesystem, clock and
 * global random dependencies. It accepts ordered immutable step definitions and
 * returns the complete sample sequence synchronously.
 *
 * Version `mulberry32-v1` locks the following behaviour:
 *
 * 1. One mulberry32 stream is initialised from `seed` and consumed in step order,
 *    then sample order.
 * 2. NORMAL consumes one uint32 per sample. The value is
 *    `minimum + floor(r * (span + 1) / 2^32)` in micro-units, where
 *    `span = maximum - minimum`. This mapping is inclusive and never rounds
 *    outside the limits.
 * 3. FORCED_FAILURE consumes one uint32 per sample exactly like NORMAL. At
 *    `floor((sampleCount - 1) / 2)` of the selected step the generated value is
 *    replaced with `maximum + distance`; all other samples therefore match the
 *    NORMAL sequence for the same seed. The direction is always above maximum.
 * 4. RANDOM consumes three uint32 values per sample in this fixed order:
 *    failure decision, direction, value. The decision compares
 *    `r * 10^6 < errorProbabilityMicro * 2^32` exactly. A failure is placed
 *    below minimum when the direction value is < 2^31, otherwise above maximum.
 * 5. The out-of-range distance is
 *    `max(ceil((maximum - minimum) / 2), 0.000001)` in micro-units. An odd
 *    micro-unit half-range is therefore rounded up to the next representable
 *    value. Forced failures use it exactly; random failures use an offset in
 *    `[0.000001, distance]` beyond the selected limit.
 *
 * Any change to the PRNG, call order, mapping, distance or rounding rule must
 * increment `SIMULATOR_VERSION`. Historical runs are never regenerated.
 */
export const SIMULATOR_VERSION = 'mulberry32-v1';

export const MIN_SEED = 0;
export const MAX_SEED = 0xffff_ffff;
export const MIN_SAMPLE_COUNT = 1;
export const MAX_SAMPLE_COUNT = 1000;
export const MIN_INTERVAL_MS = 100;
export const MAX_INTERVAL_MS = 5000;
export const MAX_STEP_NAME_LENGTH = 100;
export const MAX_STEP_UNIT_LENGTH = 16;

export const SIMULATION_SCENARIOS = [
  'NORMAL',
  'FORCED_FAILURE',
  'RANDOM',
] as const;

export type SimulationScenario = (typeof SIMULATION_SCENARIOS)[number];

/** One immutable rule set copied from the executed plan version. */
export interface SimulatorStepDefinition {
  readonly logicalStepId: string;
  readonly name: string;
  readonly unit: string;
  readonly minimum: string;
  readonly maximum: string;
  readonly sampleCount: number;
  readonly intervalMs: number;
}

interface BaseSimulationInput {
  readonly seed: number;
  readonly steps: readonly SimulatorStepDefinition[];
}

export interface NormalSimulationInput extends BaseSimulationInput {
  readonly scenario: 'NORMAL';
  readonly failureStepId?: never;
  readonly errorProbability?: never;
}

export interface ForcedFailureSimulationInput extends BaseSimulationInput {
  readonly scenario: 'FORCED_FAILURE';
  readonly failureStepId: string;
  readonly errorProbability?: never;
}

export interface RandomSimulationInput extends BaseSimulationInput {
  readonly scenario: 'RANDOM';
  readonly errorProbability: string;
  readonly failureStepId?: never;
}

export type SimulationInput =
  | NormalSimulationInput
  | ForcedFailureSimulationInput
  | RandomSimulationInput;

export interface SimulatedSample {
  readonly sampleIndex: number;
  readonly value: string;
}

export interface SimulatedStep {
  readonly logicalStepId: string;
  readonly samples: readonly SimulatedSample[];
}

export interface SimulationResult {
  readonly simulatorVersion: string;
  readonly steps: readonly SimulatedStep[];
}

export type SimulatorErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_SCENARIO'
  | 'INVALID_SEED'
  | 'INVALID_STEPS'
  | 'INVALID_STEP'
  | 'INVALID_SCENARIO_SETTINGS'
  | 'INVALID_FAILURE_STEP'
  | 'INVALID_ERROR_PROBABILITY';

/** Typed input error with an English, client-safe message. */
export class SimulatorInputError extends Error {
  readonly code: SimulatorErrorCode;
  readonly path: string | undefined;

  constructor(code: SimulatorErrorCode, message: string, path?: string) {
    super(message);
    this.name = 'SimulatorInputError';
    this.code = code;
    this.path = path;
  }
}

interface RawSimulationInput {
  readonly scenario?: unknown;
  readonly seed?: unknown;
  readonly steps?: unknown;
  readonly failureStepId?: unknown;
  readonly errorProbability?: unknown;
}

interface PreparedStep {
  readonly logicalStepId: string;
  readonly minimumScaled: bigint;
  readonly maximumScaled: bigint;
  readonly sampleCount: number;
}

interface PreparedNormalInput {
  readonly scenario: 'NORMAL';
  readonly seed: number;
  readonly steps: readonly PreparedStep[];
}

interface PreparedForcedFailureInput {
  readonly scenario: 'FORCED_FAILURE';
  readonly seed: number;
  readonly failureStepId: string;
  readonly steps: readonly PreparedStep[];
}

interface PreparedRandomInput {
  readonly scenario: 'RANDOM';
  readonly seed: number;
  readonly errorProbabilityMicro: bigint;
  readonly steps: readonly PreparedStep[];
}

type PreparedInput =
  | PreparedNormalInput
  | PreparedForcedFailureInput
  | PreparedRandomInput;

/**
 * Generates the full ordered sample sequence for one run. The same input always
 * returns the same values; no external state is read or written.
 */
export function simulate(input: SimulationInput): SimulationResult {
  const prepared = prepareInput(input);
  const nextUint32 = createMulberry32(prepared.seed);

  const steps = prepared.steps.map((step) => {
    const samples = generateStep(prepared, step, nextUint32);

    return {
      logicalStepId: step.logicalStepId,
      samples,
    };
  });

  return {
    simulatorVersion: SIMULATOR_VERSION,
    steps,
  };
}

function generateStep(
  input: PreparedInput,
  step: PreparedStep,
  nextUint32: () => number,
): readonly SimulatedSample[] {
  const span = step.maximumScaled - step.minimumScaled;
  const distance = failureDistance(step.minimumScaled, step.maximumScaled);
  const forcedIndex =
    input.scenario === 'FORCED_FAILURE' &&
    step.logicalStepId === input.failureStepId
      ? Math.floor((step.sampleCount - 1) / 2)
      : -1;
  const samples: SimulatedSample[] = [];

  for (let sampleIndex = 0; sampleIndex < step.sampleCount; sampleIndex += 1) {
    let value: string;

    if (input.scenario === 'RANDOM') {
      value = randomValue(
        input.errorProbabilityMicro,
        step,
        span,
        distance,
        nextUint32,
      );
    } else if (forcedIndex === sampleIndex) {
      value = forcedValue(step, distance, nextUint32);
    } else {
      value = normalValue(step, span, nextUint32);
    }

    samples.push({ sampleIndex, value });
  }

  return samples;
}

function normalValue(
  step: PreparedStep,
  span: bigint,
  nextUint32: () => number,
): string {
  return formatSimulatorDecimal(
    step.minimumScaled + uniformOffset(nextUint32(), span),
  );
}

/**
 * Keeps the PRNG position aligned with NORMAL: the value that would have been
 * generated for this sample is still drawn and discarded before the forced
 * value is substituted.
 */
function forcedValue(
  step: PreparedStep,
  distance: bigint,
  nextUint32: () => number,
): string {
  nextUint32();
  return formatSimulatorDecimal(step.maximumScaled + distance);
}

function randomValue(
  probabilityMicro: bigint,
  step: PreparedStep,
  span: bigint,
  distance: bigint,
  nextUint32: () => number,
): string {
  const decision = nextUint32();
  const direction = nextUint32();
  const valueSource = nextUint32();
  const failed =
    BigInt(decision) * SIMULATOR_SCALE_FACTOR <
    probabilityMicro * UINT32_SPACE;

  if (!failed) {
    return formatSimulatorDecimal(
      step.minimumScaled + uniformOffset(valueSource, span),
    );
  }

  const offset = 1n + uniformOffset(valueSource, distance - 1n);
  const scaled =
    direction < UINT32_HALF
      ? step.minimumScaled - offset
      : step.maximumScaled + offset;

  return formatSimulatorDecimal(scaled);
}

/**
 * Maps a uint32 to an integer in [0, span] with exact integer arithmetic.
 * `span + 1` buckets of size 2^32/(span+1) approximate a uniform distribution;
 * the inclusive maximum is reached for the top bucket.
 */
function uniformOffset(value: number, span: bigint): bigint {
  return (BigInt(value) * (span + 1n)) / UINT32_SPACE;
}

/**
 * `max(ceil((maximum - minimum) / 2), 1)` micro-units. An odd micro-unit
 * difference is rounded up, so the forced value is always strictly outside and
 * still representable with six fractional digits.
 */
function failureDistance(minimum: bigint, maximum: bigint): bigint {
  const halfRange = (maximum - minimum + 1n) / 2n;
  return halfRange > 1n ? halfRange : 1n;
}

function prepareInput(input: SimulationInput): PreparedInput {
  if (input === null || typeof input !== 'object') {
    throw new SimulatorInputError(
      'INVALID_INPUT',
      'Simulator input must be an object.',
    );
  }

  const raw = input as unknown as RawSimulationInput;
  const scenario = raw.scenario;

  if (!isSimulationScenario(scenario)) {
    throw new SimulatorInputError(
      'INVALID_SCENARIO',
      `scenario must be one of ${SIMULATION_SCENARIOS.join(', ')}.`,
      'scenario',
    );
  }

  const seed = prepareSeed(raw.seed);
  const steps = prepareSteps(raw.steps);
  const hasFailureStep = raw.failureStepId !== undefined;
  const hasErrorProbability = raw.errorProbability !== undefined;

  switch (scenario) {
    case 'NORMAL': {
      rejectScenarioSetting(
        hasFailureStep,
        'failureStepId',
        'failureStepId is only allowed when scenario is FORCED_FAILURE.',
      );
      rejectScenarioSetting(
        hasErrorProbability,
        'errorProbability',
        'errorProbability is only allowed when scenario is RANDOM.',
      );

      return { scenario, seed, steps };
    }

    case 'FORCED_FAILURE': {
      rejectScenarioSetting(
        hasErrorProbability,
        'errorProbability',
        'errorProbability is not allowed when scenario is FORCED_FAILURE.',
      );

      if (!hasFailureStep) {
        throw new SimulatorInputError(
          'INVALID_FAILURE_STEP',
          'failureStepId is required when scenario is FORCED_FAILURE.',
          'failureStepId',
        );
      }

      if (typeof raw.failureStepId !== 'string') {
        throw new SimulatorInputError(
          'INVALID_FAILURE_STEP',
          'failureStepId must be a string.',
          'failureStepId',
        );
      }

      if (!steps.some((step) => step.logicalStepId === raw.failureStepId)) {
        throw new SimulatorInputError(
          'INVALID_FAILURE_STEP',
          'failureStepId must match a logicalStepId in steps.',
          'failureStepId',
        );
      }

      return {
        scenario,
        seed,
        failureStepId: raw.failureStepId,
        steps,
      };
    }

    case 'RANDOM': {
      rejectScenarioSetting(
        hasFailureStep,
        'failureStepId',
        'failureStepId is not allowed when scenario is RANDOM.',
      );

      if (!hasErrorProbability) {
        throw new SimulatorInputError(
          'INVALID_ERROR_PROBABILITY',
          'errorProbability is required when scenario is RANDOM.',
          'errorProbability',
        );
      }

      return {
        scenario,
        seed,
        errorProbabilityMicro: prepareErrorProbability(raw.errorProbability),
        steps,
      };
    }
  }
}

function prepareSeed(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < MIN_SEED ||
    value > MAX_SEED
  ) {
    throw new SimulatorInputError(
      'INVALID_SEED',
      `seed must be an integer between ${MIN_SEED} and ${MAX_SEED}.`,
      'seed',
    );
  }

  return value;
}

function prepareSteps(value: unknown): readonly PreparedStep[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new SimulatorInputError(
      'INVALID_STEPS',
      'steps must be a non-empty array.',
      'steps',
    );
  }

  const candidates: readonly unknown[] = value;
  const prepared: PreparedStep[] = [];
  const seenIds = new Set<string>();

  for (const [index, candidate] of candidates.entries()) {
    const path = `steps.${index}`;

    if (candidate === null || typeof candidate !== 'object') {
      throw new SimulatorInputError(
        'INVALID_STEP',
        'Each step must be an object.',
        path,
      );
    }

    const step = candidate as Record<string, unknown>;
    const logicalStepId = step.logicalStepId;

    if (typeof logicalStepId !== 'string' || logicalStepId.trim().length === 0) {
      throw new SimulatorInputError(
        'INVALID_STEP',
        'logicalStepId must be a non-empty string.',
        `${path}.logicalStepId`,
      );
    }

    if (seenIds.has(logicalStepId)) {
      throw new SimulatorInputError(
        'INVALID_STEP',
        'logicalStepId values must be unique within steps.',
        `${path}.logicalStepId`,
      );
    }

    if (
      typeof step.name !== 'string' ||
      step.name.trim().length === 0 ||
      step.name.trim().length > MAX_STEP_NAME_LENGTH
    ) {
      throw new SimulatorInputError(
        'INVALID_STEP',
        `name must be 1 to ${MAX_STEP_NAME_LENGTH} characters after trimming.`,
        `${path}.name`,
      );
    }

    if (
      typeof step.unit !== 'string' ||
      step.unit.trim().length === 0 ||
      step.unit.trim().length > MAX_STEP_UNIT_LENGTH
    ) {
      throw new SimulatorInputError(
        'INVALID_STEP',
        `unit must be 1 to ${MAX_STEP_UNIT_LENGTH} characters after trimming.`,
        `${path}.unit`,
      );
    }

    const minimumScaled = parseSimulatorDecimal(step.minimum);
    if (minimumScaled === null) {
      throw new SimulatorInputError(
        'INVALID_STEP',
        'minimum must be a canonical decimal string with at most 6 fractional digits between -1000000000 and 1000000000.',
        `${path}.minimum`,
      );
    }

    const maximumScaled = parseSimulatorDecimal(step.maximum);
    if (maximumScaled === null) {
      throw new SimulatorInputError(
        'INVALID_STEP',
        'maximum must be a canonical decimal string with at most 6 fractional digits between -1000000000 and 1000000000.',
        `${path}.maximum`,
      );
    }

    if (minimumScaled > maximumScaled) {
      throw new SimulatorInputError(
        'INVALID_STEP',
        'maximum must be greater than or equal to minimum.',
        `${path}.maximum`,
      );
    }

    if (
      typeof step.sampleCount !== 'number' ||
      !Number.isInteger(step.sampleCount) ||
      step.sampleCount < MIN_SAMPLE_COUNT ||
      step.sampleCount > MAX_SAMPLE_COUNT
    ) {
      throw new SimulatorInputError(
        'INVALID_STEP',
        `sampleCount must be an integer between ${MIN_SAMPLE_COUNT} and ${MAX_SAMPLE_COUNT}.`,
        `${path}.sampleCount`,
      );
    }

    if (
      typeof step.intervalMs !== 'number' ||
      !Number.isInteger(step.intervalMs) ||
      step.intervalMs < MIN_INTERVAL_MS ||
      step.intervalMs > MAX_INTERVAL_MS
    ) {
      throw new SimulatorInputError(
        'INVALID_STEP',
        `intervalMs must be an integer between ${MIN_INTERVAL_MS} and ${MAX_INTERVAL_MS}.`,
        `${path}.intervalMs`,
      );
    }

    seenIds.add(logicalStepId);
    prepared.push({
      logicalStepId,
      minimumScaled,
      maximumScaled,
      sampleCount: step.sampleCount,
    });
  }

  return prepared;
}

function prepareErrorProbability(value: unknown): bigint {
  const probability = parseSimulatorDecimal(value);

  if (
    probability === null ||
    probability < 0n ||
    probability > SIMULATOR_SCALE_FACTOR
  ) {
    throw new SimulatorInputError(
      'INVALID_ERROR_PROBABILITY',
      'errorProbability must be a decimal string between 0 and 1 with at most 6 fractional digits.',
      'errorProbability',
    );
  }

  return probability;
}

function rejectScenarioSetting(
  present: boolean,
  path: string,
  message: string,
): void {
  if (present) {
    throw new SimulatorInputError('INVALID_SCENARIO_SETTINGS', message, path);
  }
}

function isSimulationScenario(value: unknown): value is SimulationScenario {
  return (
    typeof value === 'string' &&
    (SIMULATION_SCENARIOS as readonly string[]).includes(value)
  );
}
