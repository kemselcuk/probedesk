// P4-07 browser lifecycle check: SPA return, Sign out and server-side expiry.
//
// The script serves the built SPA from scripts/app-server.mjs (default 4300)
// and proxies /api through scripts/sse-proxy.mjs (default 3200) to a real API.
// It uses headless Chrome through the DevTools protocol, the same pattern as
// scripts/phase-4-live-check.mjs.
//
// Checks:
//   1. Live Run -> SPA navigation to /plans -> browser back to the same live
//      URL. The same run id is shown, its counters advanced (or it reached a
//      terminal state), no POST /api/runs happened and exactly one stream is
//      open after the return.
//   2. While the live page is open, the app's own "Sign out" action. The app
//      navigates to /login and the stream closes without further reconnects.
//   3. While the live page is open, the operator session is revoked directly
//      in PostgreSQL. The next SSE heartbeat closes the stream, the client
//      probes /auth/me, receives 401 and redirects to /login. The run keeps
//      executing, and a second, independent session watching the same run
//      still receives every event through run.completed.
//
// Usage:
//   RUN_VERSION_ID=<published-plan-version-uuid> \
//     node scripts/phase-4-lifecycle-check.mjs
//
// Environment:
//   RUN_VERSION_ID       Published plan version to execute (required)
//   PROBEDESK_API_URL    API origin (default http://127.0.0.1:3100)
//   APP_PORT             Static app server port (default 4300)
//   APP_URL              Override the app origin (default http://127.0.0.1:$APP_PORT)
//   PROXY_PORT           Streaming proxy port (default 3200)
//   CHROME_DEBUG_PORT    Chrome DevTools port (default 9338)
//   CHROME_PATH          Chrome executable (default macOS Google Chrome)
//   DATABASE_URL         PostgreSQL URL used to revoke the session and remove
//                        created runs (default: documented dev database)
//   WEB_DIST             Built SPA directory (default apps/web/dist/web)
//   KEEP_RUNS=1          Keep created runs and their rows
//   BUILD_WEB=1          Force a fresh `npm run build --workspace apps/web`
//
// The operator demo account is required. Sessions created by the script are
// revoked at the end; only the runs created by this script are deleted. The
// script imports the workspace-hoisted `pg` package (apps/api dependency).
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';

const BASE_URL = process.env.PROBEDESK_API_URL ?? 'http://127.0.0.1:3100';
const APP_PORT = Number(process.env.APP_PORT ?? 4300);
const APP = process.env.APP_URL ?? `http://127.0.0.1:${APP_PORT}`;
const PROXY_PORT = Number(process.env.PROXY_PORT ?? 3200);
const CHROME_DEBUG_PORT = Number(process.env.CHROME_DEBUG_PORT ?? 9338);
const CHROME =
  process.env.CHROME_PATH ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const VERSION_ID = process.env.RUN_VERSION_ID;
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://probedesk:probedesk@127.0.0.1:5434/probedesk?schema=public';
const KEEP_RUNS = process.env.KEEP_RUNS === '1';

if (!VERSION_ID) throw new Error('RUN_VERSION_ID is required');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function createJar() {
  const cookies = new Map();
  function store(response) {
    for (const value of response.headers.getSetCookie?.() ?? []) {
      const [pair] = value.split(';');
      const index = pair.indexOf('=');
      if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }
  async function request(method, path, body, extra = {}) {
    const headers = { Origin: BASE_URL, Accept: 'application/json', ...extra };
    if (cookies.size)
      headers.Cookie = [...cookies].map(([n, v]) => `${n}=${v}`).join('; ');
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const csrf = cookies.get('XSRF-TOKEN');
    if (csrf) headers['X-XSRF-TOKEN'] = csrf;
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    store(response);
    const text = await response.text();
    return {
      status: response.status,
      data: text ? JSON.parse(text) : null,
      headers: response.headers,
    };
  }
  return {
    request,
    login: (email, password) =>
      request('POST', '/api/auth/login', { email, password }),
    cookieHeader: () => [...cookies].map(([n, v]) => `${n}=${v}`).join('; '),
  };
}

async function startRun(api, body, label, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const active = await api.request('GET', '/api/runs/active');
    assert(active.status === 200, `active-run status ${active.status}`);
    if (active.data === null) {
      const started = await api.request('POST', '/api/runs', body, {
        'Idempotency-Key': `phase4-${label}-${crypto.randomUUID()}`,
      });
      if (started.status === 202) return started.data;
      if (started.status !== 409) {
        throw new Error(
          `start status ${started.status}: ${JSON.stringify(started.data)}`,
        );
      }
    }
    await delay(250);
  }
  throw new Error('The API never reported a free active-run slot');
}

