// Phase 5 browser check for the Live Run measurement chart (P5-06).
//
// It drives a real Chrome through a FORCED_FAILURE run against the real API,
// then verifies on the real Chart.js canvas:
//   - hover tooltip text (via the opt-in typed debug hook),
//   - clicking the failing point selects/focuses the matching table row,
//   - wheel zoom, drag pan and Reset view only change the viewport,
//   - final chart/table counts equal the API snapshot,
//   - no chart update after the terminal state,
//   - route leave destroys the live charts and returning re-snapshots them.
//
// Usage:
//   RUN_VERSION_ID=<published revision uuid> node scripts/phase-5-chart-check.mjs
//
// Optional env:
//   PROBEDESK_API_URL  default http://127.0.0.1:3100
//   APP_PORT           default 4300
//   WEB_DIST           built app directory (default apps/web/dist/web)
//   BUILD_WEB=1        force a fresh web build
//
// The API and PostgreSQL must already be running. The script starts the
// built-app server itself and does not use a synthetic Chart.js event.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const API_URL = process.env.PROBEDESK_API_URL ?? 'http://127.0.0.1:3100';
const VERSION_ID = process.env.RUN_VERSION_ID;
const APP_PORT = Number(process.env.APP_PORT ?? 4300);
const APP = process.env.APP_URL ?? `http://127.0.0.1:${APP_PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9338;

if (!VERSION_ID) {
  throw new Error('RUN_VERSION_ID is required (a published plan revision UUID).');
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    const headers = { Origin: API_URL, Accept: 'application/json', ...extra };
    if (cookies.size) {
      headers.Cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const csrf = cookies.get('XSRF-TOKEN');
    if (csrf) headers['X-XSRF-TOKEN'] = csrf;

    const response = await fetch(`${API_URL}${path}`, {
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

let appServer = null;

function ensureWebBuild() {
  const configuredDist = process.env.WEB_DIST;
  const candidates = configuredDist
    ? [join(configuredDist, 'browser', 'index.html'), join(configuredDist, 'index.html')]
    : ['apps/web/dist/web/browser/index.html', 'apps/web/dist/web/index.html'];

  if (process.env.BUILD_WEB !== '1' && candidates.some((path) => existsSync(path))) {
    return;
  }

  console.log('Building apps/web because no built bundle was found...');
  const result = spawnSync('npm', ['run', 'build', '--workspace', 'apps/web'], {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error('The web build failed; the chart check cannot continue.');
  }
}

function startAppServer() {
  appServer = spawn(process.execPath, ['scripts/app-server.mjs'], {
    env: {
      ...process.env,
      APP_PORT: String(APP_PORT),
      PROXY_URL: API_URL,
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

async function waitForAppServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
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

const userDataDir = mkdtempSync(join(tmpdir(), 'probedesk-chart-chrome-'));
const chrome = spawn(
  CHROME,
  [
    `--remote-debugging-port=${PORT}`,
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
  for (let attempt = 0; attempt < 100; attempt += 1) {
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
  // Opt in to the typed chart debug registry before the app boots.
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__probedeskChartDebug = true;`,
  });
  // Instrumentation only: record EventSource lifetimes so the check can prove
  // the terminal stream closed. No synthetic event is dispatched.
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
    const detail =
      result.exceptionDetails.exception?.description ??
      result.exceptionDetails.text;
    throw new Error(`Evaluation failed: ${detail}`);
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

async function scrollChartIntoView(cdp, runStepId) {
  await evaluate(
    cdp,
    `(() => {
      const entry = (window.__probedeskCharts ?? []).find((item) => item.runStepId === '${runStepId}');
      entry?.canvas.scrollIntoView({ block: 'center', inline: 'nearest' });
      return !!entry;
    })()`,
  );
  await delay(200);
}

async function chartPoint(cdp, runStepId, sampleIndex) {
  return evaluate(
    cdp,
    `(() => {
      const entry = (window.__probedeskCharts ?? []).find((item) => item.runStepId === '${runStepId}');
      if (!entry) return null;
      const point = entry.debug.pointPixel(${sampleIndex});
      if (!point) return null;
      const rect = entry.canvas.getBoundingClientRect();
      return {
        x: rect.left + point.x,
        y: rect.top + point.y,
        canvas: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      };
    })()`,
  );
}

