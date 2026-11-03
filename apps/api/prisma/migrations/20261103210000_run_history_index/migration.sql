-- Reviewed index for the default and date-only run history queries (P5-01).
--
-- `GET /api/runs` orders by "startedAt" DESC, id DESC and pages with
-- OFFSET/LIMIT. Before this migration no index started with "startedAt", so
-- PostgreSQL had to sort every candidate row. A descending composite index
-- lets the planner read the first page directly from the index instead of
-- building and sorting the whole match set. PostgreSQL can also scan this
-- index backwards for an ascending order.
--
-- The plan/status/revision indexes stay in place: plan-scoped and status-only
-- filters still use them. No outcome index is added: outcome has only two
-- values, so a separate index is not justified without a measured query plan.
CREATE INDEX "test_runs_startedAt_id_idx"
    ON "test_runs" ("startedAt" DESC, "id" DESC);
