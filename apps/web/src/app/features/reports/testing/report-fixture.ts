import { runSnapshot, runningStep } from '../../runs/testing/run-fixtures';
import type { RunReport } from '../reports-api';
export function reportFixture(overrides: Partial<RunReport> = {}): RunReport {
  const { id, lastEventSequence: _cursor, ...run } = runSnapshot();
  return {
    ...run,
    profile: { ...run.profile, description: null },
    runId: id,
    schemaVersion: 1,
    generatedAt: '2026-11-08T12:00:00.000Z',
    status: 'COMPLETED',
    outcome: 'PASSED',
    finishedAt: '2026-11-03T10:00:02.000Z',
    expectedSampleCount: 1,
    recordedSampleCount: 1,
    steps: [
      runningStep({
        status: 'COMPLETED',
        outcome: 'PASSED',
        sampleCount: 1,
        recordedCount: 1,
        statistics: {
          minimum: '5.000000',
          maximum: '5.000000',
          average: '5.000000',
          sampleCount: 1,
        },
        measurements: [
          {
            sampleIndex: 0,
            value: '5.000000',
            isWithinTolerance: true,
            recordedAt: '2026-11-03T10:00:00.000Z',
            elapsedMs: 0,
          },
        ],
      }),
    ],
    ...overrides,
  };
}
