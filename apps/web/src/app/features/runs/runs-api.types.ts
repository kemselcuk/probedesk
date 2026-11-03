import type { components, operations } from '@probedesk/api-client';

/**
 * Run screen types.
 *
 * Everything here is an alias of the generated OpenAPI schema. The screens do
 * not keep a second hand-written API model; `runs-api.ts` validates the fields
 * it consumes at runtime and never fills a missing value with a default.
 */

/** One simulator scenario accepted by POST /api/runs. */
export type RunScenario = components['schemas']['StartRunDto']['scenario'];

/** POST /api/runs request body. */
export type StartRunRequest = components['schemas']['StartRunDto'];

/** 200 replay or 202 creation response from POST /api/runs. */
export type RunStartResponse = components['schemas']['RunStartResponseDto'];

/** Status stored on a run. A fresh start is RUNNING; a replay may be terminal. */
export type RunStatus = RunStartResponse['status'];

/** Overall verdict, null until a completed run has one. */
export type RunOutcome = RunStartResponse['outcome'];

/** Full recorded run from GET /api/runs/:id and POST /api/runs/:id/cancel. */
export type RunSnapshot = components['schemas']['RunSnapshotDto'];

/** One recorded step with its copied rules, counters, and samples. */
export type RunSnapshotStep = components['schemas']['RunSnapshotStepDto'];

/** One recorded sample. `isWithinTolerance` is the server verdict. */
export type RunMeasurement = components['schemas']['RunMeasurementDto'];

/** Stored step summary. Every member is null for a step without samples. */
export type RunStepStatistics = components['schemas']['RunStepStatisticsDto'];

/** Step execution status, copied from the run's stored step row. */
export type RunStepStatus = RunSnapshotStep['status'];

/** Step verdict, null unless the step is COMPLETED. */
export type RunStepOutcome = RunSnapshotStep['outcome'];

/** One history row from GET /api/runs. It never includes step arrays. */
export type RunHistoryItem = components['schemas']['RunHistoryItemDto'];

/** Earliest out-of-tolerance sample summary on a history row. */
export type RunHistoryFirstFailure = components['schemas']['RunFirstFailureDto'];

/** One page of GET /api/runs. */
export type RunHistoryPage = components['schemas']['RunHistoryPageDto'];

/**
 * Filters accepted by GET /api/runs. `page` and `limit` are required because
 * every request states its pagination explicitly.
 */
export type RunHistoryQuery = NonNullable<
  operations['RunsController_list']['parameters']['query']
> & {
  readonly page: number;
  readonly limit: number;
};
