-- Run history immutability (P3-03 B12).
--
-- The service layer already locks the TestRun row and conditionally writes
-- only while it is RUNNING. These triggers add the database guarantee:
--   * snapshot and rule-copy columns cannot be changed after the run starts;
--   * a terminal run/step status cannot move to another status;
--   * a measurement cannot be inserted for a terminal run.
--
-- Measurements, steps and events stay append-only in the product paths; delete
-- is still limited by ON DELETE RESTRICT. The triggers do not block deletes, so
-- the explicit test cleanup helper keeps working as the schema owner.

CREATE OR REPLACE FUNCTION "probedesk_test_runs_snapshot_immutable"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF
        NEW."planId" IS DISTINCT FROM OLD."planId"
        OR NEW."planRevisionId" IS DISTINCT FROM OLD."planRevisionId"
        OR NEW."planNameSnapshot" IS DISTINCT FROM OLD."planNameSnapshot"
        OR NEW."versionNumberSnapshot" IS DISTINCT FROM OLD."versionNumberSnapshot"
        OR NEW."profileSnapshot" IS DISTINCT FROM OLD."profileSnapshot"
        OR NEW."requestedById" IS DISTINCT FROM OLD."requestedById"
        OR NEW."scenario" IS DISTINCT FROM OLD."scenario"
        OR NEW."seed" IS DISTINCT FROM OLD."seed"
        OR NEW."errorProbability" IS DISTINCT FROM OLD."errorProbability"
        OR NEW."failureStepId" IS DISTINCT FROM OLD."failureStepId"
        OR NEW."simulatorVersion" IS DISTINCT FROM OLD."simulatorVersion"
        OR NEW."evaluationVersion" IS DISTINCT FROM OLD."evaluationVersion"
        OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
        OR NEW."requestHash" IS DISTINCT FROM OLD."requestHash"
        OR NEW."expectedSampleCount" IS DISTINCT FROM OLD."expectedSampleCount"
        OR NEW."startedAt" IS DISTINCT FROM OLD."startedAt"
    THEN
        RAISE EXCEPTION 'Run snapshot fields are immutable'
            USING ERRCODE = '23514';
    END IF;

    IF OLD."status" <> 'RUNNING' AND NEW."status" <> OLD."status" THEN
        RAISE EXCEPTION 'A terminal run status is immutable'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "test_runs_snapshot_immutable"
    BEFORE UPDATE
    ON "test_runs"
    FOR EACH ROW
    EXECUTE FUNCTION "probedesk_test_runs_snapshot_immutable"();

CREATE OR REPLACE FUNCTION "probedesk_run_steps_rule_copy_immutable"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF
        NEW."runId" IS DISTINCT FROM OLD."runId"
        OR NEW."logicalStepId" IS DISTINCT FROM OLD."logicalStepId"
        OR NEW."position" IS DISTINCT FROM OLD."position"
        OR NEW."name" IS DISTINCT FROM OLD."name"
        OR NEW."unit" IS DISTINCT FROM OLD."unit"
        OR NEW."minimum" IS DISTINCT FROM OLD."minimum"
        OR NEW."maximum" IS DISTINCT FROM OLD."maximum"
        OR NEW."sampleCount" IS DISTINCT FROM OLD."sampleCount"
        OR NEW."intervalMs" IS DISTINCT FROM OLD."intervalMs"
    THEN
        RAISE EXCEPTION 'Run rule copy fields are immutable'
            USING ERRCODE = '23514';
    END IF;

    IF
        OLD."status" NOT IN ('PENDING', 'RUNNING')
        AND NEW."status" <> OLD."status"
    THEN
        RAISE EXCEPTION 'A terminal step status is immutable'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "run_steps_rule_copy_immutable"
    BEFORE UPDATE
    ON "run_steps"
    FOR EACH ROW
    EXECUTE FUNCTION "probedesk_run_steps_rule_copy_immutable"();

CREATE OR REPLACE FUNCTION "probedesk_measurements_running_run_only"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    run_status "RunStatus";
BEGIN
    -- FOR SHARE serializes a direct insert with a concurrent terminal update:
    -- whichever lock holder commits first determines the accepted order.
    SELECT "status"
    INTO run_status
    FROM "test_runs"
    WHERE "id" = NEW."runId"
    FOR SHARE;

    IF run_status IS NOT NULL AND run_status <> 'RUNNING' THEN
        RAISE EXCEPTION 'Measurements cannot be added to a terminal run'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "measurements_running_run_only"
    BEFORE INSERT
    ON "measurements"
    FOR EACH ROW
    EXECUTE FUNCTION "probedesk_measurements_running_run_only"();
