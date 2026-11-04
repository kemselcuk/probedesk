# Playwright end-to-end checks

These tests use the real Angular app, the real API, real PostgreSQL, and the real
executor. Start the API and web dev servers first (the local defaults are API
`http://127.0.0.1:3100` and web `http://127.0.0.1:4200`).

`E2E_DATABASE_URL` is required by the data-creating tests. It must point at the
same database the API under test uses, because the cleanup deletes only the
plan/run/session rows created by the test. Do not point it at a database you
want to keep.

```sh
# Local development database used by the API on port 3100.
set -a
source .env
set +a
E2E_DATABASE_URL="$DATABASE_URL" npm run test:e2e
```

Useful overrides:

- `E2E_BASE_URL` — web app origin (default `http://127.0.0.1:4200`).
- `E2E_API_URL` — API origin used by API-only fixtures (default
  `http://127.0.0.1:3100`).
- `PW_CHANNEL` — Playwright browser channel (default `chrome`).

Files:

- `main-demo.spec.ts` — P7-01 main flow: UI plan create/reorder/save/publish,
  FORCED_FAILURE live run, details failure sample, NORMAL run, history
  selection and comparison, v2 publish and v1/v2 rule comparison.
- `compare.spec.ts` — P6 comparison scenarios, including the unit-change case
  (`°C` → `°F`) that must not produce a numeric delta.

Failure artifacts are written under `test-results/`; the P7-01 evidence
screenshots are written to `docs/evidence/`.
