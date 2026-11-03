-- Run history for Phase 3 (P3-03).
--
-- The schema stores immutable rule copies (plan name/version/profile and every
-- step's name/unit/bounds/sample settings) so later plan edits can never rewrite
-- a past result. The Prisma schema cannot express the following rules, so they
-- are added here by hand:
--   * at most one RUNNING TestRun globally (partial unique expression index);
--   * status/outcome coupling, counter consistency and snapshot shape checks;
--   * the composite Measurement -> RunStep foreign key that proves runId
--     matches the owning step;
--   * TRUNCATE rejection so run history cannot be wiped even by a schema owner
--     statement that bypasses row-level foreign keys.
--
-- This migration is additive and leaves existing plan rows untouched.

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'CANCELLED', 'INTERRUPTED', 'ERROR');

-- CreateEnum
CREATE TYPE "RunOutcome" AS ENUM ('PASSED', 'FAILED');

-- CreateEnum
CREATE TYPE "RunScenario" AS ENUM ('NORMAL', 'FORCED_FAILURE', 'RANDOM');

-- CreateEnum
CREATE TYPE "RunStepStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'CANCELLED', 'INTERRUPTED', 'ERROR', 'NOT_RUN');

-- CreateEnum: wire values keep the documented dotted event names.
CREATE TYPE "RunEventType" AS ENUM ('run.started', 'step.started', 'measurement.recorded', 'step.completed', 'run.completed', 'run.cancelled', 'run.interrupted', 'run.errored');

-- CreateTable
CREATE TABLE "test_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "planId" UUID NOT NULL,
    "planRevisionId" UUID NOT NULL,
    "planNameSnapshot" TEXT NOT NULL,
    "versionNumberSnapshot" INTEGER NOT NULL,
    "profileSnapshot" JSONB NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "outcome" "RunOutcome",
    "requestedById" UUID NOT NULL,
    "scenario" "RunScenario" NOT NULL,
    "seed" BIGINT NOT NULL,
    "errorProbability" DECIMAL(8,6),
    "failureStepId" UUID,
    "simulatorVersion" TEXT NOT NULL,
    "evaluationVersion" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "eventSequence" INTEGER NOT NULL DEFAULT 0,
    "expectedSampleCount" INTEGER NOT NULL,
    "recordedSampleCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMPTZ(6) NOT NULL,
    "finishedAt" TIMESTAMPTZ(6),
    "cancelledById" UUID,
    "reasonCode" TEXT,

    CONSTRAINT "test_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_steps" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "runId" UUID NOT NULL,
    "logicalStepId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "minimum" DECIMAL(18,6) NOT NULL,
    "maximum" DECIMAL(18,6) NOT NULL,
    "sampleCount" INTEGER NOT NULL,
    "intervalMs" INTEGER NOT NULL,
    "status" "RunStepStatus" NOT NULL DEFAULT 'PENDING',
    "outcome" "RunOutcome",
    "recordedCount" INTEGER NOT NULL DEFAULT 0,
    "outOfToleranceCount" INTEGER NOT NULL DEFAULT 0,
    "firstFailureSampleIndex" INTEGER,
    "startedAt" TIMESTAMPTZ(6),
    "finishedAt" TIMESTAMPTZ(6),
    "statistics" JSONB,

    CONSTRAINT "run_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measurements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "runId" UUID NOT NULL,
    "runStepId" UUID NOT NULL,
    "sampleIndex" INTEGER NOT NULL,
    "value" DECIMAL(18,6) NOT NULL,
    "isWithinTolerance" BOOLEAN NOT NULL,
    "recordedAt" TIMESTAMPTZ(6) NOT NULL,
    "elapsedMs" INTEGER NOT NULL,

    CONSTRAINT "measurements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "runId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" "RunEventType" NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "run_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "test_runs_planId_startedAt_id_idx" ON "test_runs"("planId", "startedAt", "id");

-- CreateIndex
CREATE INDEX "test_runs_status_idx" ON "test_runs"("status");

