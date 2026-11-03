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
and refuses to run when `TEST_DATABASE_URL` is missing or aliases
`DATABASE_URL`.

## Run

```bash
npm run start:dev --workspace apps/api
```

The API listens under `/api`. Health probes:

- `GET http://127.0.0.1:3000/api/health/live`
- `GET http://127.0.0.1:3000/api/health/ready`

Swagger UI is served at `/api/docs`; the JSON document is at `/api/docs-json`.

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
npm run test:db:persistence --workspace apps/api
```

This check inserts a temporary `device_profiles` row, recreates the development
`postgres` container with the same named volume, confirms the row, and removes it.

## OpenAPI

```bash
npm run openapi:emit --workspace apps/api
```

Writes `apps/api/openapi.json`. The generator does not open a database
connection and succeeds with PostgreSQL stopped.
