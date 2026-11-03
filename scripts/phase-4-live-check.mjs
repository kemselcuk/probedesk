// Phase 4 browser check: live progress, two tabs, offline/online reconnect.
// Usage: RUN_VERSION_ID=<uuid> node scripts/phase-4-live-check.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE_URL = process.env.PROBEDESK_API_URL ?? 'http://127.0.0.1:3100';
const APP = process.env.APP_URL ?? 'http://127.0.0.1:4200';
const VERSION_ID = process.env.RUN_VERSION_ID;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9337;

if (!VERSION_ID) throw new Error('RUN_VERSION_ID is required');

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
    if (cookies.size) headers.Cookie = [...cookies].map(([n, v]) => `${n}=${v}`).join('; ');
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
    return { status: response.status, data: text ? JSON.parse(text) : null };
  }
  return {
    request,
    login: (email, password) => request('POST', '/api/auth/login', { email, password }),
    start: (body, key) => request('POST', '/api/runs', body, { 'Idempotency-Key': key }),
  };
}

let proxy = null;
function startProxy() {
  proxy = spawn(process.execPath, ['scripts/sse-proxy.mjs'], {
    env: { ...process.env, PROXY_PORT: '3200', API_URL: BASE_URL },
    stdio: 'ignore',
  });
}
async function waitForProxy() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const response = await fetch('http://127.0.0.1:3200/api/health/live');
      if (response.ok) return;
    } catch {
      // not ready
    }
    await delay(100);
  }
  throw new Error('SSE proxy did not start');
}

