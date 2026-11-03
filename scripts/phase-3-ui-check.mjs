// Phase 3 UI evidence: run details, start form and cancel via real Chrome.
//
// Prerequisites:
//   1. API running (e.g. PORT=3100 node apps/api/dist/main.js)
//   2. Angular dev server on :4200 with a proxy to that API, e.g.
//      cd apps/web && npx ng serve --port 4200 --proxy-config <proxy-to-api>.json
//   3. Two completed runs (one FORCED_FAILURE, one NORMAL) created by
//      scripts/phase-3-demo.mjs, plus a published version id.
//
// Usage:
//   VERSION_ID=<published-version-uuid> \
//   FORCED_RUN=<failed-run-uuid> NORMAL_RUN=<passed-run-uuid> \
//   node scripts/phase-3-ui-check.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9336;
const APP = process.env.APP_URL ?? 'http://127.0.0.1:4200';
const VERSION_ID = process.env.VERSION_ID;
const FORCED_RUN = process.env.FORCED_RUN;
const NORMAL_RUN = process.env.NORMAL_RUN;

for (const [name, value] of Object.entries({ VERSION_ID, FORCED_RUN, NORMAL_RUN })) {
  if (!value) throw new Error(`${name} is required (see the usage comment)`);
}

const userDataDir = mkdtempSync(join(tmpdir(), 'probedesk-chrome-'));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${userDataDir}`,
  '--headless=new',
  '--window-size=1280,1200',
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

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  return new Cdp(ws);
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      `Evaluation failed: ${result.exceptionDetails.text} ${result.exceptionDetails.exception?.description ?? ''}`,
    );
  }
  return result.result.value;
}

async function waitFor(cdp, expression, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function navigate(cdp, path) {
  await cdp.send('Page.navigate', { url: `${APP}${path}` });
}

async function screenshot(cdp, path) {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path, Buffer.from(shot.data, 'base64'));
}

async function main() {
  await waitForChrome();
  const target = await (
    await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(`${APP}/login`)}`, {
      method: 'PUT',
    })
  ).json();
  const cdp = await connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

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

  // Completed FAILED run details.
  await navigate(cdp, `/runs/${FORCED_RUN}`);
  await waitFor(cdp, `document.body.innerText.includes('Role: Operator')`);
  await waitFor(cdp, `document.body.innerText.includes('Recorded steps')`);
  const forced = await evaluate(cdp, `(() => ({
    text: document.body.innerText,
    failureValueShown: document.body.innerText.includes('0.600000'),
    cancelVisible: !!document.querySelector('#cancel-run-button'),
    runAgainVisible: !!document.querySelector('#run-again-button'),
    statusText: document.querySelector('.status-label')?.textContent.trim() ?? null,
    stepRows: document.querySelectorAll('table tbody tr').length,
  }))()`);
  await screenshot(cdp, 'docs/evidence/phase-3-failed-run.png');

  await navigate(cdp, `/runs/${NORMAL_RUN}`);
  await waitFor(cdp, `document.body.innerText.includes('Recorded steps')`);
  const normal = await evaluate(cdp, `(() => ({
    statusText: document.querySelector('.status-label')?.textContent.trim() ?? null,
    runAgainVisible: !!document.querySelector('#run-again-button'),
  }))()`);

  // Start a NORMAL run through the real form, then cancel it from the details page.
  await navigate(cdp, `/runs/new?versionId=${VERSION_ID}`);
  await waitFor(cdp, `!!document.querySelector('#start-run-scenario')`);
  await waitFor(cdp, `document.body.innerText.includes('Role: Operator')`);
  const form = await evaluate(cdp, `(() => ({
    stepRows: document.querySelectorAll('table tbody tr').length,
    scenarioOptions: Array.from(document.querySelectorAll('#start-run-scenario option')).map((option) => option.value),
  }))()`);
  await evaluate(cdp, `(() => {
    const scenario = document.querySelector('#start-run-scenario');
    const seed = document.querySelector('#start-run-seed');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    scenario.value = 'NORMAL';
    scenario.dispatchEvent(new Event('change', { bubbles: true }));
    set.call(seed, '321');
    seed.dispatchEvent(new Event('input', { bubbles: true }));
    seed.dispatchEvent(new Event('blur', { bubbles: true }));
  })()`);
  await waitFor(cdp, `document.querySelector('#start-run-submit') && !document.querySelector('#start-run-submit').disabled`);
  await evaluate(cdp, `document.querySelector('form').requestSubmit()`);
  // The application itself must navigate from the form to the run details screen.
  await waitFor(cdp, `/^\\/runs\\/[0-9a-f-]{36}$/.test(location.pathname)`, 25000);
  const startedRunId = await evaluate(cdp, `location.pathname.split('/')[2]`);
  await waitFor(cdp, `document.body.innerText.includes('Run Details')`);

  await waitFor(cdp, `!!document.querySelector('#cancel-run-button')`);
  await evaluate(cdp, `document.querySelector('#cancel-run-button').click()`);
  await waitFor(cdp, `!!document.querySelector('#cancel-run-confirm')`);
  const dialogTitle = await evaluate(cdp, `document.querySelector('#cancel-run-title')?.textContent.trim() ?? null`);
  await evaluate(cdp, `document.querySelector('#cancel-run-confirm').click()`);
  await waitFor(cdp, `document.body.innerText.includes('Cancelled')`, 20000);
  const cancelled = await evaluate(cdp, `(() => ({
    statusText: document.querySelector('.status-label')?.textContent.trim() ?? null,
    bodyIncludesCancelled: document.body.innerText.includes('Cancelled'),
    cancelVisible: !!document.querySelector('#cancel-run-button'),
    runAgainVisible: !!document.querySelector('#run-again-button'),
  }))()`);
  await screenshot(cdp, 'docs/evidence/phase-3-cancelled-run.png');

  // The P4 live placeholder must still offer a working link back to details.
  await navigate(cdp, `/runs/${startedRunId}/live`);
  await waitFor(cdp, `document.body.innerText.includes('View run details')`);
  const liveDetailsHref = await evaluate(cdp, `document.querySelector('a[href*="/runs/"]')?.getAttribute('href') ?? null`);

  const exceptions = cdp.events
    .filter((event) => event.method === 'Runtime.exceptionThrown')
    .map((event) => event.params.exceptionDetails.text);

  console.log(
    JSON.stringify(
      {
        forced: {
          statusText: forced.statusText,
          failureValueShown: forced.failureValueShown,
          cancelVisible: forced.cancelVisible,
          runAgainVisible: forced.runAgainVisible,
          stepRows: forced.stepRows,
        },
        normal,
        startForm: form,
        startedRunId,
        liveDetailsHref,
        cancelDialogTitle: dialogTitle,
        cancelled,
        exceptions,
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
    chrome.kill('SIGTERM');
    await delay(300);
    rmSync(userDataDir, { recursive: true, force: true });
  });
