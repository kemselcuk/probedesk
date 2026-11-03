import type { components } from '@probedesk/api-client';

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
