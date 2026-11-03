<img src="assets/icon.svg" width="64" height="64" alt="ProbeDesk icon">

# ProbeDesk

ProbeDesk is a planned application for creating versioned test plans for electronic devices, running a deterministic software simulator, inspecting measurements against tolerances, and comparing test runs.

**Status: Phases 1, 2 and 3 accepted.** The workspace, authentication, sessions,
OpenAPI client and CI pipeline work (Phase 1). Phase 2 adds versioned measurement plans:
Planner draft create/edit/reorder/save, publish v1/v2, immutable published versions and a
read-only version view (accepted after independent review). Phase 3 adds the deterministic
simulator, sequential execution, run snapshots, cancel/recovery and run screens (accepted after
independent review). Live SSE updates are in progress; history, charts and comparison are still
pending; the documents describe the intended product and its acceptance
criteria, not completed features.

## Start here

- [Implementation guide](docs/implementation-guide.md): reading order, first task, and delivery rules.
- [Documentation index](docs/README.md): all product and technical documents.
- [Roadmap](docs/roadmap.md): nine phases and 62 small implementation tasks.
- [Task cards](docs/tasks/README.md): dependencies, ownership, checks, and review criteria.
- [Product requirements](docs/requirements.md).
- [Architecture](docs/architecture.md), [data model](docs/data-model.md), and [API contract](docs/api.md).
- [Final acceptance checklist](docs/acceptance.md).

The application and user-facing messages will be in English. The implementation documentation is in Turkish; identifiers and protocol names use English.

## Intended demo

Create a three-step plan → publish v1 → run a forced failure scenario → inspect the failed measurement and step → run the normal scenario → compare both runs → publish v2 → confirm that the previous run still shows its original rules and result.

The initial device profile is **DC Power Module**. The planned product has three seeded accounts: Planner, Operator, and Viewer. It supports one active test run at a time.

## Planned stack

- Backend: Node.js, TypeScript, NestJS, PostgreSQL, Prisma, REST/OpenAPI, SSE.
- Frontend: Angular, typed Reactive Forms, RxJS, Angular Material/CDK, Chart.js.
- Verification and delivery: backend tests, Angular component tests, Playwright, Docker Compose, GitHub Actions.

Version candidates and compatibility checks are recorded in [architecture](docs/architecture.md). They have not been validated by installing or building this project.

## Local development (Phase 1)

Prerequisites: Node.js 22.23.2 (see `.nvmrc`), npm 11.6.2 and Docker.

```bash
npx npm@11.6.2 ci
docker compose up -d
cp .env.example .env
npm run db:migrate
npm run demo:seed
npm run dev
```

Open `http://localhost:4200`. The Angular dev server proxies `/api` to
`http://127.0.0.1:3000`. If port 5432 is already used on your machine, set both
`PROBEDESK_DEV_DB_PORT` and the port inside `DATABASE_URL` in `.env` (for example
`5434`) before starting Compose.

Demo accounts (local demo data only):

| Role | Email | Password |
|---|---|---|
| Planner | `planner@probedesk.local` | `PlannerDemo!2026` |
| Operator | `operator@probedesk.local` | `OperatorDemo!2026` |
| Viewer | `viewer@probedesk.local` | `ViewerDemo!2026` |

Quality checks:

```bash
npm run verify                 # lint, typecheck, unit tests, web tests, build
docker compose -f compose.test.yaml up -d
npm run db:migrate:test --workspace apps/api
npm run test:api:integration   # real PostgreSQL integration/E2E tests
npm run openapi:check          # contract + generated client drift
```

These commands were run against this repository during Phase 1. The full
delivery flow (Compose for the whole application, seeded demo data and the demo
video) is still pending Phases 4-8.

The additional infrastructure cost target is **€0**, using a local environment and applicable free CI allowances. See [cost constraints](docs/architecture.md#maliyet-ve-teslim-sinirlari).

No feature, performance result, test count, coverage figure, CI badge, or screenshot should be presented as verified until its evidence is recorded in [docs/evidence](docs/evidence/README.md).
