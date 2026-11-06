-- Feature pack 1: durable device identities, plan-copy provenance and nullable
-- run metadata.
--
-- The migration is additive. Existing plans, revisions, runs, steps,
-- measurements, events and idempotency hashes are left untouched; every new
-- TestRun column is nullable and the new tables start empty.
--
-- PostgreSQL constraints that Prisma cannot express are added by hand:
--   * trimmed name/serial/batch lengths and the documented serial character set;
--   * the canonical uppercase serial/batch keys used by lookup and uniqueness;
--   * the device relation and deviceSnapshot are both present or both absent;
--   * deviceSnapshot.id matches the relational deviceId;
--   * the existing run snapshot immutability trigger also protects the new
--     device/batch metadata without weakening any earlier field.

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "deviceProfileId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "serialNumberKey" TEXT NOT NULL,
    "description" TEXT,
    "archivedAt" TIMESTAMPTZ(6),
    "editRevision" INTEGER NOT NULL DEFAULT 1,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_copy_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "requestedById" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "sourceVersionId" UUID NOT NULL,
    "targetPlanId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_copy_requests_pkey" PRIMARY KEY ("id")
);

-- AlterTable: nullable metadata keeps every pre-feature run valid.
ALTER TABLE "test_runs"
    ADD COLUMN "deviceId" UUID,
    ADD COLUMN "deviceSnapshot" JSONB,
    ADD COLUMN "batchNumber" TEXT,
    ADD COLUMN "batchNumberKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "devices_deviceProfileId_serialNumberKey_key" ON "devices"("deviceProfileId", "serialNumberKey");

-- CreateIndex
CREATE INDEX "devices_deviceProfileId_idx" ON "devices"("deviceProfileId");

-- CreateIndex
CREATE INDEX "devices_createdById_idx" ON "devices"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "plan_copy_requests_requestedById_idempotencyKey_key" ON "plan_copy_requests"("requestedById", "idempotencyKey");

-- CreateIndex
CREATE INDEX "plan_copy_requests_sourceVersionId_idx" ON "plan_copy_requests"("sourceVersionId");

-- CreateIndex
CREATE INDEX "plan_copy_requests_targetPlanId_idx" ON "plan_copy_requests"("targetPlanId");

-- CreateIndex: reviewed device-history order is (startedAt DESC, id DESC).
CREATE INDEX "test_runs_deviceId_startedAt_id_idx" ON "test_runs"("deviceId", "startedAt" DESC, "id" DESC);

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_deviceProfileId_fkey" FOREIGN KEY ("deviceProfileId") REFERENCES "device_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_copy_requests" ADD CONSTRAINT "plan_copy_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_copy_requests" ADD CONSTRAINT "plan_copy_requests_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "plan_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_copy_requests" ADD CONSTRAINT "plan_copy_requests_targetPlanId_fkey" FOREIGN KEY ("targetPlanId") REFERENCES "test_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Device identity checks. The serial character set is ASCII letters/digits and
-- ._:/-; display case is preserved while serialNumberKey is the canonical
-- uppercase lookup/uniqueness key.
ALTER TABLE "devices"
    ADD CONSTRAINT "devices_name_check"
        CHECK (char_length(btrim("name")) BETWEEN 1 AND 100),
    ADD CONSTRAINT "devices_serialNumber_check"
        CHECK (
            char_length("serialNumber") BETWEEN 1 AND 100
            AND "serialNumber" ~ '^[A-Za-z0-9._:/-]+$'
        ),
    ADD CONSTRAINT "devices_serialNumberKey_check"
        CHECK (
            char_length("serialNumberKey") BETWEEN 1 AND 100
            AND "serialNumberKey" ~ '^[A-Z0-9._:/-]+$'
            AND "serialNumberKey" = upper("serialNumber")
        ),
    ADD CONSTRAINT "devices_description_check"
        CHECK (
            "description" IS NULL
            OR char_length(btrim("description")) BETWEEN 1 AND 500
        ),
    ADD CONSTRAINT "devices_editRevision_check"
        CHECK ("editRevision" >= 1);

-- Run metadata consistency. Device identity and snapshot travel together; the
-- snapshot id is the same UUID as the foreign key. Batch number and its
-- canonical key also travel together, and the key is the uppercased display
-- value. A batch is allowed without a device.
ALTER TABLE "test_runs"
    ADD CONSTRAINT "test_runs_device_metadata_check"
        CHECK (
            ("deviceId" IS NULL AND "deviceSnapshot" IS NULL)
            OR ("deviceId" IS NOT NULL AND "deviceSnapshot" IS NOT NULL)
        ),
    ADD CONSTRAINT "test_runs_device_snapshot_check"
        CHECK (
            "deviceSnapshot" IS NULL
            OR (
                jsonb_typeof("deviceSnapshot") = 'object'
                AND jsonb_typeof("deviceSnapshot" -> 'id') = 'string'
                AND jsonb_typeof("deviceSnapshot" -> 'name') = 'string'
                AND jsonb_typeof("deviceSnapshot" -> 'serialNumber') = 'string'
                AND jsonb_typeof("deviceSnapshot" -> 'deviceProfileId') = 'string'
                AND char_length(btrim("deviceSnapshot" ->> 'name')) BETWEEN 1 AND 100
                AND char_length("deviceSnapshot" ->> 'serialNumber') BETWEEN 1 AND 100
                AND ("deviceSnapshot" ->> 'id')::uuid = "deviceId"
            ) IS TRUE
        ),
    ADD CONSTRAINT "test_runs_batch_metadata_check"
        CHECK (
            ("batchNumber" IS NULL AND "batchNumberKey" IS NULL)
            OR ("batchNumber" IS NOT NULL AND "batchNumberKey" IS NOT NULL)
        ),
    ADD CONSTRAINT "test_runs_batchNumber_check"
        CHECK (
            "batchNumber" IS NULL
            OR (
                char_length("batchNumber") BETWEEN 1 AND 100
                AND "batchNumber" ~ '^[A-Za-z0-9._:/-]+$'
            )
        ),
    ADD CONSTRAINT "test_runs_batchNumberKey_check"
        CHECK (
            "batchNumberKey" IS NULL
            OR (
                char_length("batchNumberKey") BETWEEN 1 AND 100
                AND "batchNumberKey" ~ '^[A-Z0-9._:/-]+$'
                AND "batchNumberKey" = upper("batchNumber")
            )
        );

-- Extend the existing run snapshot immutability trigger with the new metadata
-- fields. Every original comparison remains so no previous protection is
-- weakened: device selection, device snapshot and batch fields are frozen when
-- the run starts, exactly like plan/profile/scenario/idempotency snapshots.
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
        OR NEW."deviceId" IS DISTINCT FROM OLD."deviceId"
        OR NEW."deviceSnapshot" IS DISTINCT FROM OLD."deviceSnapshot"
        OR NEW."batchNumber" IS DISTINCT FROM OLD."batchNumber"
        OR NEW."batchNumberKey" IS DISTINCT FROM OLD."batchNumberKey"
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
