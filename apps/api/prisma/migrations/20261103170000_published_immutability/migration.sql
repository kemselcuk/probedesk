-- Published plan revision immutability.
--
-- The API never updates or deletes published content, but the contract requires
-- the database to reject it as well. These triggers make the accepted snapshot
-- final while still allowing the single DRAFT -> PUBLISHED transition performed
-- by the publish transaction.
--
-- The step trigger locks the owning revision row with FOR SHARE. Publish updates
-- that same row, so a step INSERT/UPDATE racing a publish either commits before
-- the transition (and is then detected by the publish service's post-transition
-- content re-read) or waits for the transition and is rejected because the
-- revision is PUBLISHED. Draft saves and publish also serialize on the plan row,
-- so API callers cannot interleave a save with a publish.
--
-- Deleting history is rejected; the foreign keys remain ON DELETE RESTRICT.
-- Only a schema owner can disable these triggers (used by the test cleanup
-- helper), never a normal application connection.

CREATE OR REPLACE FUNCTION "probedesk_assert_revision_is_draft"(
    target_revision_id UUID
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    revision_state "PlanRevisionState";
BEGIN
    SELECT "state"
    INTO revision_state
    FROM "plan_revisions"
    WHERE "id" = target_revision_id
    FOR SHARE;

    IF revision_state = 'PUBLISHED' THEN
        RAISE EXCEPTION 'Published plan revision content is immutable'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "probedesk_plan_revisions_published_immutable"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD."state" = 'PUBLISHED' THEN
            RAISE EXCEPTION 'Published plan revisions cannot be deleted'
                USING ERRCODE = '23514';
        END IF;

        RETURN OLD;
    END IF;

    -- OLD is PUBLISHED: every update, including a no-op, is rejected.
    IF OLD."state" = 'PUBLISHED' THEN
        RAISE EXCEPTION 'Published plan revisions are immutable'
            USING ERRCODE = '23514';
    END IF;

    -- OLD is DRAFT: ordinary draft edits and the DRAFT -> PUBLISHED
    -- transition are allowed. The table check constraints validate the
    -- published metadata written by the transition.
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "probedesk_plan_steps_published_immutable"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM "probedesk_assert_revision_is_draft"(NEW."revisionId");
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        PERFORM "probedesk_assert_revision_is_draft"(OLD."revisionId");
        RETURN OLD;
    END IF;

    PERFORM "probedesk_assert_revision_is_draft"(OLD."revisionId");

    IF NEW."revisionId" IS DISTINCT FROM OLD."revisionId" THEN
        PERFORM "probedesk_assert_revision_is_draft"(NEW."revisionId");
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "plan_revisions_published_immutable"
    BEFORE UPDATE OR DELETE
    ON "plan_revisions"
    FOR EACH ROW
    EXECUTE FUNCTION "probedesk_plan_revisions_published_immutable"();

CREATE TRIGGER "plan_steps_published_immutable"
    BEFORE INSERT OR UPDATE OR DELETE
    ON "plan_steps"
    FOR EACH ROW
    EXECUTE FUNCTION "probedesk_plan_steps_published_immutable"();
