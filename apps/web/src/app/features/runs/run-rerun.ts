import type { RunSnapshot, StartRunRequest } from './runs-api.types';

/**
 * Rebuilds the exact start request stored on a recorded run.
 *
 * The snapshot is the authority: the same published `planVersionId`, scenario,
 * seed, and scenario-specific setting are copied. A missing setting throws
 * instead of inventing a value or silently changing the scenario.
 */
export function buildRerunRequest(snapshot: RunSnapshot): StartRunRequest {
  const base = {
    planVersionId: snapshot.planVersionId,
    scenario: snapshot.scenario,
    seed: snapshot.seed,
  };

  if (snapshot.scenario === 'FORCED_FAILURE') {
    if (snapshot.failureStepId === null) {
      throw new Error('The run snapshot has no failure step for FORCED_FAILURE.');
    }

    return { ...base, failureStepId: snapshot.failureStepId };
  }

  if (snapshot.scenario === 'RANDOM') {
    if (snapshot.errorProbability === null) {
      throw new Error('The run snapshot has no error probability for RANDOM.');
    }

    return { ...base, errorProbability: snapshot.errorProbability };
  }

  return base;
}
