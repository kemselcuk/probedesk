#!/usr/bin/env node
/**
 * CI E2E orchestrator (P7-06).
 *
 * Starts the built API against the dedicated E2E database, serves the built
 * Angular app through scripts/app-server.mjs with an /api proxy to that API,
 * waits for bounded readiness probes, and then runs Playwright. Traces and
 * screenshots are configured by playwright.config.ts (failure only).
 *
 * Environment separation is deliberate:
 * - The API child receives DATABASE_URL=$E2E_DATABASE_URL.
 * - The Playwright child receives E2E_DATABASE_URL but no DATABASE_URL or
 *   TEST_DATABASE_URL. tests/e2e/support/database.ts refuses cleanup when the
 *   E2E URL equals DATABASE_URL; the test process does not need DATABASE_URL at
 *   all, so it is removed instead of pointing it at the same database.
 *
 * Required before running:
 *   node scripts/e2e-isolated.mjs prepare
 *   npm run build --workspace apps/api
 *   npm run build --workspace apps/web
 *
 * Usage:
 *   E2E_DATABASE_URL=postgresql://.../probedesk_e2e_test node scripts/ci-e2e.mjs
 *
 * Optional:
 *   E2E_API_PORT (default 3100), E2E_WEB_PORT (default 4300),
 *   E2E_LOG_DIR (default <tmp>/probedesk-ci-e2e), PW_CHANNEL (default chrome).
 *   Extra arguments are passed to `playwright test`.
 */
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const apiRoot = join(root, 'apps', 'api');
const apiPort = Number(process.env.E2E_API_PORT ?? 3100);
const webPort = Number(process.env.E2E_WEB_PORT ?? 4300);
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const webBaseUrl = `http://127.0.0.1:${webPort}`;
const databaseUrl = process.env.E2E_DATABASE_URL;
const logDir = process.env.E2E_LOG_DIR ?? join(tmpdir(), 'probedesk-ci-e2e');
const readinessTimeoutMs = 90_000;
const webTimeoutMs = 30_000;

const children = new Map();
const exits = new Map();
let playwrightProcess = null;
let shuttingDown = false;

function fail(message) {
  console.error(`[ci-e2e] ${message}`);
  process.exit(1);
}