async function mouseMove(cdp, x, y) {
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x,
    y,
    button: 'none',
    buttons: 0,
  });
}

async function mouseClick(cdp, x, y) {
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
}

async function clickElement(cdp, selector) {
  const rect = await evaluate(
    cdp,
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return null;
      element.scrollIntoView({ block: 'center', inline: 'nearest' });
      const box = element.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    })()`,
  );
  if (!rect) throw new Error(`Element not found: ${selector}`);
  await delay(150);
  await mouseClick(cdp, rect.x, rect.y);
}

async function chartState(cdp, runStepId) {
  return evaluate(
    cdp,
    `(() => {
      const entry = (window.__probedeskCharts ?? []).find((item) => item.runStepId === '${runStepId}');
      if (!entry) return null;
      return { ...entry.debug.snapshot(), canvasConnected: entry.canvas.isConnected };
    })()`,
  );
}

/** Honours the single-active-run rule with the same key on every retry. */
async function startRunWithRetry(api, body) {
  const key = `phase5-chart-${crypto.randomUUID()}`;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const started = await api.start(body, key);
    if (started.status === 202) return started.data;
    if (started.status !== 409) {
      throw new Error(`Run start failed (${started.status}): ${JSON.stringify(started.data)}`);
    }
    await delay(250);
  }
  throw new Error('No active-run slot became available within 120 seconds.');
}

async function main() {
  ensureWebBuild();
  console.log(`APP_URL=${APP} API_URL=${API_URL}`);

  const api = createJar();
  const login = await api.login('operator@probedesk.local', 'OperatorDemo!2026');
  if (login.status !== 200) throw new Error(`API login failed (${login.status})`);

  const version = await api.request('GET', `/api/plan-versions/${VERSION_ID}`);
  if (version.status !== 200) {
    throw new Error(`Plan version could not be read (${version.status}).`);
  }
  const failureStep = version.data.steps.at(-1);
  if (!failureStep) throw new Error('The plan version has no steps.');
  const expectedSampleCount = version.data.steps.reduce(
    (total, step) => total + step.sampleCount,
    0,
  );

  const started = await startRunWithRetry(api, {
    planVersionId: VERSION_ID,
    scenario: 'FORCED_FAILURE',
    seed: 15,
    failureStepId: failureStep.logicalStepId,
  });
  const runId = started.runId;

  await waitForChrome();
  startAppServer();
  await waitForAppServer();

  const tab = await openTab(`${APP}/login`);
  await loginInBrowser(tab);
  await tab.send('Page.navigate', { url: `${APP}/runs/${runId}/live` });
  await waitFor(tab, `!!document.querySelector('#live-charts-section')`);
  await waitFor(
    tab,
    `(window.__probedeskCharts ?? []).length === ${version.data.steps.length}`,
  );
  await waitFor(tab, `document.body.innerText.includes('Connection: Connected')`);

  const chartsWhileRunning = await evaluate(
    tab,
    `(window.__probedeskCharts ?? []).map((entry) => ({
      runStepId: entry.runStepId,
      sampleCount: entry.debug.snapshot().sampleCount,
    }))`,
  );

  await waitFor(
    tab,
    `document.querySelector('#live-charts-section')?.getAttribute('data-recorded-sample-count') === '${expectedSampleCount}' &&
     document.querySelector('#live-charts-section')?.getAttribute('data-chart-sample-count') === '${expectedSampleCount}' &&
     document.body.innerText.includes('Run finished')`,
    90000,
  );

  const finalApi = await api.request('GET', `/api/runs/${runId}`);
  if (finalApi.status !== 200) throw new Error('The final API snapshot could not be read.');
  const snapshot = finalApi.data;
  if (snapshot.recordedSampleCount !== expectedSampleCount) {
    throw new Error(
      `API recorded ${snapshot.recordedSampleCount} samples, expected ${expectedSampleCount}.`,
    );
  }

  const finalCharts = await evaluate(
    tab,
    `(window.__probedeskCharts ?? []).map((entry) => ({
      runStepId: entry.runStepId,
      logicalStepId: entry.logicalStepId,
      sampleCount: entry.debug.snapshot().sampleCount,
    }))`,
  );
  for (const step of snapshot.steps) {
    const chart = finalCharts.find((entry) => entry.runStepId === step.runStepId);
    if (!chart) throw new Error(`No chart registered for step ${step.runStepId}.`);
    if (chart.sampleCount !== step.measurements.length) {
      throw new Error(
        `Chart ${step.name} has ${chart.sampleCount} points, API has ${step.measurements.length}.`,
      );
    }
  }

  const tableCount = await evaluate(
    tab,
    `(() => {
      const section = document.querySelector('#live-charts-section');
      const rows = section ? section.querySelectorAll('tbody tr').length : -1;
      const perStep = [...document.querySelectorAll('#live-charts-section [data-run-step-id]')]
        .filter((element) => element.tagName === 'ARTICLE')
        .map((article) => ({
          runStepId: article.getAttribute('data-run-step-id'),
          rows: article.querySelectorAll('tbody tr').length,
        }));
      return { rows, perStep };
    })()`,
  );
  if (tableCount.rows !== snapshot.recordedSampleCount) {
    throw new Error(
      `Full table has ${tableCount.rows} rows, API recorded ${snapshot.recordedSampleCount}.`,
    );
  }

  const failingStep = snapshot.steps.find(
    (step) => step.firstFailureSampleIndex !== null,
  );
  const failingSampleIndex = failingStep?.firstFailureSampleIndex;
  if (!failingStep || failingSampleIndex === null || failingSampleIndex === undefined) {
    throw new Error('The forced-failure run did not record a failing sample.');
  }

  await scrollChartIntoView(tab, failingStep.runStepId);
  const point = await chartPoint(tab, failingStep.runStepId, failingSampleIndex);
  if (!point) throw new Error('The failing chart point could not be located.');

  await mouseMove(tab, point.x - 20, point.y - 20);
  await mouseMove(tab, point.x, point.y);
  await waitFor(
    tab,
    `(() => {
      const entry = (window.__probedeskCharts ?? []).find((item) => item.runStepId === '${failingStep.runStepId}');
      return (entry?.debug.snapshot().tooltip?.opacity ?? 0) > 0;
    })()`,
    10000,
  );
  const tooltip = await chartState(tab, failingStep.runStepId);
  const tooltipText = [...(tooltip.tooltip?.title ?? []), ...(tooltip.tooltip?.body ?? [])].join('\n');
  for (const expected of [
    `Sample ${failingSampleIndex}`,
    'Outside tolerance',
    `${failingStep.measurements.find((sample) => sample.sampleIndex === failingSampleIndex)?.value ?? ''}`,
    failingStep.unit,
    'Elapsed:',
    'Recorded (UTC):',
  ]) {
    if (!tooltipText.includes(expected)) {
      throw new Error(`Tooltip is missing "${expected}". Text: ${tooltipText}`);
    }
  }
  if (tooltip.tooltip?.sampleIndex !== failingSampleIndex) {
    throw new Error(
      `Tooltip points at sample ${tooltip.tooltip?.sampleIndex}, expected ${failingSampleIndex}.`,
    );
  }

  const tooltipShot = await tab.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(
    'docs/evidence/phase-5-live-chart.png',
    Buffer.from(tooltipShot.data, 'base64'),
  );

  await mouseClick(tab, point.x, point.y);
  await waitFor(
    tab,
    `document.activeElement?.id === 'measurement-row-${failingStep.runStepId}-${failingSampleIndex}'`,
    10000,
  );
  const selection = await evaluate(
    tab,
    `(() => {
      const row = document.getElementById('measurement-row-${failingStep.runStepId}-${failingSampleIndex}');
      return {
        activeElementId: document.activeElement?.id ?? null,
        rowId: row?.id ?? null,
        selected: row?.classList.contains('is-selected') ?? false,
        ariaCurrent: row?.getAttribute('aria-current') ?? null,
        chartSelected: (() => {
          const entry = (window.__probedeskCharts ?? []).find((item) => item.runStepId === '${failingStep.runStepId}');
          const chart = entry?.debug.pointPixel(${failingSampleIndex});
          return chart !== null && chart !== undefined;
        })(),
      };
    })()`,
  );
  if (
    !selection.selected ||
    selection.ariaCurrent !== 'true' ||
    selection.rowId !== `measurement-row-${failingStep.runStepId}-${failingSampleIndex}`
  ) {
    throw new Error(`The chart click did not select the matching row: ${JSON.stringify(selection)}`);
  }

  const selectionShot = await tab.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(
    'docs/evidence/phase-5-live-chart-selection.png',
    Buffer.from(selectionShot.data, 'base64'),
  );

  // Selecting the row focuses it, which scrolls the page. Re-scroll and read
  // the canvas rectangle again so the wheel/drag land on the real chart.
  await scrollChartIntoView(tab, failingStep.runStepId);
  const zoomPoint = await chartPoint(tab, failingStep.runStepId, failingSampleIndex);
  if (!zoomPoint) throw new Error('The chart point could not be located for zoom.');
  const beforeZoom = await chartState(tab, failingStep.runStepId);
  const canvas = zoomPoint.canvas;
  const centerX = canvas.left + canvas.width / 2;
  const centerY = canvas.top + canvas.height / 2;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await cdpWheel(tab, centerX, centerY, -800);
    await delay(300);
    const current = await chartState(tab, failingStep.runStepId);
    if (current.zoomed) break;
  }
  const afterZoom = await chartState(tab, failingStep.runStepId);
  if (!afterZoom.zoomed) {
    throw new Error('Wheel zoom did not change the Chart.js view.');
  }
  if (afterZoom.sampleCount !== beforeZoom.sampleCount) {
    throw new Error('Zoom changed the number of recorded chart points.');
  }
  if (
    afterZoom.xMin === beforeZoom.xMin &&
    afterZoom.xMax === beforeZoom.xMax
  ) {
    throw new Error('Zoom did not narrow the X viewport.');
  }

  await mouseDrag(tab, centerX, centerY, centerX + 90, centerY);
  await delay(400);
  const afterPan = await chartState(tab, failingStep.runStepId);
  const panMoved = afterPan.xMin !== afterZoom.xMin || afterPan.xMax !== afterZoom.xMax;
  if (afterPan.sampleCount !== beforeZoom.sampleCount) {
    throw new Error('Pan changed the number of recorded chart points.');
  }

  await clickElement(
    tab,
    `article[data-run-step-id="${failingStep.runStepId}"] .reset-view`,
  );
  await waitFor(
    tab,
    `(() => {
      const entry = (window.__probedeskCharts ?? []).find((item) => item.runStepId === '${failingStep.runStepId}');
      return entry !== undefined && entry.debug.snapshot().zoomed === false;
    })()`,
    10000,
  );
  const afterReset = await chartState(tab, failingStep.runStepId);
  if (afterReset.sampleCount !== beforeZoom.sampleCount) {
    throw new Error('Reset view changed the number of recorded chart points.');
  }
  if (
    afterReset.xMin !== beforeZoom.xMin ||
    afterReset.xMax !== beforeZoom.xMax
  ) {
    throw new Error('Reset view did not restore the full X viewport.');
  }

  const terminalCounts = finalCharts.map((chart) => chart.sampleCount);
  await delay(1200);
  const countsAfterTerminalWait = await evaluate(
    tab,
    `(window.__probedeskCharts ?? []).map((entry) => entry.debug.snapshot().sampleCount)`,
  );
  if (JSON.stringify(countsAfterTerminalWait) !== JSON.stringify(terminalCounts)) {
    throw new Error('A chart changed after the run was terminal.');
  }
  const sources = await evaluate(
    tab,
    `(window.__probedeskEventSources ?? []).map((source) => ({ url: source.url, readyState: source.readyState }))`,
  );
  if (sources.some((source) => source.readyState !== 2)) {
    throw new Error(`A terminal stream is still open: ${JSON.stringify(sources)}`);
  }

  // Route leave and return through the actual Angular router (SPA history),
  // not a full page reload.
  const oldCanvases = await evaluate(
    tab,
    `(() => {
      window.__oldChartCanvases = (window.__probedeskCharts ?? []).map((entry) => entry.canvas);
      return window.__oldChartCanvases.length;
    })()`,
  );
  await clickElement(tab, '#live-run-details-link');
  await waitFor(tab, `location.pathname === '/runs/${runId}'`, 15000);
  await waitFor(tab, `(window.__probedeskCharts ?? []).length > 0`, 15000);
  const afterLeave = await evaluate(
    tab,
    `({
      liveSection: !!document.querySelector('#live-charts-section'),
      oldCanvasesDisconnected: (window.__oldChartCanvases ?? []).every((canvas) => !canvas.isConnected),
      registered: (window.__probedeskCharts ?? []).length,
    })`,
  );
  if (afterLeave.liveSection || !afterLeave.oldCanvasesDisconnected) {
    throw new Error(`Leaving the live route did not tear its charts down: ${JSON.stringify(afterLeave)}`);
  }

  await evaluate(tab, `history.back()`);
  await waitFor(tab, `location.pathname === '/runs/${runId}/live'`, 15000);
  await waitFor(tab, `!!document.querySelector('#live-charts-section')`, 15000);
  await waitFor(
    tab,
    `document.querySelector('#live-charts-section')?.getAttribute('data-recorded-sample-count') === '${expectedSampleCount}'`,
    15000,
  );
  const afterReturn = await evaluate(
    tab,
    `(() => ({
      charts: (window.__probedeskCharts ?? []).map((entry) => ({
        runStepId: entry.runStepId,
        sampleCount: entry.debug.snapshot().sampleCount,
        canvasConnected: entry.canvas.isConnected,
      })),
      path: location.pathname,
      status: document.querySelector('.status-label')?.textContent.trim() ?? null,
    }))()`,
  );
  for (const step of snapshot.steps) {
    const chart = afterReturn.charts.find((entry) => entry.runStepId === step.runStepId);
    if (!chart || chart.sampleCount !== step.measurements.length || !chart.canvasConnected) {
      throw new Error(
        `The live chart was not rebuilt from the returned snapshot for ${step.name}: ${JSON.stringify(chart)}`,
      );
    }
  }
  if (afterLeave.registered > oldCanvases) {
    throw new Error('Chart debug registry kept an entry from the previous route.');
  }

  const exceptions = tab.events
    .filter((event) => event.method === 'Runtime.exceptionThrown')
    .map((event) => event.params.exceptionDetails.text);

  console.log(
    JSON.stringify(
      {
        runId,
        scenario: 'FORCED_FAILURE',
        expectedSampleCount,
        chartsWhileRunning,
        finalStatus: snapshot.status,
        finalOutcome: snapshot.outcome,
        apiRecordedSampleCount: snapshot.recordedSampleCount,
        finalCharts,
        tableCount,
        tooltipText,
        tooltipSampleIndex: tooltip.tooltip?.sampleIndex ?? null,
        selection,
        zoom: {
          before: { xMin: beforeZoom.xMin, xMax: beforeZoom.xMax },
          after: { xMin: afterZoom.xMin, xMax: afterZoom.xMax, visible: afterZoom.visibleSampleCount },
          sampleCountUnchanged: afterZoom.sampleCount === beforeZoom.sampleCount,
        },
        pan: {
          moved: panMoved,
          after: { xMin: afterPan.xMin, xMax: afterPan.xMax },
          sampleCountUnchanged: afterPan.sampleCount === beforeZoom.sampleCount,
        },
        reset: {
          zoomed: afterReset.zoomed,
          xMin: afterReset.xMin,
          xMax: afterReset.xMax,
          sampleCountUnchanged: afterReset.sampleCount === beforeZoom.sampleCount,
        },
        terminalCounts,
        countsAfterTerminalWait,
        sources,
        routeLeave: afterLeave,
        routeReturn: { path: afterReturn.path, status: afterReturn.status },
        oldCanvases,
        exceptions,
      },
      null,
      2,
    ),
  );
}

async function cdpWheel(cdp, x, y, deltaY) {
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x,
    y,
    deltaX: 0,
    deltaY,
  });
}

async function mouseDrag(cdp, fromX, fromY, toX, toY) {
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: fromX,
    y: fromY,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  const steps = 8;
  for (let index = 1; index <= steps; index += 1) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: fromX + ((toX - fromX) * index) / steps,
      y: fromY + ((toY - fromY) * index) / steps,
      button: 'left',
      buttons: 1,
    });
    await delay(30);
  }
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: toX,
    y: toY,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (appServer) appServer.kill('SIGTERM');
    chrome.kill('SIGTERM');
    await delay(300);
    rmSync(userDataDir, { recursive: true, force: true });
  });
