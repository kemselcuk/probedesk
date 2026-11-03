-- Plans, revisions and step identities for Phase 2.
--
-- Two invariants cannot be expressed in schema.prisma and are added as
-- PostgreSQL partial unique indexes below:
--   * published version numbers are unique inside one plan;
--   * a plan has at most one open DRAFT revision.
-- The table-level checks and the composite foreign keys are also hand-written
-- because Prisma does not model them. The migration is additive: it only
-- creates new enum/table/index/constraint objects and leaves Phase 1 rows alone.

-- CreateEnum
CREATE TYPE "PlanRevisionState" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateTable
CREATE TABLE "test_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "deviceProfileId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_revisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "planId" UUID NOT NULL,
    "state" "PlanRevisionState" NOT NULL,
    "name" TEXT NOT NULL,
    "versionNumber" INTEGER,
    "editRevision" INTEGER NOT NULL DEFAULT 1,
    "baseVersionId" UUID,
    "publishedById" UUID,
    "publishedAt" TIMESTAMPTZ(6),

    CONSTRAINT "plan_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "step_identities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "planId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "step_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_steps" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "revisionId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "logicalStepId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "minimum" DECIMAL(18,6) NOT NULL,
    "maximum" DECIMAL(18,6) NOT NULL,
    "sampleCount" INTEGER NOT NULL,
    "intervalMs" INTEGER NOT NULL,

    CONSTRAINT "plan_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "test_plans_deviceProfileId_idx" ON "test_plans"("deviceProfileId");

-- CreateIndex
CREATE INDEX "test_plans_createdById_idx" ON "test_plans"("createdById");

-- CreateIndex
CREATE INDEX "plan_revisions_planId_idx" ON "plan_revisions"("planId");

-- CreateIndex
CREATE INDEX "plan_revisions_baseVersionId_idx" ON "plan_revisions"("baseVersionId");

-- CreateIndex
CREATE INDEX "plan_revisions_publishedById_idx" ON "plan_revisions"("publishedById");

-- CreateIndex
CREATE UNIQUE INDEX "plan_revisions_id_planId_key" ON "plan_revisions"("id", "planId");

-- CreateIndex
CREATE INDEX "step_identities_planId_idx" ON "step_identities"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "step_identities_id_planId_key" ON "step_identities"("id", "planId");

-- CreateIndex
CREATE INDEX "plan_steps_planId_idx" ON "plan_steps"("planId");

-- CreateIndex
CREATE INDEX "plan_steps_logicalStepId_planId_idx" ON "plan_steps"("logicalStepId", "planId");

-- CreateIndex
CREATE UNIQUE INDEX "plan_steps_revisionId_position_key" ON "plan_steps"("revisionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "plan_steps_revisionId_logicalStepId_key" ON "plan_steps"("revisionId", "logicalStepId");

-- Reviewed partial unique indexes (not representable in the Prisma schema).
-- They are the database guarantee behind the optimistic draft contract.
CREATE UNIQUE INDEX "plan_revisions_planId_versionNumber_key"
    ON "plan_revisions"("planId", "versionNumber")
    WHERE "versionNumber" IS NOT NULL;

CREATE UNIQUE INDEX "plan_revisions_planId_draft_key"
    ON "plan_revisions"("planId")
    WHERE "state" = 'DRAFT';

-- Reviewed table checks: keep the stored revision/step rules inside the
-- accepted measurement limits even if a future write path forgets validation.
ALTER TABLE "plan_revisions"
    ADD CONSTRAINT "plan_revisions_editRevision_check"
        CHECK ("editRevision" >= 1),
    ADD CONSTRAINT "plan_revisions_versionNumber_check"
        CHECK ("versionNumber" IS NULL OR "versionNumber" >= 1),
    ADD CONSTRAINT "plan_revisions_state_fields_check"
        CHECK (
            ("state" = 'DRAFT'
                AND "versionNumber" IS NULL
                AND "publishedById" IS NULL
                AND "publishedAt" IS NULL)
            OR
            ("state" = 'PUBLISHED'
                AND "versionNumber" IS NOT NULL
                AND "publishedById" IS NOT NULL
                AND "publishedAt" IS NOT NULL)
        );

ALTER TABLE "plan_steps"
    ADD CONSTRAINT "plan_steps_position_check"
        CHECK ("position" >= 1),
    ADD CONSTRAINT "plan_steps_name_check"
        CHECK (char_length(btrim("name")) BETWEEN 1 AND 100),
    ADD CONSTRAINT "plan_steps_unit_check"
        CHECK (char_length(btrim("unit")) BETWEEN 1 AND 16),
    ADD CONSTRAINT "plan_steps_bounds_check"
        CHECK ("minimum" <= "maximum"),
    ADD CONSTRAINT "plan_steps_limit_check"
        CHECK ("minimum" BETWEEN -1000000000 AND 1000000000
            AND "maximum" BETWEEN -1000000000 AND 1000000000),
    ADD CONSTRAINT "plan_steps_sampleCount_check"
        CHECK ("sampleCount" BETWEEN 1 AND 1000),
    ADD CONSTRAINT "plan_steps_intervalMs_check"
        CHECK ("intervalMs" BETWEEN 100 AND 5000);

-- AddForeignKey
ALTER TABLE "test_plans" ADD CONSTRAINT "test_plans_deviceProfileId_fkey" FOREIGN KEY ("deviceProfileId") REFERENCES "device_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_plans" ADD CONSTRAINT "test_plans_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_revisions" ADD CONSTRAINT "plan_revisions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "test_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_revisions" ADD CONSTRAINT "plan_revisions_baseVersionId_fkey" FOREIGN KEY ("baseVersionId") REFERENCES "plan_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_revisions" ADD CONSTRAINT "plan_revisions_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_identities" ADD CONSTRAINT "step_identities_planId_fkey" FOREIGN KEY ("planId") REFERENCES "test_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Composite ownership foreign keys: a revision can only contain steps of its
-- own plan, and a step identity can only be referenced by its owning plan.
ALTER TABLE "plan_steps" ADD CONSTRAINT "plan_steps_revisionId_planId_fkey" FOREIGN KEY ("revisionId", "planId") REFERENCES "plan_revisions"("id", "planId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_steps" ADD CONSTRAINT "plan_steps_logicalStepId_planId_fkey" FOREIGN KEY ("logicalStepId", "planId") REFERENCES "step_identities"("id", "planId") ON DELETE RESTRICT ON UPDATE CASCADE;