function parseFrames(buffer) {
  const frames = buffer.split('\n\n');
  const rest = frames.pop() ?? '';
  return { events: frames.map(parseFrame).filter(Boolean), rest };
}

function parseFrame(raw) {
  const lines = raw.split('\n');
  const event = { id: null, event: null, data: null };
  for (const line of lines) {
    if (line.startsWith('id:')) event.id = Number(line.slice(3).trim());
    else if (line.startsWith('event:')) event.event = line.slice(6).trim();
    else if (line.startsWith('data:'))
      event.data = JSON.parse(line.slice(5).trim());
  }
  return event.event ? event : null;
}

/** Opens a stream and resolves once the SSE response headers have arrived. */
async function openStream(api, runId, after) {
  const response = await fetch(
    `${BASE_URL}/api/runs/${runId}/events?after=${after}`,
    {
      headers: {
        Accept: 'text/event-stream',
        Origin: BASE_URL,
        Cookie: api.cookieHeader(),
      },
    },
  );
  if (response.status !== 200) {
    return { status: response.status, events: Promise.resolve([]) };
  }
  const events = (async () => {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const received = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseFrames(buffer);
      buffer = parsed.rest;
      for (const event of parsed.events) {
        received.push(event);
        if (event.event.startsWith('run.') && event.event !== 'run.started') {
          reader.releaseLock();
          return received;
        }
      }
    }
    reader.releaseLock();
    return received;
  })();
  return { status: response.status, events };
}

let proxy = null;
let appServer = null;

function ensureWebBuild() {
  const configuredDist = process.env.WEB_DIST;
  const candidates = configuredDist
    ? [
        join(configuredDist, 'browser', 'index.html'),
        join(configuredDist, 'index.html'),
      ]
    : ['apps/web/dist/web/browser/index.html', 'apps/web/dist/web/index.html'];
  if (
    process.env.BUILD_WEB !== '1' &&
    candidates.some((path) => existsSync(path))
  )
    return;

  console.log('Building apps/web because no built bundle was found...');
  const result = spawnSync('npm', ['run', 'build', '--workspace', 'apps/web'], {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(
      'The web build failed; the lifecycle check cannot continue.',
    );
  }
}

function startProxy() {
  proxy = spawn(process.execPath, ['scripts/sse-proxy.mjs'], {
    env: { ...process.env, PROXY_PORT: String(PROXY_PORT), API_URL: BASE_URL },
    stdio: 'ignore',
  });
}
async function waitForProxy() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const response = await fetch(
        `http://127.0.0.1:${PROXY_PORT}/api/health/live`,
      );
      if (response.ok) return;
    } catch {
      // not ready
    }
    await delay(100);
  }
  throw new Error('SSE proxy did not start');
}

function startAppServer() {
  appServer = spawn(process.execPath, ['scripts/app-server.mjs'], {
    env: {
      ...process.env,
      APP_PORT: String(APP_PORT),
      PROXY_URL: `http://127.0.0.1:${PROXY_PORT}`,
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}
async function waitForAppServer() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const response = await fetch(`${APP}/`);
      if (response.ok) return;
    } catch {
      // not ready
    }
    await delay(100);
  }
  throw new Error(`App server did not start at ${APP}`);
}

const userDataDir = mkdtempSync(join(tmpdir(), 'probedesk-chrome-'));
const chrome = spawn(
  CHROME,
  [
    `--remote-debugging-port=${CHROME_DEBUG_PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--headless=new',
    '--window-size=1280,1100',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

async function waitForChrome() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const response = await fetch(
        `http://127.0.0.1:${CHROME_DEBUG_PORT}/json/version`,
      );
      if (response.ok) return;
    } catch {
      // not ready
    }
    await delay(100);
  }
  throw new Error('Chrome DevTools endpoint did not start');
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      } else if (message.method) {
        this.events.push(message);
      }
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  return new Cdp(ws);
}

