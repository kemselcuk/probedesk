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

Readiness answers 503 until PostgreSQL is reachable, `_prisma_migrations`
shows no unfinished or rolled-back migration, and startup recovery has closed
leftover RUNNING runs. An empty database therefore reports `migrations:
pending` instead of accepting traffic. A failed startup recovery is retried by
readiness, and run starts are rejected with `503 SERVICE_UNAVAILABLE` until it
completes.

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

## Run history

`GET /api/runs` returns a paginated history for a Planner, Operator or Viewer.
Filters are `planId`, `status` (`RUNNING`, `COMPLETED`, `CANCELLED`,
`INTERRUPTED`, `ERROR`), `outcome` (`PASSED`, `FAILED`), `from`, `to`, `page`
(1-based) and `limit` (default 20, maximum 100). Unknown query parameters,
non-UUID plan ids, unknown enum values, malformed dates and out-of-range
pagination are `400 VALIDATION_ERROR` with `fieldErrors`.

`from` is inclusive and `to` is exclusive; the range is `[from, to)` over
`startedAt`. Both accept an ISO-8601 date (`2026-11-03`, interpreted as UTC
midnight) or a date-time with an explicit timezone (`2026-11-03T12:00:00.000Z`
or an offset). A timezone-less date-time is rejected rather than interpreted in
the server's local zone. Results are ordered by `startedAt DESC, id DESC`, so
runs that share a start timestamp still paginate deterministically.

```json
{
  "items": [
    {
      "id": "…",
      "planId": "…",
      "planVersionId": "…",
      "planName": "Power rail verification",
      "versionNumber": 2,
      "scenario": "NORMAL",
      "seed": 123456789,
      "status": "COMPLETED",
      "outcome": "FAILED",
      "startedAt": "2026-11-03T12:00:00.000Z",
      "finishedAt": "2026-11-03T12:00:06.200Z",
      "expectedSampleCount": 6,
      "recordedSampleCount": 6,
      "outOfToleranceCount": 2,
      "firstFailure": {
        "stepPosition": 2,
        "stepName": "Current Draw",
        "logicalStepId": "…",
        "sampleIndex": 1
      },
      "partial": false,
      "requestedBy": { "id": "…", "email": "operator@example.com", "role": "OPERATOR" }
    }
  ],
  "page": 1,
  "limit": 20,
  "total": 7,
  "totalPages": 1
}
```

List items never contain step or measurement arrays. `expectedSampleCount` and
`recordedSampleCount` are the sums of the immutable step rows; they equal the
run counters written at start and execution time. `outOfToleranceCount` is the
sum of every step counter. `firstFailure` is the earliest failing step by
`position`, then the stored `firstFailureSampleIndex`; it is null when no
recorded sample is out of tolerance. `partial` is true only when recorded
samples are below expected. A CANCELLED, INTERRUPTED or ERROR run that recorded
every expected sample is not partial: `status` and `outcome` communicate the
stop, and the details screen separately explains that all samples were recorded
before finalization stopped. An empty measurements set does not fabricate
statistics: the run snapshot reports null step statistics and the history row
reports zero recorded samples with `firstFailure: null`.

`totalPages` is zero when no run matches. A page beyond `totalPages` returns
`200` with an empty `items` array and the unchanged total. Plan-scoped queries
use the existing `(planId, startedAt, id)` index for filtering and ordering, and
status filters use the `status` index. The reviewed
`test_runs_startedAt_id_idx` on `("startedAt" DESC, id DESC)` serves the
unfiltered and date-only history ordering without a full sort. A query filtered
only by `outcome` still sorts its candidates: outcome has two values, so no
separate low-selectivity index was added.

## Run comparison

`GET /api/comparisons?leftRunId=<uuid>&rightRunId=<uuid>` compares two
terminal runs of one plan for a Planner, Operator or Viewer. Both ids are
required and must be UUIDs. Unknown ids answer `404 NOT_FOUND` without saying
which side is missing.

- A `RUNNING` run is rejected with `409 RUN_NOT_TERMINAL`; `details.leftStatus`
  and `details.rightStatus` identify the non-terminal side. `COMPLETED`,
  `CANCELLED`, `INTERRUPTED` and `ERROR` are all comparable.
- The same run on both sides is `400 VALIDATION_ERROR` with a `rightRunId`
  field error.
- Different versions of the same plan are accepted. Different plans answer
  `422 COMPARISON_PLAN_MISMATCH` with `details.leftPlanId` and
  `details.rightPlanId`.
