import type { Overview, OverviewQuery } from '../analytics-api';
export const PLAN_ID = '11111111-1111-4111-8111-111111111111';
export const VERSION_ID = '22222222-2222-4222-8222-222222222222';
export function overviewFixture(query: OverviewQuery, empty = false): Overview {
  const zero = {
    totalRuns: 0,
    completedRuns: 0,
    passedRuns: 0,
    failedRuns: 0,
    runningRuns: 0,
    cancelledRuns: 0,
    interruptedRuns: 0,
    errorRuns: 0,
  };
  const counts = empty
    ? zero
    : { ...zero, totalRuns: 5, completedRuns: 4, passedRuns: 3, failedRuns: 1, runningRuns: 1 };
  const trend: Overview['trend'] = [];
  let cursor = Date.parse(query.from.slice(0, 10) + 'T00:00:00.000Z');
  while (cursor < Date.parse(query.to)) {
    const first = trend.length === 0;
    trend.push({
      date: new Date(cursor).toISOString().slice(0, 10),
      ...(first ? counts : zero),
      passRatePercent: first && !empty ? '75.00' : null,
    });
    cursor += 86_400_000;
  }
  return {
    asOf: query.to,
    filters: {
      from: new Date(query.from).toISOString(),
      to: new Date(query.to).toISOString(),
      planId: query.planId ?? null,
      planVersionId: query.planVersionId ?? null,
      deviceId: query.deviceId ?? null,
      batchNumber: query.batchNumber?.trim().toUpperCase() || null,
      scenario: query.scenario ?? null,
    },
    summary: {
      ...counts,
      passRatePercent: empty ? null : '75.00',
      averageDurationMs: empty ? null : '1000.125',
    },
    trend,
    topFailedSteps: empty
      ? []
      : [
          {
            planId: query.planId ?? PLAN_ID,
            planVersionId: query.planVersionId ?? VERSION_ID,
            logicalStepId: '33333333-3333-4333-8333-333333333333',
            planName: 'Power check',
            stepName: 'Voltage',
            versionNumber: 2,
            unit: 'V',
            completedStepRuns: 4,
            failedStepRuns: 1,
            failureRatePercent: '25.00',
          },
        ],
  };
}