-- CreateIndex
CREATE INDEX "test_runs_planRevisionId_idx" ON "test_runs"("planRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "test_runs_requestedById_idempotencyKey_key" ON "test_runs"("requestedById", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "run_steps_runId_position_key" ON "run_steps"("runId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "run_steps_runId_logicalStepId_key" ON "run_steps"("runId", "logicalStepId");

-- CreateIndex: composite target for the measurement ownership foreign key.
CREATE UNIQUE INDEX "run_steps_id_runId_key" ON "run_steps"("id", "runId");

-- CreateIndex
CREATE UNIQUE INDEX "measurements_runStepId_sampleIndex_key" ON "measurements"("runStepId", "sampleIndex");

-- CreateIndex
CREATE UNIQUE INDEX "run_events_runId_sequence_key" ON "run_events"("runId", "sequence");

-- Reviewed partial unique index: the database guarantee for "one active run".
-- A terminal status update releases the constant key so the next start can
-- acquire it; two concurrent starts cannot both commit.
CREATE UNIQUE INDEX "test_runs_single_running_key"
    ON "test_runs" ((1))
    WHERE "status" = 'RUNNING';

-- AddForeignKey
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_planId_fkey" FOREIGN KEY ("planId") REFERENCES "test_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_planRevisionId_fkey" FOREIGN KEY ("planRevisionId") REFERENCES "plan_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_runId_fkey" FOREIGN KEY ("runId") REFERENCES "test_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Composite foreign key: the referenced row must have the same id and runId,
-- so a measurement can never belong to a step of a different run.
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_runStepId_runId_fkey" FOREIGN KEY ("runStepId", "runId") REFERENCES "run_steps"("id", "runId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_runId_fkey" FOREIGN KEY ("runId") REFERENCES "test_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Snapshot and lifecycle checks. COMPLETED is the only status that carries an
-- outcome; every terminal status must have a finish time, and a completed run
-- must have recorded every expected sample.
ALTER TABLE "test_runs"
    ADD CONSTRAINT "test_runs_planNameSnapshot_check"
        CHECK (char_length(btrim("planNameSnapshot")) BETWEEN 1 AND 100),
    ADD CONSTRAINT "test_runs_versionNumberSnapshot_check"
        CHECK ("versionNumberSnapshot" >= 1),
    ADD CONSTRAINT "test_runs_profileSnapshot_check"
        CHECK (
            jsonb_typeof("profileSnapshot") = 'object'
            AND ("profileSnapshot" ->> 'id') IS NOT NULL
            AND ("profileSnapshot" ->> 'code') IS NOT NULL
            AND ("profileSnapshot" ->> 'name') IS NOT NULL
        ),
    ADD CONSTRAINT "test_runs_status_outcome_check"
        CHECK (
            ("status" = 'COMPLETED' AND "outcome" IS NOT NULL)
            OR ("status" <> 'COMPLETED' AND "outcome" IS NULL)
        ),
    ADD CONSTRAINT "test_runs_terminal_timestamps_check"
        CHECK (
            ("status" = 'RUNNING' AND "finishedAt" IS NULL)
            OR (
                "status" <> 'RUNNING'
                AND "finishedAt" IS NOT NULL
                AND "finishedAt" >= "startedAt"
            )
        ),
    ADD CONSTRAINT "test_runs_eventSequence_check"
        CHECK ("eventSequence" >= 0),
    ADD CONSTRAINT "test_runs_seed_check"
        CHECK ("seed" BETWEEN 0 AND 4294967295),
    ADD CONSTRAINT "test_runs_errorProbability_check"
        CHECK ("errorProbability" IS NULL OR "errorProbability" BETWEEN 0 AND 1),
    ADD CONSTRAINT "test_runs_scenario_settings_check"
        CHECK (
            ("scenario" = 'NORMAL'
                AND "errorProbability" IS NULL
                AND "failureStepId" IS NULL)
            OR
            ("scenario" = 'FORCED_FAILURE'
                AND "errorProbability" IS NULL
                AND "failureStepId" IS NOT NULL)
            OR
            ("scenario" = 'RANDOM'
                AND "errorProbability" IS NOT NULL
                AND "failureStepId" IS NULL)
        ),
    ADD CONSTRAINT "test_runs_expectedSampleCount_check"
        CHECK ("expectedSampleCount" BETWEEN 1 AND 10000),
    ADD CONSTRAINT "test_runs_recordedSampleCount_check"
        CHECK ("recordedSampleCount" BETWEEN 0 AND "expectedSampleCount"),
    ADD CONSTRAINT "test_runs_completed_counts_check"
        CHECK ("status" <> 'COMPLETED' OR "recordedSampleCount" = "expectedSampleCount");

-- Step counters must stay consistent with the snapshotted sample count and the
-- preserved first failure index.
ALTER TABLE "run_steps"
    ADD CONSTRAINT "run_steps_position_check"
        CHECK ("position" >= 1),
    ADD CONSTRAINT "run_steps_name_check"
        CHECK (char_length(btrim("name")) BETWEEN 1 AND 100),
    ADD CONSTRAINT "run_steps_unit_check"
        CHECK (char_length(btrim("unit")) BETWEEN 1 AND 16),
    ADD CONSTRAINT "run_steps_bounds_check"
        CHECK ("minimum" <= "maximum"),
    ADD CONSTRAINT "run_steps_limit_check"
        CHECK (
            "minimum" BETWEEN -1000000000 AND 1000000000
            AND "maximum" BETWEEN -1000000000 AND 1000000000
        ),
    ADD CONSTRAINT "run_steps_sampleCount_check"
        CHECK ("sampleCount" BETWEEN 1 AND 1000),
    ADD CONSTRAINT "run_steps_intervalMs_check"
        CHECK ("intervalMs" BETWEEN 100 AND 5000),
    ADD CONSTRAINT "run_steps_status_outcome_check"
        CHECK (
            ("status" = 'COMPLETED' AND "outcome" IS NOT NULL)
            OR ("status" <> 'COMPLETED' AND "outcome" IS NULL)
        ),
    ADD CONSTRAINT "run_steps_recordedCount_check"
        CHECK ("recordedCount" BETWEEN 0 AND "sampleCount"),
    ADD CONSTRAINT "run_steps_outOfToleranceCount_check"
        CHECK ("outOfToleranceCount" BETWEEN 0 AND "recordedCount"),
    ADD CONSTRAINT "run_steps_firstFailure_check"
        CHECK (
            ("outOfToleranceCount" = 0 AND "firstFailureSampleIndex" IS NULL)
            OR (
                "outOfToleranceCount" > 0
                AND "firstFailureSampleIndex" IS NOT NULL
                AND "firstFailureSampleIndex" >= 0
                AND "firstFailureSampleIndex" < "recordedCount"
            )
        ),
    ADD CONSTRAINT "run_steps_completed_counts_check"
        CHECK ("status" <> 'COMPLETED' OR "recordedCount" = "sampleCount"),
    ADD CONSTRAINT "run_steps_statistics_check"
        CHECK ("statistics" IS NULL OR jsonb_typeof("statistics") = 'object');

-- Measurement indexes and values. The DECIMAL(18,6) column already limits the
-- stored value; the explicit check documents the representable range.
ALTER TABLE "measurements"
    ADD CONSTRAINT "measurements_sampleIndex_check"
        CHECK ("sampleIndex" >= 0),
    ADD CONSTRAINT "measurements_elapsedMs_check"
        CHECK ("elapsedMs" >= 0),
    ADD CONSTRAINT "measurements_value_range_check"
        CHECK ("value" > -1000000000000 AND "value" < 1000000000000);

-- Event sequence starts at 1 inside a run; payloads are JSON objects.
ALTER TABLE "run_events"
    ADD CONSTRAINT "run_events_sequence_check"
        CHECK ("sequence" >= 1),
    ADD CONSTRAINT "run_events_schemaVersion_check"
        CHECK ("schemaVersion" >= 1),
    ADD CONSTRAINT "run_events_payload_check"
        CHECK (jsonb_typeof("payload") = 'object');

-- TRUNCATE ignores row-level foreign keys, so reject it explicitly on every run
-- history table. The shared function was created by the published-immutability
-- migration.
CREATE TRIGGER "test_runs_reject_truncate"
    BEFORE TRUNCATE
    ON "test_runs"
    FOR EACH STATEMENT
    EXECUTE FUNCTION "probedesk_reject_truncate"();

CREATE TRIGGER "run_steps_reject_truncate"
    BEFORE TRUNCATE
    ON "run_steps"
    FOR EACH STATEMENT
    EXECUTE FUNCTION "probedesk_reject_truncate"();

CREATE TRIGGER "measurements_reject_truncate"
    BEFORE TRUNCATE
    ON "measurements"
    FOR EACH STATEMENT
    EXECUTE FUNCTION "probedesk_reject_truncate"();

CREATE TRIGGER "run_events_reject_truncate"
    BEFORE TRUNCATE
    ON "run_events"
    FOR EACH STATEMENT
    EXECUTE FUNCTION "probedesk_reject_truncate"();