const userDataDir = mkdtempSync(join(tmpdir(), 'probedesk-chrome-'));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${userDataDir}`,
  '--headless=new',
  '--window-size=1280,1100',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  'about:blank',
], { stdio: 'ignore' });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForChrome() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
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
    await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })
  ).json();
  const cdp = await connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  // Keep references to EventSource instances so the test can force the
  // client to observe an outage while the streaming proxy is down.
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const Native = window.EventSource;
      window.__probedeskEventSources = [];
      window.EventSource = class extends Native {
        constructor(...args) {
          super(...args);
          window.__probedeskEventSources.push(this);
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
    await delay(150);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function loginInBrowser(cdp) {
  await cdp.send('Page.navigate', { url: `${APP}/login` });
  await waitFor(cdp, `!!document.querySelector('#email')`);
  await evaluate(cdp, `(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const email = document.querySelector('#email');
    const password = document.querySelector('#password');
    set.call(email, 'operator@probedesk.local');
    email.dispatchEvent(new Event('input', { bubbles: true }));
    set.call(password, 'OperatorDemo!2026');
    password.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('form').requestSubmit();
  })()`);
  await waitFor(cdp, `location.pathname === '/plans'`);
  await waitFor(cdp, `document.body.innerText.includes('Role: Operator')`);
}

const recorded = `(() => {
  const text = document.body.innerText;
  const match = text.match(/(\\d+) of (\\d+) samples recorded/);
  return match ? Number(match[1]) : null;
})()`;

const connectionLabel = `(() => {
  const label = document.querySelector('.connection-panel .connection-label, .connection-panel span');
  const text = document.querySelector('.connection-panel')?.textContent ?? '';
  const match = text.match(/Connection:\\s*([A-Za-z]+)/);
  return match ? match[1] : label?.textContent?.trim() ?? null;
})()`;

async function main() {
  const api = createJar();
  const login = await api.login('operator@probedesk.local', 'OperatorDemo!2026');
  if (login.status !== 200) throw new Error('api login failed');
  const started = await api.start(
    { planVersionId: VERSION_ID, scenario: 'NORMAL', seed: 15 },
    `phase4-live-${crypto.randomUUID()}`,
  );
  if (started.status !== 202) throw new Error(`start failed ${started.status}`);
  const runId = started.data.runId;

  await waitForChrome();
  startProxy();
  await waitForProxy();
  const tabA = await openTab(`${APP}/runs/${runId}/live`);
  await loginInBrowser(tabA);
  await tabA.send('Page.navigate', { url: `${APP}/runs/${runId}/live` });
  await waitFor(tabA, `document.body.innerText.includes('Live steps')`);
  await waitFor(tabA, `document.body.innerText.includes('Connection: Connected')`);

  const tabB = await openTab(`${APP}/runs/${runId}/live`);
  await waitFor(tabB, `document.body.innerText.includes('Connection: Connected')`);

  await waitFor(tabA, `(${recorded}) > 2`, 20000);
  const firstProgress = await evaluate(tabA, recorded);

  // Drop the streaming proxy; the run keeps executing on the API server.
  proxy.kill('SIGKILL');
  await delay(500);
  // Vite can keep the downstream socket open after the proxy dies; nudge each
  // tab's client to surface the error event so both independent reconnect
  // paths run. Without this, a background tab can look "Connected" forever
  // even though its upstream socket is gone.
  const surfaceStreamError = `(window.__probedeskEventSources ?? []).forEach((source) => source.dispatchEvent(new Event('error')))`;
  await evaluate(tabA, surfaceStreamError);
  await evaluate(tabB, surfaceStreamError);
  for (const tab of [tabA, tabB]) {
    await waitFor(
      tab,
      `document.body.innerText.includes('Connection: Reconnecting') || document.body.innerText.includes('Connection: Disconnected')`,
      20000,
    );
  }
  const offlineLabel = await evaluate(tabA, connectionLabel);
  await delay(1500);
  startProxy();
  await waitForProxy();

  await waitFor(tabA, `document.body.innerText.includes('Connection: Connected')`, 30000);
  await waitFor(tabB, `document.body.innerText.includes('Connection: Connected')`, 30000);
  await delay(4000);
  const readState = (cdp) => evaluate(cdp, `({
    path: location.pathname,
    status: document.querySelector('.status-label')?.textContent.trim() ?? null,
    connection: (document.body.innerText.match(/Connection:\s*([A-Za-z]+)/) ?? [])[1] ?? null,
    recorded: (document.body.innerText.match(/(\d+) of (\d+) samples recorded/) ?? [])[1] ?? null,
    warning: document.querySelector('#live-stream-warning')?.textContent?.trim() ?? null,
    terminal: document.body.innerText.includes('Run finished'),
  })`);
  const probe = await evaluate(tabA, `(async () => {
    const snapshot = await fetch('/api/runs/${runId}').then((response) => response.json());
    const after = Math.max(0, snapshot.lastEventSequence - 3);
    let probeCount = 0;
    const probe = new EventSource('/api/runs/${runId}/events?after=' + after);
    probe.addEventListener('measurement.recorded', () => { probeCount += 1; });
    await new Promise((resolve) => setTimeout(resolve, 2500));
    probe.close();
    return {
      serverStatus: snapshot.status,
      serverRecorded: snapshot.recordedSampleCount,
      serverSequence: snapshot.lastEventSequence,
      probeCount,
      sources: (window.__probedeskEventSources ?? []).map((source) => ({
        url: source.url,
        readyState: source.readyState,
      })),
    };
  })()`);
  const debugTabs = { a: await readState(tabA), b: await readState(tabB), probe };
  console.log('DEBUG_TABS', JSON.stringify(debugTabs, null, 2));
  await waitFor(tabA, `document.body.innerText.includes('Recorded samples') && document.body.innerText.includes('90 of 90')`, 60000);
  await waitFor(tabB, `document.body.innerText.includes('90 of 90')`, 60000);
  await waitFor(tabA, `document.querySelector('.status-label')?.textContent.trim() !== 'Running'`, 60000);
  await waitFor(tabB, `document.querySelector('.status-label')?.textContent.trim() !== 'Running'`, 60000);

  const finalA = await evaluate(tabA, `({
    path: location.pathname,
    status: document.querySelector('.status-label')?.textContent.trim() ?? null,
    connection: (document.body.innerText.match(/Connection:\\s*([A-Za-z]+)/) ?? [])[1] ?? null,
    recorded: (document.body.innerText.match(/(\\d+) of (\\d+) samples recorded/) ?? [])[1] ?? null,
    terminal: document.body.innerText.includes('Run finished'),
    hasDetailsLink: !!document.querySelector('#live-run-details-link'),
  })`);
  const finalB = await evaluate(tabB, `({
    status: document.querySelector('.status-label')?.textContent.trim() ?? null,
    recorded: (document.body.innerText.match(/(\\d+) of (\\d+) samples recorded/) ?? [])[1] ?? null,
  })`);

  const shot = await tabA.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('docs/evidence/phase-4-live.png', Buffer.from(shot.data, 'base64'));

  const exceptions = [...tabA.events, ...tabB.events]
    .filter((event) => event.method === 'Runtime.exceptionThrown')
    .map((event) => event.params.exceptionDetails.text);
  const failedResponses = [];
  for (const [tabName, tab] of [
    ['a', tabA],
    ['b', tabB],
  ]) {
    for (const event of tab.events) {
      if (
        event.method !== 'Network.responseReceived' ||
        event.params.response.status < 400
      ) {
        continue;
      }

      let body = null;
      try {
        body = (
          await tab.send('Network.getResponseBody', {
            requestId: event.params.requestId,
          })
        ).body;
      } catch {
        // The body may already be gone for a failed stream request.
      }
      const requestEvent = tab.events.find(
        (candidate) =>
          candidate.method === 'Network.requestWillBeSent' &&
          candidate.params.requestId === event.params.requestId,
      );
      failedResponses.push({
        tab: tabName,
        method: requestEvent?.params.request.method ?? null,
        url: event.params.response.url,
        status: event.params.response.status,
        timestamp: event.params.timestamp,
        body,
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        runId,
        firstProgress,
        offlineLabel,
        finalA,
        finalB,
        exceptions,
        failedResponseCount: failedResponses.length,
        failedResponses: failedResponses.slice(-5),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (proxy) proxy.kill('SIGTERM');
    chrome.kill('SIGTERM');
    await delay(300);
    rmSync(userDataDir, { recursive: true, force: true });
  });