async function openTab(url) {
  const target = await (
    await fetch(`http://127.0.0.1:${CHROME_DEBUG_PORT}/json/new?about:blank`, {
      method: 'PUT',
    })
  ).json();
  const cdp = await connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  // Instrumentation only: record every EventSource the app creates so the
  // check can count open streams and prove there are no duplicate reconnects.
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      window.__probedeskDocumentId = String(Date.now()) + ':' + Math.random();
      const Native = window.EventSource;
      window.__probedeskSources = [];
      window.EventSource = class extends Native {
        constructor(...args) {
          super(...args);
          window.__probedeskSources.push({ source: this, createdAt: Date.now() });
        }
      };
    })();`,
  });
  await cdp.send('Page.navigate', { url });
  return cdp;
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(`Evaluation failed: ${result.exceptionDetails.text}`);
  }
  return result.result.value;
}

async function waitFor(cdp, expression, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function loginInBrowser(cdp) {
  await cdp.send('Page.navigate', { url: `${APP}/login` });
  await waitFor(cdp, `!!document.querySelector('#email')`);
  await evaluate(
    cdp,
    `(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const email = document.querySelector('#email');
    const password = document.querySelector('#password');
    set.call(email, 'operator@probedesk.local');
    email.dispatchEvent(new Event('input', { bubbles: true }));
    set.call(password, 'OperatorDemo!2026');
    password.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('form').requestSubmit();
  })()`,
  );
  await waitFor(cdp, `location.pathname === '/plans'`);
  await waitFor(cdp, `document.body.innerText.includes('Role: Operator')`);
}

const liveStateExpr = `(() => {
  const text = document.body.innerText;
  const progress = text.match(/(\\d+) of (\\d+) samples recorded/);
  return {
    path: location.pathname + location.search,
    runId: (text.match(/Run ID\\s*([0-9a-f-]{36})/) ?? [])[1] ?? null,
    status: document.querySelector('.status-label')?.textContent.trim() ?? null,
    connection: (text.match(/Connection:\\s*([A-Za-z]+)/) ?? [])[1] ?? null,
    recorded: progress ? Number(progress[1]) : null,
    expected: progress ? Number(progress[2]) : null,
    terminal: text.includes('Run finished'),
    signedOutLabel: text.includes('Connection: Signed out'),
  };
})()`;

const sourceStateExpr = `(window.__probedeskSources ?? []).map((entry) => ({
  url: entry.source.url,
  readyState: entry.source.readyState,
  createdAt: entry.createdAt,
}))`;

async function readLive(cdp) {
  return evaluate(cdp, liveStateExpr);
}

async function readSources(cdp) {
  return evaluate(cdp, sourceStateExpr);
}

function countRequests(cdp, sinceIndex, predicate) {
  return cdp.events
    .slice(sinceIndex)
    .filter(
      (event) =>
        event.method === 'Network.requestWillBeSent' &&
        predicate(event.params.request),
    ).length;
}

function responsesMatching(cdp, sinceIndex, pattern) {
  return cdp.events
    .slice(sinceIndex)
    .filter(
      (event) =>
        event.method === 'Network.responseReceived' &&
        pattern.test(event.params.response.url),
    )
    .map((event) => ({
      status: event.params.response.status,
      url: event.params.response.url,
    }));
}

async function openLive(cdp, runId) {
  await cdp.send('Page.navigate', { url: `${APP}/runs/${runId}/live` });
  await waitFor(cdp, `location.pathname === '/runs/${runId}/live'`);
  await waitFor(cdp, `document.body.innerText.includes('Live steps')`);
  await waitFor(
    cdp,
    `document.body.innerText.includes('Connection: Connected')`,
  );
  await waitFor(cdp, `(${liveStateExpr}).recorded > 2`, 30000);
}

async function waitForTerminal(api, runId, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const snapshot = await api.request('GET', `/api/runs/${runId}`);
    assert(snapshot.status === 200, `snapshot status ${snapshot.status}`);
    last = snapshot.data;
    if (last.status !== 'RUNNING') return last;
    await delay(250);
  }
  throw new Error(`Run ${runId} did not finish; last status ${last?.status}`);
}

async function waitForActiveRunSlot(api, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const active = await api.request('GET', '/api/runs/active');
    if (active.status === 200 && active.data === null) return;
    await delay(250);
  }
  throw new Error(
    'Another run stayed active; the lifecycle check could not continue',
  );
}

/**
 * Revokes exactly one session by the token cookie captured from the browser.
 * Other sessions of the same operator are left untouched.
 */
async function revokeSessionByCookie(cookieHeader) {
  const match = /(?:^|;\s*)probedesk_session=([^;]+)/.exec(cookieHeader ?? '');
  if (!match) throw new Error('The browser session cookie was not found');
  const tokenHash = createHash('sha256').update(match[1], 'utf8').digest('hex');
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query(
      'UPDATE sessions SET "revokedAt" = now() WHERE "tokenHash" = $1 AND "revokedAt" IS NULL',
      [tokenHash],
    );
    return result.rowCount ?? 0;
  } finally {
    await client.end();
  }
}

async function revokeSessionToken(cookieHeader) {
  const match = /(?:^|;\s*)probedesk_session=([^;]+)/.exec(cookieHeader ?? '');
  if (!match) return 0;
  const tokenHash = createHash('sha256').update(match[1], 'utf8').digest('hex');
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query(
      'UPDATE sessions SET "revokedAt" = now() WHERE "tokenHash" = $1 AND "revokedAt" IS NULL',
      [tokenHash],
    );
    return result.rowCount ?? 0;
  } finally {
    await client.end();
  }
}

async function browserSessionCookie(cdp) {
  const result = await cdp.send('Network.getCookies', { urls: [APP] });
  const cookie = result.cookies.find(
    (candidate) => candidate.name === 'probedesk_session',
  );
  if (!cookie)
    throw new Error('probedesk_session cookie is missing in the browser');
  return `probedesk_session=${cookie.value}`;
}

async function cleanupRuns(runIds) {
  if (runIds.length === 0) return 0;
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'DELETE FROM measurements WHERE "runId" = ANY($1::uuid[])',
      [runIds],
    );
    await client.query(
      'DELETE FROM run_events WHERE "runId" = ANY($1::uuid[])',
      [runIds],
    );
    await client.query(
      'DELETE FROM run_steps WHERE "runId" = ANY($1::uuid[])',
      [runIds],
    );
    const deleted = await client.query(
      'DELETE FROM test_runs WHERE id = ANY($1::uuid[])',
      [runIds],
    );
    await client.query('COMMIT');
    return deleted.rowCount ?? 0;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

async function screenshot(cdp, path) {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path, Buffer.from(shot.data, 'base64'));
}

const createdRunIds = [];
const createdSessions = [];
const evidence = {};

async function main() {
  ensureWebBuild();
  console.log(`APP_URL=${APP} (served by scripts/app-server.mjs)`);
  startProxy();
  await waitForProxy();
  startAppServer();
  await waitForAppServer();
  await waitForChrome();

  const api = createJar();
  assert(
    (await api.login('operator@probedesk.local', 'OperatorDemo!2026'))
      .status === 200,
    'api login',
  );
  createdSessions.push(api.cookieHeader());

  const tab = await openTab(`${APP}/login`);
  await loginInBrowser(tab);

  // ---------------------------------------------------------------------
  // 1. Real SPA return: live -> /plans -> back to the same live URL.
  // ---------------------------------------------------------------------
  const runA = await startRun(
    api,
    { planVersionId: VERSION_ID, scenario: 'NORMAL', seed: 41 },
    'return',
  );
  createdRunIds.push(runA.runId);
  await tab.send('Page.navigate', { url: `${APP}/runs/${runA.runId}/live` });
  await waitFor(tab, `location.pathname === '/runs/${runA.runId}/live'`);
  await waitFor(
    tab,
    `document.body.innerText.includes('Connection: Connected')`,
  );
  await waitFor(tab, `(${liveStateExpr}).recorded > 3`, 30000);

  const beforeReturn = await readLive(tab);
  const documentIdBeforeReturn = await evaluate(
    tab,
    `window.__probedeskDocumentId`,
  );
  const requestsBeforeReturn = tab.events.length;
  const postsBeforeReturn = countRequests(
    tab,
    requestsBeforeReturn,
    (request) =>
      request.method === 'POST' && /\/api\/runs(?:\?|$)/.test(request.url),
  );
  assert(postsBeforeReturn === 0, 'no run was created before the return check');

  await evaluate(
    tab,
    `(() => {
      const link = document.querySelector('#primary-navigation a[href="/plans"]');
      if (!link) throw new Error('Test Plans navigation link not found');
      link.click();
    })()`,
  );
  await waitFor(tab, `location.pathname === '/plans'`);
  await waitFor(tab, `document.body.innerText.includes('Test Plans')`);
  await delay(2500);
  const whileAway = {
    path: await evaluate(tab, `location.pathname`),
    sources: await readSources(tab),
  };
  assert(
    whileAway.sources.filter((source) => source.readyState === 1).length === 0,
    'the live stream closed while the screen was away',
  );

  await evaluate(tab, `history.back()`);
  await waitFor(tab, `location.pathname === '/runs/${runA.runId}/live'`, 20000);
  await waitFor(
    tab,
    `document.body.innerText.includes('Connection: Connected')`,
    30000,
  );
  await delay(700);
  const afterReturn = await readLive(tab);
  const documentIdAfterReturn = await evaluate(
    tab,
    `window.__probedeskDocumentId`,
  );
  const sourcesAfterReturn = await readSources(tab);
  const openAfterReturn = sourcesAfterReturn.filter(
    (source) => source.readyState === 1,
  );
  const postsAfterReturn = countRequests(
    tab,
    requestsBeforeReturn,
    (request) =>
      request.method === 'POST' && /\/api\/runs(?:\?|$)/.test(request.url),
  );

  assert(
    afterReturn.path === `/runs/${runA.runId}/live`,
    'the same live URL is shown after return',
  );
  assert(
    documentIdAfterReturn === documentIdBeforeReturn,
    'the return stayed inside the same SPA document',
  );
  assert(
    afterReturn.runId === runA.runId,
    'the same run id is shown after return',
  );
  assert(
    (afterReturn.recorded ?? 0) > (beforeReturn.recorded ?? 0) ||
      afterReturn.terminal,
    'the run continued while the screen was away',
  );
  assert(
    postsAfterReturn === 0,
    'returning to the live screen did not create a new run',
  );
  assert(
    openAfterReturn.length === 1,
    `exactly one live stream is open after return (got ${openAfterReturn.length})`,
  );
  assert(
    openAfterReturn[0].url.includes(`/api/runs/${runA.runId}/events`),
    'the open stream belongs to the same run',
  );

  const runATerminal = await waitForTerminal(api, runA.runId);
  assert(
    runATerminal.status === 'COMPLETED',
    `run A completed (got ${runATerminal.status})`,
  );
  assert(runATerminal.outcome === 'PASSED', 'run A passed');

  await screenshot(tab, 'docs/evidence/phase-4-lifecycle-return.png');
  evidence.return = {
    runId: runA.runId,
    before: beforeReturn,
    documentIdBeforeReturn,
    documentIdAfterReturn,
    sameSpaDocument: documentIdAfterReturn === documentIdBeforeReturn,
    whileAway: {
      path: whileAway.path,
      openSources: whileAway.sources.filter((source) => source.readyState === 1)
        .length,
      totalSources: whileAway.sources.length,
    },
    after: afterReturn,
    openStreamsAfterReturn: openAfterReturn.length,
    totalSourcesAfterReturn: sourcesAfterReturn.length,
    createdRunRequests: postsAfterReturn,
    serverStatus: runATerminal.status,
    serverOutcome: runATerminal.outcome,
    serverRecordedSampleCount: runATerminal.recordedSampleCount,
  };

  // ---------------------------------------------------------------------
  // 2. Real Sign out from the open live page.
  // ---------------------------------------------------------------------
  await waitForActiveRunSlot(api);
  const runB = await startRun(
    api,
    { planVersionId: VERSION_ID, scenario: 'NORMAL', seed: 42 },
    'signout',
  );
  createdRunIds.push(runB.runId);
  await openLive(tab, runB.runId);
  const beforeSignOut = await readLive(tab);
  const signOutCursor = tab.events.length;
  const sourcesBeforeSignOut = await readSources(tab);

  await evaluate(
    tab,
    `(() => {
      const button = document.querySelector('button.sign-out-action');
      if (!button) throw new Error('Sign out button not found');
      button.click();
    })()`,
  );
  await waitFor(tab, `location.pathname === '/login'`, 15000);
  await waitFor(tab, `!!document.querySelector('#email')`, 15000);
  await delay(500);

  const afterSignOut = {
    path: await evaluate(tab, `location.pathname`),
    hasEmail: await evaluate(tab, `!!document.querySelector('#email')`),
    hasLoginForm: await evaluate(tab, `!!document.querySelector('form')`),
    hasRoleChip: await evaluate(tab, `!!document.querySelector('.role-chip')`),
    hasUserEmail: await evaluate(
      tab,
      `!!document.querySelector('.user-email')`,
    ),
  };
  const sourcesAfterSignOut = await readSources(tab);
  const logoutResponses = responsesMatching(
    tab,
    signOutCursor,
    /\/api\/auth\/logout(?:\?|$)/,
  );
  const eventsRequestsAtLogin = countRequests(tab, signOutCursor, (request) =>
    /\/api\/runs\/[^/]+\/events/.test(request.url),
  );
  await delay(3500);
  const eventsRequestsAfterSettling = countRequests(
    tab,
    signOutCursor,
    (request) => /\/api\/runs\/[^/]+\/events/.test(request.url),
  );
  const sourcesAfterSettling = await readSources(tab);

  assert(afterSignOut.path === '/login', 'the app navigated to /login');
  assert(afterSignOut.hasLoginForm, 'the signed-out login form is rendered');
  assert(
    !afterSignOut.hasRoleChip && !afterSignOut.hasUserEmail,
    'no authenticated identity remains',
  );
  assert(
    logoutResponses.some((response) => response.status === 204),
    'POST /api/auth/logout returned 204',
  );
  assert(
    sourcesBeforeSignOut.filter((source) => source.readyState === 1).length ===
      1,
    'the live stream was open before signing out',
  );
  assert(
    sourcesAfterSignOut.filter((source) => source.readyState === 1).length ===
      0,
    'the live stream closed after signing out',
  );
  assert(
    eventsRequestsAfterSettling === eventsRequestsAtLogin,
    'no reconnect was attempted after the signed-out redirect',
  );
  assert(
    sourcesAfterSettling.length === sourcesAfterSignOut.length,
    'no new EventSource was created after the signed-out redirect',
  );

  const runBImmediately = await api.request('GET', `/api/runs/${runB.runId}`);
  assert(
    runBImmediately.status === 200,
    'run B is still readable by another session',
  );
  const runBTerminal = await waitForTerminal(api, runB.runId);
  assert(
    runBTerminal.status === 'COMPLETED',
    `run B kept executing (got ${runBTerminal.status})`,
  );
  assert(runBTerminal.outcome === 'PASSED', 'run B passed');
  assert(
    runBTerminal.recordedSampleCount >= (beforeSignOut.recorded ?? 0),
    'run B recorded at least the samples seen before sign out',
  );

  await screenshot(tab, 'docs/evidence/phase-4-lifecycle-signout.png');
  evidence.signOut = {
    runId: runB.runId,
    before: beforeSignOut,
    after: afterSignOut,
    logoutStatus: logoutResponses.map((response) => response.status),
    openSourcesAfterSignOut: sourcesAfterSignOut.filter(
      (source) => source.readyState === 1,
    ).length,
    eventSourceCountAfterSettling: sourcesAfterSettling.length,
    eventsRequestsAtLogin,
    eventsRequestsAfterSettling,
    serverStatusAtSignOut: runBImmediately.data.status,
    serverRecordedAtSignOut: runBImmediately.data.recordedSampleCount,
    finalStatus: runBTerminal.status,
    finalOutcome: runBTerminal.outcome,
    finalRecordedSampleCount: runBTerminal.recordedSampleCount,
  };

  // ---------------------------------------------------------------------
  // 3. Server-side session revocation with the live page open.
  // ---------------------------------------------------------------------
  await loginInBrowser(tab);
  const otherSession = createJar();
  assert(
    (await otherSession.login('operator@probedesk.local', 'OperatorDemo!2026'))
      .status === 200,
    'second operator session login',
  );
  createdSessions.push(otherSession.cookieHeader());
  await waitForActiveRunSlot(api);
  const runC = await startRun(
    api,
    { planVersionId: VERSION_ID, scenario: 'NORMAL', seed: 43 },
    'expiry',
  );
  createdRunIds.push(runC.runId);
  await openLive(tab, runC.runId);

  const beforeRevoke = await readLive(tab);
  const snapshotBeforeRevoke = await api.request(
    'GET',
    `/api/runs/${runC.runId}`,
  );
  assert(
    snapshotBeforeRevoke.status === 200,
    'run C snapshot before revocation',
  );
  const otherCursor = snapshotBeforeRevoke.data.lastEventSequence;
  const otherStream = await openStream(otherSession, runC.runId, otherCursor);
  assert(
    otherStream.status === 200,
    `second session stream status ${otherStream.status}`,
  );
  assert(
    (await otherSession.request('GET', '/api/auth/me')).status === 200,
    'second session was valid before revocation',
  );

  const browserCookie = await browserSessionCookie(tab);
  const revokeCursor = tab.events.length;
  const revokedRows = await revokeSessionByCookie(browserCookie);
  assert(revokedRows === 1, 'exactly one browser session was revoked');

  const revokedAt = Date.now();
  const runCEarly = await api.request('GET', `/api/runs/${runC.runId}`);
  assert(
    runCEarly.status === 200,
    'run C is readable immediately after revocation',
  );
  assert(
    runCEarly.data.recordedSampleCount >= (beforeRevoke.recorded ?? 0),
    'run C kept recording after the session was revoked',
  );
  let sawSignedOutLabel = false;
  const loginDeadline = Date.now() + 45000;
  while (Date.now() < loginDeadline) {
    const state = await readLive(tab).catch(() => null);
    if (state?.signedOutLabel) sawSignedOutLabel = true;
    if (await evaluate(tab, `location.pathname === '/login'`)) break;
    await delay(100);
  }
  const redirectMs = Date.now() - revokedAt;
  const eventsRequestsBetweenRevokeAndLogin = countRequests(
    tab,
    revokeCursor,
    (request) => /\/api\/runs\/[^/]+\/events/.test(request.url),
  );
  const landedOnLogin = await evaluate(tab, `location.pathname === '/login'`);
  assert(
    landedOnLogin,
    'the revoked session redirected the live page to /login',
  );

  const loginQuery = await evaluate(tab, `location.search`);
  const unauthenticated = {
    path: await evaluate(tab, `location.pathname`),
    query: loginQuery,
    hasEmail: await evaluate(tab, `!!document.querySelector('#email')`),
    hasLoginForm: await evaluate(tab, `!!document.querySelector('form')`),
    hasRoleChip: await evaluate(tab, `!!document.querySelector('.role-chip')`),
  };
  assert(
    unauthenticated.hasLoginForm,
    'the unauthenticated login form is rendered',
  );
  assert(!unauthenticated.hasRoleChip, 'the authenticated shell is gone');
  assert(
    decodeURIComponent(loginQuery).includes(`/runs/${runC.runId}/live`),
    'the login returnUrl points at the live run',
  );

  await delay(800);
  const expiryCursor = tab.events.length;
  const sourcesAtLogin = await readSources(tab);
  const meResponses = responsesMatching(
    tab,
    revokeCursor,
    /\/api\/auth\/me(?:\?|$)/,
  );
  const eventsRequestsAtExpiryLogin = countRequests(
    tab,
    expiryCursor,
    (request) => /\/api\/runs\/[^/]+\/events/.test(request.url),
  );
  await delay(6000);
  const eventsRequestsAfterExpirySettling = countRequests(
    tab,
    expiryCursor,
    (request) => /\/api\/runs\/[^/]+\/events/.test(request.url),
  );
  const sourcesAfterExpirySettling = await readSources(tab);

  assert(
    sourcesAtLogin.filter((source) => source.readyState === 1).length === 0,
    'the revoked live stream is closed',
  );
  assert(
    meResponses.some((response) => response.status === 401),
    '/auth/me returned 401 after revocation',
  );
  assert(
    eventsRequestsAfterExpirySettling === eventsRequestsAtExpiryLogin,
    'no reconnect was attempted after the expired-session redirect',
  );
  assert(
    sourcesAfterExpirySettling.length === sourcesAtLogin.length,
    'no new EventSource was created after the expired-session redirect',
  );

  const otherEvents = await otherStream.events;
  assert(otherEvents.length > 0, 'the second session still received events');
  assert(
    otherEvents.every(
      (event, index) =>
        index === 0 || event.id === otherEvents[index - 1].id + 1,
    ),
    'the second session received a gap-free stream',
  );
  assert(
    otherEvents[0].id === otherCursor + 1,
    'the second session resumed at its own cursor',
  );
  assert(
    otherEvents.at(-1).event === 'run.completed',
    'the second session reached run.completed',
  );
  const otherMe = await otherSession.request('GET', '/api/auth/me');
  assert(otherMe.status === 200, 'the second session is still authenticated');

  const runCAfterRevoke = await api.request('GET', `/api/runs/${runC.runId}`);
  assert(
    runCAfterRevoke.status === 200,
    'run C is readable by an unaffected session',
  );
  assert(
    runCAfterRevoke.data.status === 'RUNNING' ||
      runCAfterRevoke.data.status === 'COMPLETED',
    'run C was not cancelled by the session revocation',
  );
  const runCTerminal = await waitForTerminal(api, runC.runId);
  assert(
    runCTerminal.status === 'COMPLETED',
    `run C kept executing (got ${runCTerminal.status})`,
  );
  assert(runCTerminal.outcome === 'PASSED', 'run C passed');

  await screenshot(tab, 'docs/evidence/phase-4-lifecycle-expiry.png');
  evidence.expiry = {
    runId: runC.runId,
    before: beforeRevoke,
    revokedRows,
    redirectMs,
    sawSignedOutLabel,
    eventsRequestsBetweenRevokeAndLogin,
    unauthenticated,
    authMeStatusesAfterRevoke: meResponses.map((response) => response.status),
    statusImmediatelyAfterRevoke: runCEarly.data.status,
    recordedImmediatelyAfterRevoke: runCEarly.data.recordedSampleCount,
    openSourcesAtLogin: sourcesAtLogin.filter(
      (source) => source.readyState === 1,
    ).length,
    eventSourceCountAfterSettling: sourcesAfterExpirySettling.length,
    eventsRequestsAtExpiryLogin,
    eventsRequestsAfterExpirySettling,
    otherSessionCursor: otherCursor,
    otherSessionEventCount: otherEvents.length,
    otherSessionTerminal: otherEvents.at(-1).event,
    otherSessionAuthMeStatus: otherMe.status,
    serverStatusAfterRevoke: runCAfterRevoke.data.status,
    finalStatus: runCTerminal.status,
    finalOutcome: runCTerminal.outcome,
    finalRecordedSampleCount: runCTerminal.recordedSampleCount,
  };

  const exceptions = tab.events
    .filter((event) => event.method === 'Runtime.exceptionThrown')
    .map((event) => event.params.exceptionDetails.text);
  evidence.exceptions = exceptions;
  assert(exceptions.length === 0, 'no uncaught browser exceptions');
}

let finalized = false;
async function finalize() {
  if (finalized) return;
  finalized = true;
  if (!KEEP_RUNS) {
    const deleted = await cleanupRuns(createdRunIds);
    evidence.cleanupRuns = { requested: createdRunIds.length, deleted };
  } else {
    evidence.cleanupRuns = { requested: 0, deleted: 0, kept: createdRunIds };
  }
  let revoked = 0;
  for (const cookie of createdSessions)
    revoked += await revokeSessionToken(cookie);
  evidence.cleanupSessions = revoked;
  console.log(JSON.stringify({ checks: evidence }, null, 2));
}

main()
  .then(finalize)
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
    try {
      await finalize();
    } catch (cleanupError) {
      console.error(cleanupError);
    }
  })
  .finally(async () => {
    if (proxy) proxy.kill('SIGTERM');
    if (appServer) appServer.kill('SIGTERM');
    chrome.kill('SIGTERM');
    await delay(300);
    rmSync(userDataDir, { recursive: true, force: true });
  });
