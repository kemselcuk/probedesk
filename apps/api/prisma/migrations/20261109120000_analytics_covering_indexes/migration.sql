-- Performance review 2026-11-09: analytics dashboard covering indexes.
--
-- Measure first, then index. Baseline used 20,000 completed runs against one
-- published revision (60,000 run steps, 1.8M measurements, ~856 MB) on the
-- local perf database. HTTP numbers are 50 requests after a warm-up, repeated
-- in three alternating rounds (see docs/evidence/performance-review.md).
--
-- 1. Top-failed-steps aggregate (GET /api/analytics/overview).
--    The aggregate joins every run in the requested range to its steps. With
--    the default 30-day range the planner scanned all 60,000 step rows
--    (Seq Scan, ~31 ms) because run_steps is wide and no index carried the
--    aggregate columns. The partial covering index below lets a per-run
--    Index Only Scan serve the same join: the chosen plan ran in 15.6 ms
--    (the same query forced onto a per-run join measured 8.4 ms), and the
--    endpoint p50 moved 18.7 -> 13.5 ms, p95 21.7 -> 14.6 ms. Only COMPLETED
--    steps are indexed; rules and counters of PENDING/RUNNING steps are not
--    duplicated into the index.
--
-- 2. Summary and trend aggregates.
--    Both filter test_runs."startedAt"; the summary also reads status,
--    outcome and finishedAt, and test_runs rows are wide (JSON snapshots).
--    At 30 days the summary fetched 1,723 heap buffers; at 366 days 3,337.
--    INCLUDE turns the existing history index into a covering index for both:
--    summary 36.7 -> 7.0 ms and trend 21.3 -> 5.1 ms at 366 days, 30-day
--    summary 3.5 -> 0.8 ms. At 366 days the endpoint p50 moved 48.7 -> 44.1 ms;
--    the remaining time is the top-failed aggregate, which still scans runs.
--    The key columns are unchanged, so the default history ordering keeps the
--    same access path without a Sort; it is not a second index.
--
-- A reviewed "top rows" INCLUDE index (planNameSnapshot and versionNumber-
-- Snapshot) measured no endpoint change: the planner kept the sequential scan
-- on the wide table. It was not kept. Every index taxes writes; runs are
-- user-triggered, a run writes at most 30 step rows, and the read gain above
-- is reproducible, so these two changes pay for themselves.
--
-- The delivery profile runs one API process against a seeded local database, so
-- the brief drop/recreate lock is acceptable and runs inside the migration
-- transaction. A large production table would use CREATE INDEX CONCURRENTLY
-- outside a transaction instead; that is out of scope for this local delivery.
DROP INDEX "test_runs_startedAt_id_idx";

CREATE INDEX "test_runs_startedAt_id_idx"
    ON "test_runs" ("startedAt" DESC, "id" DESC)
    INCLUDE ("status", "outcome", "finishedAt");

CREATE INDEX "run_steps_completed_analytics_idx"
    ON "run_steps" ("runId", "logicalStepId", "unit")
    INCLUDE ("name", "outcome")
    WHERE "status" = 'COMPLETED';
