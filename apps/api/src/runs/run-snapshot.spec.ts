import { describe, expect, it } from 'vitest';
import { Prisma } from '../prisma/generated/client.js';
import {
  RunScenario,
  RunStatus,
  RunStepStatus,
} from '../prisma/generated/enums.js';
import {
  buildRunSnapshot,
  RunSnapshotValidationError,
  type RunSnapshotSettings,
  type RunSnapshotSource,
} from './run-snapshot.js';

const planId = '11111111-1111-4111-8111-111111111111';
const revisionId = '22222222-2222-4222-8222-222222222222';
const requestedById = '33333333-3333-4333-8333-333333333333';
const firstStepId = '44444444-4444-4444-8444-444444444444';
const secondStepId = '55555555-5555-4555-8555-555555555555';

function source(overrides: Partial<RunSnapshotSource> = {}): RunSnapshotSource {
  return {
    planId,
    revisionId,
    planName: 'DC module acceptance',
    versionNumber: 2,
    profile: {
      id: '66666666-6666-4666-8666-666666666666',
      code: 'DC_POWER_MODULE',
      name: 'DC Power Module',
      description: 'Fixture profile',
    },
    steps: [
      {
        logicalStepId: firstStepId,
        position: 1,
        name: 'Output Voltage',
        unit: 'V',
        minimum: new Prisma.Decimal('4.75'),
        maximum: new Prisma.Decimal('5.25'),
        sampleCount: 2,
        intervalMs: 200,
      },
      {
        logicalStepId: secondStepId,
        position: 2,
        name: 'Current Draw',
        unit: 'A',
        minimum: new Prisma.Decimal('-0.55'),
        maximum: new Prisma.Decimal('-0.45'),
        sampleCount: 3,
        intervalMs: 500,
      },
    ],
    ...overrides,
  };
}

function normalSettings(
  overrides: Partial<RunSnapshotSettings> = {},
): RunSnapshotSettings {
  return {
    scenario: RunScenario.NORMAL,
    seed: 4_294_967_295n,
    simulatorVersion: 'mulberry32-v1',
    evaluationVersion: 'decimal-v1',
    ...overrides,
  };
}

function validationIssues(
  input: RunSnapshotSource,
  settings: RunSnapshotSettings,
): string[] {
  try {
    buildRunSnapshot(input, settings, {
      requestedById,
      idempotencyKey: 'run-key-1',
      requestHash: 'request-hash-1',
      startedAt: new Date('2026-11-03T12:00:00.000Z'),
    });
    expect.unreachable('the snapshot should be rejected');
  } catch (error) {
    expect(error).toBeInstanceOf(RunSnapshotValidationError);
    return (error as RunSnapshotValidationError).issues.map(
      (issue) => issue.path,
    );
  }
}

