# ProbeDesk repository rules

These rules apply to every human or agent working in this repository.

## Source of truth

1. Start with `docs/implementation-guide.md` and follow its reading order.
2. `docs/` is the contract: `requirements.md`, `measurement-rules.md`, `simulation.md`,
   `architecture.md`, `data-model.md`, `api.md`, `frontend.md`, `testing.md`, `demo.md`,
   `acceptance.md`, and the task cards in `docs/tasks/`.
3. Implement one task card at a time. Do not silently change product scope, roles, accepted
   behaviour, cost constraints, or add paid services. Raise scope changes to the user.
4. Never mark work as done, tested, accepted, or verified unless the command was actually run
   and its real output is recorded. Task cards move `Planned → In Progress → In Review → Accepted`
   and require a separate review record before `Accepted`.

## Language

- UI copy, API messages, identifiers, commit messages and the README are English.
- Communication with the user and the planning documents are Turkish.

## Git: commit and push regularly

- Commit at every coherent, reviewable step (a task, a fix, a contract update) once the
  relevant checks pass. Do not batch unrelated work into one large commit.
- Push to `origin/main` immediately after each commit so progress is never only local.
  Use the tracking branch `main`; do not force-push or rewrite shared history.
- Update the task card status, the evidence fields, `docs/tasks/README.md` and
  `docs/roadmap.md` in the same commit whenever a task status changes.
- Never commit `.env`, credentials, tokens, cookies or generated secrets. `.env.example`
  documents required variables without real values.
- Commit messages use a prefix such as `feat:`, `fix:`, `test:`, `docs:`, `chore:`,
  `refactor:`, and describe the behaviour, not just the files.

## Parallel agents

- The orchestrating lead owns git commits and pushes while several agents work in the shared
  checkout. Workers must not run `git add`, `git commit`, `git push`, `git checkout`,
  `git reset` or `git stash`.
- Each worker owns a disjoint set of paths. Do not edit files owned by another worker while
  it is running. Add a dependency or shared file through the lead.
- Every worker reports: files changed, commands run with real results, and anything left
  undone or unverified. No summaries that claim unrun checks.

## Code conventions

- TypeScript strict mode; no unexplained `any`. Backend is ESM (`module: nodenext`).
- Angular uses standalone components, typed Reactive Forms, RxJS facade services, and
  Angular Material/CDK. Components do not compute measurement verdicts; the backend does.
- Keep NestJS controllers thin; state transitions and transactions live in services.
- Numeric tolerance values are decimal strings at the API boundary; never compare them with
  binary floating point equality.
- Tests exercise observable behaviour with real PostgreSQL for database constraints and real
  HTTP/SSE for protocol behaviour. Do not replace a database or canvas constraint with a mock.
- Keep the dependency set pinned and the lockfile committed. Prefer free/local tooling; the
  additional infrastructure cost target is €0.

## Commands

Planned and verified commands live in `docs/testing.md` and the root `package.json`:
`npm ci`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:api:unit`,
`npm run test:api:integration`, `npm run test:web`, `npm run openapi:check`, `npm run verify`.
Only commands that exist and have been run may be documented as available.

## Toolchain

- Node.js `22.23.2` (see `.nvmrc`); Angular 22.2.4 requires `^22.22.3 || ^24.15.0`.
- npm `11.6.2` is pinned in `packageManager`. The system npm 10.9.8 fails workspace peer
  resolution, so run installs as `npx npm@11.6.2 install` (or `npx npm@11.6.2 ci`).
- Keep one root `package-lock.json`; never commit nested lockfiles.

