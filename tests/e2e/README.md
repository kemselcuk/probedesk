# Playwright end-to-end checks

These tests use the real Angular app, the real API, real PostgreSQL, and the
real executor. They must run against a **dedicated E2E database**, not the
development database and not the integration-test database while that suite is
running.

## Isolated database workflow

The test PostgreSQL container from `compose.test.yaml` already exposes
`127.0.0.1:5433`. Derive a separate database name from `TEST_DATABASE_URL`:

```sh
set -a
source .env
set +a

export E2E_DATABASE_URL="${TEST_DATABASE_URL%/*}/probedesk_e2e_test"

node scripts/e2e-isolated.mjs prepare
```

`prepare` creates `probedesk_e2e_test` when absent, applies every migration with
`prisma migrate deploy`, and runs the additive demo seed. It never drops a
database and never resets rows. The script prints the commands below with the
resolved values.

Start the API against the same URL (build once if `apps/api/dist` is stale):

```sh
npm run build --workspace apps/api

DATABASE_URL="$E2E_DATABASE_URL" PORT=3101 NODE_ENV=development \
  npm run start:prod --workspace apps/api
```

Start the web app on another port with a temporary proxy to that API:

```sh
printf '{"\/api":{"target":"http://127.0.0.1:3101","secure":false,"changeOrigin":false,"logLevel":"warn"}}\n' \
  > "$TMPDIR/probedesk-e2e-proxy.json"

npm run start --workspace apps/web -- \
  --port 4300 --host 127.0.0.1 \
  --proxy-config "$TMPDIR/probedesk-e2e-proxy.json"
```

Run Playwright with one worker. The shared demo database and its session
cleanup are serial by design; the suite refuses to start with more than one
worker.

```sh
E2E_DATABASE_URL="$E2E_DATABASE_URL" \
E2E_API_URL=http://127.0.0.1:3101 \
E2E_BASE_URL=http://127.0.0.1:4300 \
npm run test:e2e
```

Check the database before and after the suite:

```sh
node scripts/e2e-isolated.mjs status
```

The tests create unique plan names per run and delete only their collected plan
ids/names plus sessions created after their `beforeAll` baseline. A failed test
still cleans up in `afterAll`. A RUNNING run on a test plan is allowed to finish
for up to 20 seconds before cleanup refuses to delete it.

## Cleanup safety

`tests/e2e/support/database.ts` requires `E2E_DATABASE_URL`; there is no silent
no-op when it is missing. Destructive cleanup is refused unless:

- the database name ends with `_test`, or
- `E2E_ALLOW_DATABASE_CLEANUP=1` is set explicitly, and

the URL is never the same database as `DATABASE_URL`. Even with the explicit
override, the development database is refused.

Useful overrides:

- `E2E_BASE_URL` — web app origin (default `http://127.0.0.1:4200`).
- `E2E_API_URL` — API origin used by API-only fixtures (default
  `http://127.0.0.1:3100`).
- `PW_CHANNEL` — Playwright browser channel (default `chrome`).
- `E2E_ALLOW_DATABASE_CLEANUP=1` — allow cleanup on a disposable database whose
  name does not end in `_test`; the development database is still refused.

## Seed idempotency

After `prepare`, verify that running the demo seed twice does not touch plans,
revisions or runs:

```sh
node scripts/e2e-isolated.mjs seed-check
```

Files:

- `main-demo.spec.ts` — P7-01 main flow: UI plan create/reorder/save/publish,
  FORCED_FAILURE live run, details failure sample, NORMAL run, history
  selection and comparison, v2 publish and v1/v2 rule comparison.
- `compare.spec.ts` — P6 comparison scenarios, including the unit-change case
  (`°C` → `°F`) that must not produce a numeric delta.
- `support/database.ts` — shared baseline, cleanup and safety guards.

Failure artifacts are written under `test-results/`; the P7-01 evidence
screenshots are written to `docs/evidence/`.
