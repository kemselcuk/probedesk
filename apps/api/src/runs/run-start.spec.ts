import { describe, expect, it } from 'vitest';
import { ValidationFailedException } from '../common/errors/validation.exception.js';
import { RunScenario } from '../prisma/generated/client.js';
import {
  hashRunStartRequest,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  normalizeIdempotencyKey,
  normalizeRunStart,
  type RunStartInput,
} from './run-start.js';

const planVersionId = '22222222-2222-4222-8222-222222222222';
const failureStepId = '44444444-4444-4444-8444-444444444444';

function input(overrides: Partial<RunStartInput> = {}): RunStartInput {
  return {
    planVersionId,
    scenario: RunScenario.NORMAL,
    seed: 123,
    ...overrides,
  };
}

function fieldPaths(callback: () => unknown): string[] {
  try {
    callback();
    expect.unreachable('the request should be rejected');
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationFailedException);
    return (
      (error as ValidationFailedException).fieldErrors?.map(
        (issue) => issue.path,
      ) ?? []
    );
  }
}

describe('run start request normalisation', () => {
  it('canonicalises the request identity and probability used by the hash', () => {
    const short = normalizeRunStart(
      input({
        planVersionId: planVersionId.toUpperCase(),
        scenario: RunScenario.RANDOM,
        errorProbability: '0.05',
      }),
    );
    const long = normalizeRunStart(
      input({ scenario: RunScenario.RANDOM, errorProbability: '0.050000' }),
    );

    expect(short.planVersionId).toBe(planVersionId);
    expect(short.errorProbability).toBe('0.050000');
    expect(hashRunStartRequest(short)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashRunStartRequest(short)).toBe(hashRunStartRequest(long));
  });

  it('rejects scenario settings that do not belong to the scenario', () => {
    expect(
      fieldPaths(() => normalizeRunStart(input({ failureStepId }))),
    ).toEqual(['failureStepId']);
    expect(
      fieldPaths(() => normalizeRunStart(input({ errorProbability: '0.1' }))),
    ).toEqual(['errorProbability']);
    expect(
      fieldPaths(() =>
        normalizeRunStart(
          input({
            scenario: RunScenario.FORCED_FAILURE,
            errorProbability: '0.1',
          }),
        ),
      ),
    ).toEqual(['errorProbability', 'failureStepId']);
    expect(
      fieldPaths(() =>
        normalizeRunStart(
          input({
            scenario: RunScenario.RANDOM,
            failureStepId,
            errorProbability: '0.1',
          }),
        ),
      ),
    ).toEqual(['failureStepId']);
    expect(
      fieldPaths(() =>
        normalizeRunStart(input({ scenario: RunScenario.RANDOM })),
      ),
    ).toEqual(['errorProbability']);
  });

  it('rejects a bad seed, malformed ids and an out-of-range probability', () => {
    expect(fieldPaths(() => normalizeRunStart(input({ seed: -1 })))).toEqual([
      'seed',
    ]);
    expect(
      fieldPaths(() => normalizeRunStart(input({ seed: 4_294_967_296 }))),
    ).toEqual(['seed']);
    expect(
      fieldPaths(() =>
        normalizeRunStart(input({ planVersionId: 'not-a-uuid' })),
      ),
    ).toEqual(['planVersionId']);
    expect(
      fieldPaths(() =>
        normalizeRunStart(
          input({
            scenario: RunScenario.RANDOM,
            errorProbability: '1.000001',
          }),
        ),
      ),
    ).toEqual(['errorProbability']);
  });

  it('requires a non-empty bounded idempotency key', () => {
    expect(normalizeIdempotencyKey('run-key-1')).toBe('run-key-1');
    expect(fieldPaths(() => normalizeIdempotencyKey(undefined))).toEqual([
      'Idempotency-Key',
    ]);
    expect(fieldPaths(() => normalizeIdempotencyKey('   '))).toEqual([
      'Idempotency-Key',
    ]);
    expect(
      fieldPaths(() =>
        normalizeIdempotencyKey('k'.repeat(MAX_IDEMPOTENCY_KEY_LENGTH + 1)),
      ),
    ).toEqual(['Idempotency-Key']);
  });
});
