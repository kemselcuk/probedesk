# ProbeDesk API

NestJS 12 API for ProbeDesk. Local infrastructure is free and runs with Docker
Compose; no hosted service is required.

## Prerequisites

- Node.js 22.23.2 (see the repository `.nvmrc`).
- npm 11.6.2. The system npm may be older; use `npx npm@11.6.2 <command>` if
  workspace installation fails.
- Docker with Compose v2.

All commands below are run from the repository root unless stated otherwise.
Copy `.env.example` to `.env` and adjust values; `.env` is gitignored.

## Databases

```bash
# Development database, named volume probedesk-postgres-data.
docker compose -f compose.yaml up -d --wait

# Isolated integration-test database on 127.0.0.1:5433, no shared volume.
docker compose -f compose.test.yaml up -d --wait
```

`compose.yaml` publishes the development database on
`127.0.0.1:${PROBEDESK_DEV_DB_PORT:-5432}`. If another PostgreSQL service already
uses 5432, set `PROBEDESK_DEV_DB_PORT` in the untracked `.env` and update
`DATABASE_URL` to the same port. The default remains 5432.

The test service is a standalone Compose project (`probedesk-test`) with its own
container and database. It never mounts the development volume.

## Install, generate, migrate

```bash
npx npm@11.6.2 ci
npm run db:generate --workspace apps/api
npm run db:migrate --workspace apps/api
```

`db:generate` writes the Prisma 7 client to `apps/api/src/prisma/generated`
(gitignored). The `pretypecheck`, `prelint`, `prebuild`, `prestart`, `pretest`
and `pretest:e2e` scripts regenerate it automatically.

`db:migrate` runs `prisma migrate deploy` against `DATABASE_URL`.
`db:migrate:test` applies registered migrations to the isolated test database
and refuses to run unless `NODE_ENV=test`, both `DATABASE_URL` and
`TEST_DATABASE_URL` are present, and the test URL does not share the
development database identity.

## Run

```bash
npm run start:dev --workspace apps/api
```

The API listens under `/api`. Health probes:

- `GET http://127.0.0.1:3000/api/health/live`
- `GET http://127.0.0.1:3000/api/health/ready`

Readiness answers 503 until PostgreSQL is reachable and `_prisma_migrations`
shows no unfinished or rolled-back migration. An empty database therefore
reports `migrations: pending` instead of accepting traffic.

Swagger UI is served at `/api/docs`; the JSON document is at `/api/docs-json`.

## Authentication and demo accounts

The API uses an opaque server-side session bound to an HttpOnly cookie named
`probedesk_session`. The raw token is never stored: `sessions.tokenHash` holds a
SHA-256 digest. A session lives for eight hours from login and is never extended
by activity. The cookie is `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure`
when `SESSION_COOKIE_SECURE=true`. `NODE_ENV=production` requires that value to
be `true`; the API refuses to start otherwise. The insecure default is only for
the documented localhost demo.

A readable `XSRF-TOKEN` cookie carries a session-bound CSRF token whose digest is
stored in `sessions.csrfTokenHash`. Authenticated mutations must echo it in the
`X-XSRF-TOKEN` header, which matches Angular's `HttpClientXsrfModule` defaults.
Missing or wrong tokens receive `403 FORBIDDEN`; missing or expired sessions
receive `401 UNAUTHENTICATED`. Login accepts `application/json` only, checks a
browser `Origin` header against the request host, and throttles failed attempts
in-process: 10 failures per 15 minutes per client address and email, plus 50
failures per 15 minutes for one client address across different emails. A 429
response carries `Retry-After` in seconds. Unknown emails and wrong passwords
share one generic response.

Seed the three demo accounts and the single `DC Power Module` device profile
(idempotent; existing rows are never updated):

```bash
npm run db:migrate --workspace apps/api
npm run demo:seed --workspace apps/api
```

| Role | Email | Demo password |
|---|---|---|
| Planner | `planner@probedesk.local` | `PlannerDemo!2026` |
| Operator | `operator@probedesk.local` | `OperatorDemo!2026` |
| Viewer | `viewer@probedesk.local` | `ViewerDemo!2026` |

These credentials are for local demonstration only. Passwords are hashed with
Argon2id (19 MiB, 2 iterations, 1 lane) and the seed refuses to run when
`NODE_ENV=production`. OpenAPI documents the `session` cookie scheme and the
`csrfToken` header scheme.

## Plan publishing and versions

The plan endpoints form one versioned editing flow:

- `PUT /api/plans/:id/draft` replaces the open draft with an `expectedRevision`.
- `POST /api/plans/:id/draft/publish` publishes that draft atomically after
  re-validating the stored steps (1–30 steps, measurement limits, contiguous
  positions). The version number is `max + 1` inside the plan while the plan row
  is locked, so concurrent publishes cannot duplicate a version.
- `POST /api/plans/:id/drafts` copies the latest published version into a new
  draft with `editRevision=1` and keeps every `logicalStepId`. A second draft is
  rejected with `409 DRAFT_CONFLICT`.