describe('run snapshot copying', () => {
  it('copies revision rules and computes the expected sample count', () => {
    const rows = buildRunSnapshot(source(), normalSettings(), {
      requestedById,
      idempotencyKey: 'run-key-1',
      requestHash: 'request-hash-1',
      startedAt: new Date('2026-11-03T12:00:00.000Z'),
    });

    expect(rows.run).toEqual({
      planId,
      planRevisionId: revisionId,
      planNameSnapshot: 'DC module acceptance',
      versionNumberSnapshot: 2,
      profileSnapshot: {
        id: '66666666-6666-4666-8666-666666666666',
        code: 'DC_POWER_MODULE',
        name: 'DC Power Module',
        description: 'Fixture profile',
      },
      status: RunStatus.RUNNING,
      outcome: null,
      requestedById,
      scenario: RunScenario.NORMAL,
      seed: 4_294_967_295n,
      errorProbability: null,
      failureStepId: null,
      simulatorVersion: 'mulberry32-v1',
      evaluationVersion: 'decimal-v1',
      idempotencyKey: 'run-key-1',
      requestHash: 'request-hash-1',
      eventSequence: 0,
      expectedSampleCount: 5,
      recordedSampleCount: 0,
      startedAt: new Date('2026-11-03T12:00:00.000Z'),
      finishedAt: null,
      cancelledById: null,
      reasonCode: null,
    });

    expect(rows.steps).toHaveLength(2);
    expect(rows.steps[0]).toMatchObject({
      logicalStepId: firstStepId,
      position: 1,
      name: 'Output Voltage',
      unit: 'V',
      minimum: '4.750000',
      maximum: '5.250000',
      sampleCount: 2,
      intervalMs: 200,
      status: RunStepStatus.PENDING,
      outcome: null,
      recordedCount: 0,
      outOfToleranceCount: 0,
      firstFailureSampleIndex: null,
    });
    expect(rows.steps[1]).toMatchObject({
      logicalStepId: secondStepId,
      position: 2,
      name: 'Current Draw',
      unit: 'A',
      minimum: '-0.550000',
      maximum: '-0.450000',
      sampleCount: 3,
      intervalMs: 500,
    });
  });

  it('sorts steps by position and keeps equal or negative bounds', () => {
    const rows = buildRunSnapshot(
      source({
        steps: [
          {
            logicalStepId: secondStepId,
            position: 2,
            name: 'Constant',
            unit: 'V',
            minimum: new Prisma.Decimal('-2'),
            maximum: new Prisma.Decimal('-2'),
            sampleCount: 1,
            intervalMs: 100,
          },
          {
            logicalStepId: firstStepId,
            position: 1,
            name: 'First',
            unit: 'V',
            minimum: new Prisma.Decimal('5'),
            maximum: new Prisma.Decimal('5'),
            sampleCount: 1,
            intervalMs: 100,
          },
        ],
      }),
      normalSettings(),
      {
        requestedById,
        idempotencyKey: 'run-key-2',
        requestHash: 'request-hash-2',
        startedAt: new Date('2026-11-03T12:00:00.000Z'),
      },
    );

    expect(rows.steps.map((step) => step.position)).toEqual([1, 2]);
    expect(rows.steps.map((step) => step.minimum)).toEqual([
      '5.000000',
      '-2.000000',
    ]);
    expect(rows.steps.map((step) => step.maximum)).toEqual([
      '5.000000',
      '-2.000000',
    ]);
  });

  it('keeps RANDOM error probability as canonical six-place text', () => {
    const rows = buildRunSnapshot(
      source(),
      normalSettings({
        scenario: RunScenario.RANDOM,
        errorProbability: '0.05',
      }),
      {
        requestedById,
        idempotencyKey: 'run-key-3',
        requestHash: 'request-hash-3',
        startedAt: new Date('2026-11-03T12:00:00.000Z'),
      },
    );

    expect(rows.run.errorProbability).toBe('0.050000');
    expect(rows.run.failureStepId).toBeNull();
  });

  it('requires the FORCED_FAILURE step to exist in the snapshot', () => {
    const rows = buildRunSnapshot(
      source(),
      normalSettings({
        scenario: RunScenario.FORCED_FAILURE,
        failureStepId: secondStepId,
      }),
      {
        requestedById,
        idempotencyKey: 'run-key-4',
        requestHash: 'request-hash-4',
        startedAt: new Date('2026-11-03T12:00:00.000Z'),
      },
    );

    expect(rows.run.failureStepId).toBe(secondStepId);

    expect(
      validationIssues(
        source(),
        normalSettings({
          scenario: RunScenario.FORCED_FAILURE,
          failureStepId: '99999999-9999-4999-8999-999999999999',
        }),
      ),
    ).toContain('failureStepId');
  });

  it('rejects scenario settings that do not belong to the scenario', () => {
    expect(
      validationIssues(
        source(),
        normalSettings({ scenario: RunScenario.RANDOM }),
      ),
    ).toContain('errorProbability');

    expect(
      validationIssues(
        source(),
        normalSettings({ errorProbability: '0.100000' }),
      ),
    ).toContain('errorProbability');

    expect(
      validationIssues(
        source(),
        normalSettings({ failureStepId: firstStepId }),
      ),
    ).toContain('failureStepId');
  });

  it('rejects a seed outside uint32 and an out-of-range probability', () => {
    expect(
      validationIssues(source(), normalSettings({ seed: 4_294_967_296n })),
    ).toContain('seed');

    expect(
      validationIssues(
        source(),
        normalSettings({
          scenario: RunScenario.RANDOM,
          errorProbability: '1.000001',
        }),
      ),
    ).toContain('errorProbability');
  });

  it('rejects duplicate positions, duplicate logical steps and gaps', () => {
    expect(
      validationIssues(
        source({
          steps: [
            source().steps[0]!,
            {
              ...source().steps[1]!,
              position: 1,
            },
          ],
        }),
        normalSettings(),
      ),
    ).toContain('steps.1.position');

    expect(
      validationIssues(
        source({
          steps: [
            source().steps[0]!,
            {
              ...source().steps[1]!,
              logicalStepId: firstStepId,
            },
          ],
        }),
        normalSettings(),
      ),
    ).toContain('steps.1.logicalStepId');

    expect(
      validationIssues(
        source({
          steps: [{ ...source().steps[0]!, position: 2 }],
        }),
        normalSettings(),
      ),
    ).toContain('steps.0.position');
  });

  it('rejects more than 10,000 total samples', () => {
    const tooManySteps = Array.from({ length: 11 }, (_, index) => ({
      logicalStepId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      position: index + 1,
      name: `Step ${index + 1}`,
      unit: 'V',
      minimum: new Prisma.Decimal('0'),
      maximum: new Prisma.Decimal('1'),
      sampleCount: 1000,
      intervalMs: 100,
    }));

    expect(
      validationIssues(source({ steps: tooManySteps }), normalSettings()),
    ).toContain('steps');
  });

  it('rejects a nominal duration above the plan limit', () => {
    const tooLong = [
      {
        logicalStepId: firstStepId,
        position: 1,
        name: 'Long step',
        unit: 'V',
        minimum: new Prisma.Decimal('0'),
        maximum: new Prisma.Decimal('1'),
        sampleCount: 1000,
        intervalMs: 5000,
      },
    ];

    expect(
      validationIssues(source({ steps: tooLong }), normalSettings()),
    ).toContain('steps');
  });
});
