/**
 * Every migration that must be present in a ready database.
 *
 * This manifest is checked in and verified against `prisma/migrations` by
 * `migration-manifest.spec.ts`. Readiness compares it with `_prisma_migrations`
 * by name, so a database that applied only some of the registered migrations is
 * never reported as ready (the applied-row count alone is not sufficient).
 */
export const EXPECTED_MIGRATIONS: readonly string[] = [
  '20261103120000_init',
  '20261103130000_session_csrf_token_optional',
  '20261103160000_plans',
  '20261103170000_published_immutability',
  '20261103180000_plan_revision_integrity',
  '20261103190000_runs',
  '20261103200000_run_immutability',
  '20261103210000_run_history_index',
  '20261106120000_devices_and_copy_requests',
  '20261107120000_analytics_query_indexes',
  '20261109120000_analytics_covering_indexes',
];
