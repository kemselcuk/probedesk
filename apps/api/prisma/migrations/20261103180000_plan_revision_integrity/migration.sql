-- Revision integrity for the Phase 2 review findings.
--
-- H-01: revision names must obey the same trimmed 1-100 character rule as the
-- save endpoint. The constraint is validated when the migration runs, so an
-- existing database with an invalid row fails loudly instead of being cleaned
-- or silently accepted.
--
-- M-05: baseVersionId must belong to the same plan (composite foreign key) and
-- point at a PUBLISHED revision (trigger). The old single-column foreign key is
-- replaced, not duplicated.
--
-- M-06: a PUBLISHED revision can only be produced by the DRAFT -> PUBLISHED
-- transition. Direct INSERT as PUBLISHED is rejected, TRUNCATE is rejected on
-- both revision tables, and the transition itself must leave at least one step
-- with a Planner as the publisher.
--
-- The transition check is a deferred constraint trigger: the publish service
-- re-reads the revision after the UPDATE and turns a concurrent direct write
-- into 409 DRAFT_CHANGED before commit. The deferred trigger is the final
-- backstop for direct SQL and still rejects the transaction at COMMIT. A
-- direct UPDATE in autocommit mode therefore fails the statement.

-- H-01: stored revision names.
ALTER TABLE "plan_revisions"
    ADD CONSTRAINT "plan_revisions_name_check"
        CHECK (char_length(btrim("name")) BETWEEN 1 AND 100);

-- M-05: baseVersionId ownership is proven by the existing unique
-- (id, planId) index. Replace the single-column foreign key so a revision can
-- never reference a base version of another plan.
ALTER TABLE "plan_revisions"
    DROP CONSTRAINT "plan_revisions_baseVersionId_fkey";

ALTER TABLE "plan_revisions"
    ADD CONSTRAINT "plan_revisions_baseVersionId_planId_fkey"
        FOREIGN KEY ("baseVersionId", "planId")
        REFERENCES "plan_revisions"("id", "planId")
        ON DELETE RESTRICT
        ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "probedesk_plan_revisions_base_version_is_published"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."baseVersionId" IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1
            FROM "plan_revisions" AS base
            WHERE base."id" = NEW."baseVersionId"
              AND base."state" = 'PUBLISHED'
        ) THEN
            RAISE EXCEPTION 'baseVersionId must reference a published revision of the same plan'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "plan_revisions_base_version_is_published"
    BEFORE INSERT OR UPDATE OF "baseVersionId"
    ON "plan_revisions"
    FOR EACH ROW
    EXECUTE FUNCTION "probedesk_plan_revisions_base_version_is_published"();

-- M-06: published revisions are only created by the DRAFT -> PUBLISHED
-- transition performed by the publish transaction.
CREATE OR REPLACE FUNCTION "probedesk_plan_revisions_reject_published_insert"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."state" = 'PUBLISHED' THEN
        RAISE EXCEPTION 'Published plan revisions can only be created by publishing a draft'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "plan_revisions_reject_published_insert"
    BEFORE INSERT
    ON "plan_revisions"
    FOR EACH ROW
    EXECUTE FUNCTION "probedesk_plan_revisions_reject_published_insert"();

-- M-06: row triggers do not fire for TRUNCATE, so a statement-level trigger
-- rejects it explicitly. Test cleanup disables USER triggers as the schema
-- owner; the application connection never has that escape hatch.
CREATE OR REPLACE FUNCTION "probedesk_reject_truncate"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'TRUNCATE is not allowed on %', TG_TABLE_NAME
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "plan_revisions_reject_truncate"
    BEFORE TRUNCATE
    ON "plan_revisions"
    FOR EACH STATEMENT
    EXECUTE FUNCTION "probedesk_reject_truncate"();

CREATE TRIGGER "plan_steps_reject_truncate"
    BEFORE TRUNCATE
    ON "plan_steps"
    FOR EACH STATEMENT
    EXECUTE FUNCTION "probedesk_reject_truncate"();

-- M-06: a revision that becomes PUBLISHED must contain at least one step and
-- must name a Planner as its publisher. The table check constraint already
-- guarantees non-null metadata; this trigger adds the cross-table rules.
CREATE OR REPLACE FUNCTION "probedesk_plan_revisions_validate_published_transition"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."state" = 'PUBLISHED' AND OLD."state" = 'DRAFT' THEN
        IF NOT EXISTS (
            SELECT 1
            FROM "plan_steps"
            WHERE "revisionId" = NEW."id"
        ) THEN
            RAISE EXCEPTION 'A published revision must contain at least one step'
                USING ERRCODE = '23514';
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM "users"
            WHERE "id" = NEW."publishedById"
              AND "role" = 'PLANNER'
        ) THEN
            RAISE EXCEPTION 'A published revision must name a Planner as publisher'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "plan_revisions_validate_published_transition"
    AFTER UPDATE
    ON "plan_revisions"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION "probedesk_plan_revisions_validate_published_transition"();