- `GET /api/plans/:id/versions` lists published versions newest first with a safe
  publisher summary.
- `GET /api/plan-versions/:id` reads one immutable published version. Draft ids
  and unknown ids are `404`.

Published revisions and steps are immutable in the API and in PostgreSQL. The
`20261103170000_published_immutability` migration adds triggers that reject
`UPDATE`/`DELETE` of published revisions, `UPDATE`/`DELETE` of their steps, and
`INSERT` of steps into a published revision. The only accepted revision update is
the `DRAFT -> PUBLISHED` transition (ordinary draft edits remain allowed). Step
writes take a share lock on the
owning revision, so a direct write racing a publish either serializes before the
transition (and aborts the publish because the content changed) or waits and is
rejected after it. The test cleanup helper disables these triggers as the schema
owner; application connections cannot.

## Run start

`POST /api/runs` starts a published plan version as the single active run. It
requires an Operator session, the CSRF header and an `Idempotency-Key` header
(1–200 characters).

```json
{
  "planVersionId": "…",
  "scenario": "NORMAL",
  "seed": 123456789
}
```

`scenario` is one of `NORMAL`, `FORCED_FAILURE` and `RANDOM`. `failureStepId` is
required only for `FORCED_FAILURE` and must be one of that published version's
`logicalStepId` values. `errorProbability` is required only for `RANDOM` and is
a canonical decimal string from `0` to `1` with at most six fractional digits;
it is stored as six-place text. Unknown fields and client-supplied status,
outcome or counters are rejected with `400 VALIDATION_ERROR` and `fieldErrors`.

A new run returns `202` with `runId`, `status: "RUNNING"`, `outcome: null` and
the relative `snapshotUrl`/`eventsUrl`. The run row, every immutable `RunStep`
copy and the `run.started` event commit in one transaction. Execution is not
tied to the start HTTP connection.

Retrying the same user, key and normalized request returns the stored run with
`200`, even after it reached a terminal status. Reusing the key with a different
request is `409 IDEMPOTENCY_CONFLICT`. Starting with a different key while one
run is `RUNNING` is `409 RUN_ALREADY_ACTIVE` with `details.activeRunId`; the
request is not queued. The database partial unique index on `RUNNING` rows is
the final guarantee when two starts arrive concurrently.

## Run snapshots

`GET /api/runs/active` returns the single `RUNNING` run summary
(`runId`, `planName`, `versionNumber`, `status`, `expectedSampleCount`,
`recordedSampleCount`, `startedAt`, `scenario`) or the JSON literal `null` when
no run is active. It never answers `404` for an idle system.

`GET /api/runs/:id` returns the full immutable snapshot for a Planner, Operator
or Viewer: run identity and settings, profile, copied step rules, counters,
stored statistics and measurements in `sampleIndex` order. Decimal values are
canonical six-fraction-digit strings. `lastEventSequence` is the initial SSE
cursor.

The run row, all steps, all measurements and `lastEventSequence` are read in one
`REPEATABLE READ` transaction. A snapshot therefore always describes one
committed state even while the executor is writing. Steps are ordered by
`position`, measurements by `sampleIndex`. A partial step reports
`statistics` with null numeric members rather than zero; completed steps return
the summary stored by the executor. `hasOutOfTolerance` is true exactly when
`outOfToleranceCount > 0`.

Terminal runs remain readable and are never recomputed from the current plan or
draft. An unknown run id is `404 NOT_FOUND`; a non-UUID id is
`400 VALIDATION_ERROR`. Responses contain no password hash, session token,
idempotency key, request hash or draft content.

## Tests

```bash
npm run lint --workspace apps/api
npm run typecheck --workspace apps/api
npm run test --workspace apps/api
npm run db:migrate:test --workspace apps/api
npm run test:e2e --workspace apps/api
npm run build --workspace apps/api
```

`test:e2e` uses Supertest against a real test PostgreSQL and requires the test
Compose service plus `db:migrate:test`.

The destructive test reset is opt-in:

```bash
NODE_ENV=test npm run db:reset:test --workspace apps/api
```

It refuses unless `NODE_ENV=test`, `TEST_DATABASE_URL` is set, `DATABASE_URL`
is set for comparison, and the test URL does not point at the development
database. It drops the test database schema and replays migrations; it never
touches the development volume.

To verify that a row survives recreation of the development container:

```bash
NODE_ENV=development PROBEDESK_ALLOW_PERSISTENCE_CHECK=1 \
  npm run test:db:persistence --workspace apps/api
```

This check inserts a temporary `device_profiles` row, recreates the development
`postgres` container with the same named volume, confirms the row, and removes it.
It refuses to run unless `NODE_ENV=development` and
`PROBEDESK_ALLOW_PERSISTENCE_CHECK=1` are set, `DATABASE_URL` points at a local
database (`localhost`, `127.0.0.1` or `::1`), `TEST_DATABASE_URL` is present,
and the two URLs have different database identities.

## OpenAPI

```bash
npm run openapi:emit --workspace apps/api
```

Writes `apps/api/openapi.json`. The generator does not open a database
connection and succeeds with PostgreSQL stopped.
