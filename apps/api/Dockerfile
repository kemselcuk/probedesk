# syntax=docker/dockerfile:1.7
#
# ProbeDesk API image. Build context is the repository root because this is an
# npm workspace; build with:
#   docker build -f apps/api/Dockerfile --target runtime -t probedesk-api .
#
# Targets:
#   runtime  compiled ESM API on Node 22, production dependencies only, non-root
#   migrate  production dependencies plus the Prisma CLI/schema, used for
#            `prisma migrate deploy`

FROM node:22.23.2-alpine AS base

# The repository pins npm 11.6.2 in packageManager. The npm bundled with the
# Node image is older and must not resolve the workspace peer graph differently.
RUN npm install --global npm@11.6.2 --no-audit --no-fund

WORKDIR /workspace

FROM base AS deps

# Copy only the workspace manifests first so the dependency layer is cached
# independently of source changes. All workspaces are listed because the root
# lockfile and npm workspace resolution cover the whole repository.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/api-client/package.json packages/api-client/package.json

RUN npm ci --no-audit --no-fund

FROM deps AS build

WORKDIR /workspace

COPY . .

# The API build script regenerates the Prisma client into
# apps/api/src/prisma/generated before running `nest build`.
RUN npm run build --workspace apps/api

# Production dependencies for the API workspace only. The web and api-client
# runtime dependencies are intentionally not shipped in the API image. This
# stage keeps the Prisma CLI tree, which the migration target reuses.
FROM base AS prod-deps

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/api-client/package.json packages/api-client/package.json

RUN npm ci --omit=dev --workspace apps/api --no-audit --no-fund

# `@prisma/client` declares `prisma` as an optional peer, and npm installs the
# Prisma CLI/Studio dependency tree even with --omit=dev. The API runtime needs
# only the generated client, its runtime utility package and the pg adapter.
# Remove the CLI-only tree from the API runtime copy; the migration target below
# still starts from the full prod-deps stage and keeps the CLI.
FROM prod-deps AS runtime-deps

RUN rm -rf \
    node_modules/prisma \
    node_modules/typescript \
    node_modules/@prisma/config \
    node_modules/@prisma/dev \
    node_modules/@prisma/engines \
    node_modules/@prisma/engines-version \
    node_modules/@prisma/fetch-engine \
    node_modules/@prisma/get-platform \
    node_modules/@prisma/query-plan-executor \
    node_modules/@prisma/streams-local \
    node_modules/@prisma/studio-core \
    node_modules/@electric-sql \
    node_modules/effect \
    node_modules/elkjs \
    node_modules/@visx \
    node_modules/react-dom \
    node_modules/@microsoft \
    node_modules/remeda

FROM node:22.23.2-alpine AS runtime

# This image is the documented localhost demo delivery. A production deployment
# needs TLS and SESSION_COOKIE_SECURE=true; see docs/architecture.md.
ENV NODE_ENV=development
WORKDIR /app/apps/api

# npm hoists most dependencies to the workspace root, but keeps a few
# workspace-local packages (currently zod) under apps/api/node_modules. Both
# trees are needed for normal Node resolution from dist/main.js.
COPY --from=runtime-deps /workspace/node_modules /app/node_modules
COPY --from=runtime-deps /workspace/apps/api/node_modules ./node_modules
COPY --from=build /workspace/apps/api/dist ./dist
COPY --from=build /workspace/apps/api/package.json ./package.json

# Build-time resolution guard: catch a missing runtime dependency while the
# image is being built instead of at container start.
RUN node -e "import('./dist/app.module.js').then(() => console.log('API runtime modules resolve'))"

# The Node image already provides an unprivileged `node` user. Nothing in the
# runtime path writes to the image, so the application only needs read access.
USER node

EXPOSE 3000

# Single process on purpose: the supported deployment is one API process.
CMD ["node", "dist/main.js"]

FROM prod-deps AS migrate

WORKDIR /workspace

# The migration target reuses the production dependency install from prod-deps.
# It needs the Prisma CLI, the schema and the checked-in migrations; it does not
# need Angular, the web workspace or the compiled API.
COPY apps/api/prisma ./apps/api/prisma
COPY apps/api/prisma.config.ts ./apps/api/prisma.config.ts

# `prisma migrate deploy` only applies registered migrations. It never resets
# the database; destructive resets are intentionally not part of delivery.
CMD ["npm", "run", "db:migrate", "--workspace", "apps/api"]

# One-shot demo seed target. It reuses the full build stage because the seed is
# TypeScript and intentionally additive/idempotent; production images do not
# include the seed tooling.
FROM build AS seed

WORKDIR /workspace

CMD ["npm", "run", "demo:seed", "--workspace", "apps/api"]