- Missing, malformed, duplicated or unknown query parameters answer
  `400 VALIDATION_ERROR`.

Steps are matched only by the persistent `logicalStepId`; names and positions
never participate in matching. Renames and reorders therefore keep their
match, while deleting a step and adding a new one with the same display name
produces one removed and one added step with different identities.

```json
{
  "planId": "…",
  "versionDifference": {
    "sameVersion": false,
    "leftVersionNumber": 1,
    "rightVersionNumber": 2
  },
  "leftRun": {
    "id": "…",
    "planId": "…",
    "planVersionId": "…",
    "planName": "Variant plan v1",
    "versionNumber": 1,
    "profile": { "id": "…", "code": "DC_POWER_MODULE", "name": "DC Power Module", "description": null },
    "scenario": "NORMAL",
    "seed": 222,
    "errorProbability": null,
    "failureStepId": null,
    "simulatorVersion": "mulberry32-v1",
    "evaluationVersion": "decimal-v1",
    "status": "COMPLETED",
    "outcome": "PASSED",
    "startedAt": "2026-11-03T12:00:00.000Z",
    "finishedAt": "2026-11-03T12:00:01.000Z",
    "requestedBy": { "id": "…", "email": "operator@example.com", "role": "OPERATOR" },
    "reasonCode": null,
    "expectedSampleCount": 5,
    "recordedSampleCount": 5,
    "outOfToleranceCount": 0,
    "stepCount": 3,
    "partial": false
  },
  "rightRun": { "...": "Same shape as leftRun" },
  "matchedSteps": [
    {
      "logicalStepId": "…",
      "changedFields": [
        { "field": "unit", "left": "A", "right": "mA" },
        { "field": "position", "left": 2, "right": 1 },
        { "field": "minimum", "left": "0.450000", "right": "450.000000" },
        { "field": "maximum", "left": "0.550000", "right": "550.000000" }
      ],
      "numericComparison": {
        "comparable": false,
        "reason": "UNIT_MISMATCH",
        "statistics": null
      },
      "left": { "...": "RunSnapshotStepDto with stored summary and measurements" },
      "right": { "...": "RunSnapshotStepDto with stored summary and measurements" }
    }
  ],
  "addedSteps": [{ "...": "right-only RunSnapshotStepDto" }],
  "removedSteps": [{ "...": "left-only RunSnapshotStepDto" }]
}
```

- `changedFields` is an array of `{field, left, right}` objects in the fixed
  order `name`, `unit`, `position`, `minimum`, `maximum`, `sampleCount`,
  `intervalMs`. Only changed fields are present; each value comes from that
  run's own snapshot.
- `leftRun` and `rightRun` are run summaries; the embedded `left`/`right` step
  objects use the run snapshot step shape: copied rules, verdict, counters,
  stored statistics and measurements. A finished run is never re-evaluated with
  another version's limits.
- `addedSteps` contains only right-run steps and `removedSteps` only left-run
  steps. The absent side is not represented by a zero-filled or empty step.
- When a matched step has the same unit, `numericComparison.statistics` holds
  side-by-side values and `delta = right - left` (six-fraction-digit decimal
  text; sample count is an integer). When units differ, `comparable` is false,
  `reason` is `UNIT_MISMATCH` and `statistics` is `null`; no numeric delta is
  produced.
- Each measurement series keeps its own `sampleIndex` and `elapsedMs`. The API
  never interpolates, normalises, pads or index-aligns two series, even when
  `sampleCount` or `intervalMs` changed.
- A partial terminal run remains comparable. Its missing statistics are `null`
  in every member and its missing measurements are an empty array; no `0` or
  `PASSED` placeholder is inserted. `leftRun.partial` / `rightRun.partial` is
  true.
- Matched steps are ordered by the left position and then `logicalStepId`;
  added/removed steps by their own side's position then `logicalStepId`. The
  response contains no generated timestamp and identical stored data always
  serialises identically.
- Both runs, their steps and measurements are read in one `REPEATABLE READ`
  transaction. The endpoint never queries the live plan or draft.

The OpenAPI document contains the `RunComparisonDto`, matched/one-sided step,
rule-change and numeric-comparison schemas. The generated client package must
be rebuilt from this document before the comparison UI uses the new types.

## Run event stream (SSE)

`GET /api/runs/:id/events` streams the committed `RunEvent` rows for one run to
a Planner, Operator or Viewer session. The endpoint returns `text/event-stream`
and is read-only; it does not accept a CSRF header and never changes a run.

