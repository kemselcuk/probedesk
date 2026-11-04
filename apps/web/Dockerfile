# syntax=docker/dockerfile:1.7
#
# ProbeDesk web image. Build context is the repository root because this is an
# npm workspace; build with:
#   docker build -f apps/web/Dockerfile -t probedesk-web .
#
# The build runs the Angular production build and copies only the browser
# output into nginx. nginx serves the SPA with a history fallback and proxies
# /api to the API service without buffering SSE responses.

FROM node:22.23.2-alpine AS base

# Match the repository packageManager pin; the bundled npm is older.
RUN npm install --global npm@11.6.2 --no-audit --no-fund

WORKDIR /workspace

FROM base AS deps

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/api-client/package.json packages/api-client/package.json

RUN npm ci --no-audit --no-fund

FROM deps AS build

WORKDIR /workspace

COPY . .

RUN npm run build --workspace apps/web

FROM nginx:1.29.4-alpine AS runtime

COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/web/dist/web/browser /usr/share/nginx/html

EXPOSE 8080

# The official nginx entrypoint keeps the master process in the container and
# workers run as the unprivileged `nginx` user. Binding 8080 avoids root-only
# privileged ports.
