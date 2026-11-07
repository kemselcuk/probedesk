-- EX-08 analytics query plans.
--
-- 1. Batch filters (history and dashboard) are exact on the canonical
--    "batchNumberKey" and are ordered/filtered by "startedAt" DESC, id DESC.
--    With 60,000 real fixture runs the aggregate/history count used a
--    sequential scan (~10-13 ms); this composite index turns the sparse batch
--    filter into an Index Only Scan / Bitmap Index Scan (~0.02-0.17 ms) and the
--    6,000-row batch into ~3.3 ms. The index also serves the batch history page
--    without a Sort.
--
-- 2. "devices_deviceProfileId_idx" was a redundant prefix of
--    "devices_deviceProfileId_serialNumberKey_key". EXPLAIN with 10,051 devices
--    (51 in the filtered profile) chose the standalone index before removal and
--    the unique composite prefix after removal with the same plan shape and
--    timing (~0.07-0.09 ms). Removing the duplicate reduces write amplification
--    and storage without losing an access path.
CREATE INDEX "test_runs_batchNumberKey_startedAt_id_idx"
    ON "test_runs" ("batchNumberKey", "startedAt" DESC, "id" DESC);

DROP INDEX "devices_deviceProfileId_idx";