function assertPort(value, name) {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    fail(
      `${name} must be an integer between 1 and 65535; received "${String(value)}".`,
    );
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startChild(name, command, args, options) {
  const log = createWriteStream(join(logDir, `${name}.log`), { flags: 'a' });
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const forward = (stream, target) => {
    stream.on('data', (chunk) => {
      log.write(chunk);
      target.write(chunk);
    });
  };
  forward(child.stdout, process.stdout);
  forward(child.stderr, process.stderr);

  const exitPromise = new Promise((resolve) => {
    child.once('error', (error) => {
      exits.set(name, { code: null, signal: null, error });
      resolve(exits.get(name));
    });
    child.once('exit', (code, signal) => {
      const exit = { code, signal };
      exits.set(name, exit);
      log.end();
      resolve(exit);
    });
  });

  children.set(name, { child, exitPromise, log });
  console.log(`[ci-e2e] started ${name} (pid ${child.pid ?? 'unknown'})`);
  return child;
}

function unexpectedExit(name) {
  const exit = exits.get(name);
  if (!exit) return undefined;
  return new Error(
    `${name} exited before readiness: ${
      exit.error instanceof Error ? exit.error.message : JSON.stringify(exit)
    }`,
  );
}

async function waitForHttp(name, url, options) {
  const deadline = Date.now() + options.timeoutMs;
  let last = 'no response yet';

  while (Date.now() < deadline) {
    const exited = unexpectedExit(name);
    if (exited) throw exited;

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      const body = await response.text();

      if (response.ok && options.accept(response, body)) {
        console.log(`[ci-e2e] ${name} ready at ${url} (${response.status})`);
        return;
      }

      last = `status ${response.status}, content-type ${response.headers.get('content-type') ?? 'none'}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }

    await delay(500);
  }

  throw new Error(
    `Timed out after ${options.timeoutMs} ms waiting for ${name} at ${url}. Last probe: ${last}. ` +
      `Logs: ${logDir}`,
  );
}

async function stopChild(name) {
  const entry = children.get(name);
  if (!entry) return;
  const { child, exitPromise } = entry;
  if (exits.has(name)) return;

  child.kill('SIGTERM');
  const stopped = await Promise.race([
    exitPromise.then(() => true),
    delay(5_000).then(() => false),
  ]);

  if (!stopped && !exits.has(name)) {
    child.kill('SIGKILL');
    await Promise.race([exitPromise, delay(2_000)]);
  }
}

async function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;

  if (playwrightProcess && playwrightProcess.exitCode === null) {
    playwrightProcess.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => playwrightProcess.once('exit', resolve)),
      delay(5_000),
    ]);
    if (playwrightProcess.exitCode === null) {
      playwrightProcess.kill('SIGKILL');
    }
  }

  for (const name of [...children.keys()].reverse()) {
    await stopChild(name);
  }

  process.exit(exitCode);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.error(`[ci-e2e] received ${signal}; stopping child processes`);
    void shutdown(signal === 'SIGINT' ? 130 : 143);
  });
}

async function main() {
  if (!databaseUrl) {
    fail(
      'E2E_DATABASE_URL is required. Run "node scripts/e2e-isolated.mjs prepare" first.',
    );
  }

  assertPort(apiPort, 'E2E_API_PORT');
  assertPort(webPort, 'E2E_WEB_PORT');

  const apiEntry = join(apiRoot, 'dist', 'main.js');
  if (!existsSync(apiEntry)) {
    fail(
      `Missing ${apiEntry}. Run "npm run build --workspace apps/api" first.`,
    );
  }

  const webDist =
    process.env.WEB_DIST ?? join(root, 'apps', 'web', 'dist', 'web');
  if (
    !existsSync(join(webDist, 'index.html')) &&
    !existsSync(join(webDist, 'browser', 'index.html'))
  ) {
    fail(
      `Missing a built Angular app under ${webDist}. Run ` +
        '"npm run build --workspace apps/web" first.',
    );
  }

  const playwrightCli = join(
    root,
    'node_modules',
    '@playwright',
    'test',
    'cli.js',
  );
  if (!existsSync(playwrightCli)) {
    fail(`Missing ${playwrightCli}. Run "npx --yes npm@11.6.2 ci" first.`);
  }

  mkdirSync(logDir, { recursive: true });
  console.log(`[ci-e2e] logs: ${logDir}`);

  startChild('api', process.execPath, [apiEntry], {
    cwd: apiRoot,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: 'development',
      PROBEDESK_SKIP_DOTENV: '1',
      DATABASE_URL: databaseUrl,
      PORT: String(apiPort),
      SESSION_COOKIE_SECURE: 'false',
    },
  });

  await waitForHttp('api', `${apiBaseUrl}/api/health/ready`, {
    timeoutMs: readinessTimeoutMs,
    accept: (_response, body) => {
      try {
        const parsed = JSON.parse(body);
        return (
          parsed.status === 'ok' &&
          parsed.checks?.database === 'ok' &&
          parsed.checks?.migrations === 'ok'
        );
      } catch {
        return false;
      }
    },
  });

  startChild(
    'web',
    process.execPath,
    [join(root, 'scripts', 'app-server.mjs')],
    {
      cwd: root,
      env: {
        ...process.env,
        APP_PORT: String(webPort),
        PROXY_URL: apiBaseUrl,
      },
    },
  );

  await waitForHttp('web', `${webBaseUrl}/`, {
    timeoutMs: webTimeoutMs,
    accept: (response, body) => {
      const contentType = response.headers.get('content-type') ?? '';
      return contentType.includes('text/html') && body.includes('<app-root');
    },
  });

  const playwrightEnv = {
    ...process.env,
    E2E_DATABASE_URL: databaseUrl,
    E2E_API_URL: apiBaseUrl,
    E2E_BASE_URL: webBaseUrl,
    PW_CHANNEL: process.env.PW_CHANNEL ?? 'chrome',
  };
  delete playwrightEnv.DATABASE_URL;
  delete playwrightEnv.TEST_DATABASE_URL;
  delete playwrightEnv.E2E_ALLOW_DATABASE_CLEANUP;

  console.log('[ci-e2e] starting Playwright');
  playwrightProcess = spawn(
    process.execPath,
    [playwrightCli, 'test', ...process.argv.slice(2)],
    {
      cwd: root,
      env: playwrightEnv,
      stdio: 'inherit',
    },
  );

  const exit = await new Promise((resolve) => {
    playwrightProcess.once('error', (error) =>
      resolve({ code: null, signal: null, error }),
    );
    playwrightProcess.once('exit', (code, signal) => resolve({ code, signal }));
  });

  if (exit.error) {
    throw exit.error;
  }

  if (exit.code !== 0) {
    throw new Error(
      `Playwright failed with ${exit.signal ? `signal ${exit.signal}` : `exit code ${exit.code}`}.`,
    );
  }

  console.log('[ci-e2e] Playwright passed');
}

try {
  await main();
  await shutdown(0);
} catch (error) {
  console.error(
    `[ci-e2e] ${error instanceof Error ? error.message : String(error)}`,
  );
  await shutdown(1);
}
