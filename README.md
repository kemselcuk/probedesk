<img src="assets/icon.svg" width="64" height="64" alt="ProbeDesk icon">

# ProbeDesk

ProbeDesk is a planned application for creating versioned test plans for electronic devices, running a deterministic software simulator, inspecting measurements against tolerances, and comparing test runs.

**Status: implementation started.** P1-01 has created the npm workspace, Angular and NestJS
skeletons, and a verified version lock (see [architecture](docs/architecture.md#p1-01-ile-doğrulanan-sürümler-2026-11-03)).
There is no runnable product flow yet; the documents describe the intended product and its
acceptance criteria, not completed features.

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

## Local setup and evidence

Runnable setup commands will be added after implementation and clean-install verification. Planned command names are listed in the [testing and delivery contract](docs/testing.md#planlanan-komutlar).

The additional infrastructure cost target is **€0**, using a local environment and applicable free CI allowances. See [cost constraints](docs/architecture.md#maliyet-ve-teslim-sinirlari).

No feature, performance result, test count, coverage figure, CI badge, or screenshot should be presented as verified until its evidence is recorded in [docs/evidence](docs/evidence/README.md).
