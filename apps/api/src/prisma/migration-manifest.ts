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
];
