// Phase 6 compare UI check: deep link, rule differences, dual charts, history selection.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APP = process.env.APP_URL ?? 'http://127.0.0.1:4200';
const LEFT = process.env.LEFT_RUN;
const RIGHT = process.env.RIGHT_RUN;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9339;

if (!LEFT || !RIGHT) throw new Error('LEFT_RUN and RIGHT_RUN are required');

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

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(cdp, expression, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, expression)) return;
    await delay(120);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
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
  await waitFor(cdp, `document.body.innerText.includes('Role: Operator')`);

  await cdp.send('Page.navigate', {
    url: `${APP}/compare?leftRunId=${LEFT}&rightRunId=${RIGHT}`,
  });
  await waitFor(cdp, `document.body.innerText.includes('Changed rule fields')`);
  const compare = await evaluate(cdp, `({
    path: location.pathname + location.search,
    hasVersion1: document.body.innerText.includes('Version 1'),
    hasVersion2: document.body.innerText.includes('Version 2'),
    hasPassed: document.body.innerText.includes('Passed'),
    hasOldMax: document.body.innerText.includes('0.550000'),
    hasNewMax: document.body.innerText.includes('0.600000'),
    changedFieldsText: Array.from(document.querySelectorAll('*')).find((node) => node.children.length === 0 && node.textContent.trim() === 'Changed rule fields')?.parentElement?.parentElement?.innerText?.slice(0, 400) ?? null,
    canvasCount: document.querySelectorAll('canvas').length,
    seriesToggleCount: document.querySelectorAll('input[type="checkbox"][id*="series"], button[id*="series"]').length,
  })`);
  await screenshot(cdp, 'docs/evidence/phase-6-compare.png');

  // History selection → compare route.
  await cdp.send('Page.navigate', { url: `${APP}/runs` });
  await waitFor(cdp, `document.querySelectorAll('input[type="checkbox"][id^="compare-"]').length > 0`);
  const selected = await evaluate(cdp, `(() => {
    const boxes = Array.from(document.querySelectorAll('input[type="checkbox"][id^="compare-"]'));
    const usable = boxes.filter((box) => !box.disabled);
    usable[0]?.click();
    usable[1]?.click();
    return usable.slice(0, 2).map((box) => box.id);
  })()`);
  await delay(300);
  const selectionState = await evaluate(cdp, `({
    selected: Array.from(document.querySelectorAll('input[type="checkbox"][id^="compare-"]')).filter((box) => box.checked).map((box) => box.id),
    compareDisabled: document.querySelector('#compare-selected-runs')?.disabled ?? null,
  })`);
  await evaluate(cdp, `document.querySelector('#compare-selected-runs')?.click()`);
  await waitFor(cdp, `location.pathname === '/compare'`);
  await waitFor(cdp, `document.body.innerText.includes('Run summaries')`);
  const selectionCompareUrl = await evaluate(cdp, `location.pathname + location.search`);

  const exceptions = cdp.events
    .filter((event) => event.method === 'Runtime.exceptionThrown')
    .map((event) => event.params.exceptionDetails.text);

  console.log(
    JSON.stringify(
      { compare, selected, selectionState, selectionCompareUrl, exceptions },
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