```text
id: 7
event: measurement.recorded
data: {"schemaVersion":1,"runId":"…","sequence":7,"occurredAt":"2026-11-03T12:00:00.000Z","payload":{…}}

: heartbeat

```

- `id` is the run-local event sequence. `data` is the persisted event's
  `{schemaVersion, runId, sequence, occurredAt, payload}` envelope. `event` is
  one of `run.started`, `step.started`, `measurement.recorded`, `step.completed`,
  `run.completed`, `run.cancelled`, `run.interrupted` and `run.errored`.
- `?after=<sequence>` is the last sequence already applied by the client. It
  defaults to `0`. On an automatic `EventSource` reconnect, the `Last-Event-ID`
  header takes precedence over the query value whenever it is present.
- A run id must exist (`404 NOT_FOUND`) and the cursor must be a non-negative
  integer that does not exceed `lastEventSequence` (`400 VALIDATION_ERROR`).
  Unknown query parameters are also `400`. All of these checks finish before
  the first SSE header, so their responses use the normal JSON error body with
  `requestId`.
- A terminal run with no event newer than the cursor returns `204 No Content`
  instead of opening a stream. With a backlog, the server replays through the
  terminal event and then closes. A terminal event is always the last frame.
- Replay and live follow read the same durable table in ascending sequence
  order. The default follow-up poll is 200 ms, one query at a time per
  connection; replay/live handover therefore has no gap or duplicate. The
  cursor is authoritative when a client reconnects.
- A `: heartbeat` SSE comment is sent every 15 seconds. It consumes no event
  sequence. Each heartbeat revalidates the session; expiry or revocation ends
  the stream cleanly at the latest on the next heartbeat.
- A client disconnect cancels the connection's poll timer, heartbeat timer and
  follow-up query after it returns. It does not stop or cancel the run executor.
- Responses send `Cache-Control: no-cache`, `Connection: keep-alive` and
  `X-Accel-Buffering: no`, and headers are flushed before the first frame so a
  proxy does not buffer the stream.

The OpenAPI document describes the `text/event-stream` response and the
`RunEventEnvelopeDto` component. OpenAPI cannot represent individual SSE
frames, so event names and payloads are documented here and in the controller
description; generated REST client types do not model the stream. SSE payloads
contain run, step and measurement data only: no password, session, draft,
idempotency-key or request-hash fields.

## Cancellation, interruption and technical errors

`POST /api/runs/:id/cancel` requires an Operator session and the CSRF header. It
locks the run row with a conditional update, re-checks `RUNNING`, then in one
transaction writes:

- the run as `CANCELLED` with `finishedAt`, `cancelledById` and
  `reasonCode: "USER_CANCELLED"`;
- the active step as `CANCELLED` with `finishedAt`;
- every step that never started as `NOT_RUN`;
- one `run.cancelled` event at the next sequence.

Committed measurements, counters and completed step results are untouched. The
endpoint returns `200` with the full snapshot. If the run is already terminal,
the existing snapshot is returned unchanged and no event is appended; repeating
the request is safe. The in-process executor is signalled after the terminal
commit, so its timer stops and every later write is rejected by the row-status
check. A sample racing the cancel either commits before the terminal transition
or does not exist.

Startup recovery runs before readiness becomes `ok` and before a new run can
start. Every leftover `RUNNING` run is closed in its own transaction as
`INTERRUPTED` with `reasonCode: "SERVER_RESTART"`; the active step becomes
`INTERRUPTED`, pending steps become `NOT_RUN`, and one `run.interrupted` event is
appended. Recovery never resumes a run and never deletes measurements or
completed steps. Re-running recovery over terminal history changes nothing.

A controlled shutdown stops executor timers without writing a terminal status.
The next process reconciles the still-RUNNING rows through the same recovery
path.

Invalid simulator output and persistence/execution failures are technical
errors, not tolerance verdicts. When the database is reachable the run becomes
`ERROR` with `outcome: null`, the active step becomes `ERROR`, pending steps
become `NOT_RUN`, and `run.errored` carries a safe reason code such as
`SIMULATOR_OUTPUT_INVALID` or `EXECUTION_FAILED`. Already committed samples are
preserved. If the database cannot record the failure, the run stays RUNNING for
startup recovery, readiness stays failed and new starts are rejected. Logs
contain only run ids, reason codes and fixed messages; SQL, connection strings
and stack traces are never logged or returned.

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
