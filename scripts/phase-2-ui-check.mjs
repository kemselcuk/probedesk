// Phase 2 UI evidence: publish version read-only page and new-draft editor.
// Usage: PLAN_ID=... V1_ID=... node scripts/phase-2-ui-check.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9334;
const APP = 'http://127.0.0.1:4200';
const PLAN_ID = process.env.PLAN_ID;
const V1_ID = process.env.V1_ID;
if (!PLAN_ID || !V1_ID) throw new Error('PLAN_ID and V1_ID are required');

const userDataDir = mkdtempSync(join(tmpdir(), 'probedesk-chrome-'));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${userDataDir}`,
  '--headless=new',
  '--window-size=1280,900',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-background-networking',
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

async function screenshot(cdp, path) {
  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
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
    set.call(email, 'planner@probedesk.local');
    email.dispatchEvent(new Event('input', { bubbles: true }));
    set.call(password, 'PlannerDemo!2026');
    password.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('form').requestSubmit();
  })()`);
  await waitFor(cdp, `location.pathname === '/plans'`);
  await waitFor(cdp, `document.body.innerText.includes('Power Supply Validation')`);
  const listText = await evaluate(cdp, `document.querySelector('main').innerText`);
  await screenshot(cdp, 'docs/evidence/phase-2-plans.png');

  // Published v1 page: immutable table, no edit controls.
  await cdp.send('Page.navigate', { url: `${APP}/plans/${PLAN_ID}/versions/${V1_ID}` });
  await waitFor(cdp, `document.body.innerText.includes('Ordered steps')`);
  await waitFor(cdp, `document.querySelectorAll('table tbody tr').length === 3`);
  const versionPage = await evaluate(cdp, `(() => {
    const rows = Array.from(document.querySelectorAll('table tbody tr')).map((row) =>
      Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent.trim()),
    );
    return {
      heading: document.querySelector('h2')?.textContent.trim(),
      rows,
      inputs: document.querySelectorAll('input, textarea, select').length,
      editButtons: Array.from(document.querySelectorAll('button'))
        .map((button) => button.textContent.trim())
        .filter((text) => /save|publish|add step/i.test(text)),
    };
  })()`);
  await screenshot(cdp, 'docs/evidence/phase-2-v1.png');

  // Editor after publishing: start a new draft, then read the cloned steps.
  await cdp.send('Page.navigate', { url: `${APP}/plans/${PLAN_ID}/edit` });
  await waitFor(cdp, `document.body.innerText.includes('Start new draft')`);
  const beforeDraft = await evaluate(cdp, `document.body.innerText.slice(0, 400)`);
  await evaluate(cdp, `(() => {
    const button = Array.from(document.querySelectorAll('button'))
      .find((candidate) => candidate.textContent.trim().startsWith('Start new draft'));
    if (!button) throw new Error('Start new draft button not found');
    button.click();
  })()`);
  await waitFor(cdp, `document.querySelectorAll('input[id^="step-name-"]').length === 3`);
  const editor = await evaluate(cdp, `(() => ({
    names: Array.from(document.querySelectorAll('input[id^="step-name-"]')).map((input) => input.value),
    maximums: Array.from(document.querySelectorAll('input[id^="step-maximum-"]')).map((input) => input.value),
    versionLinks: Array.from(document.querySelectorAll('a')).map((a) => a.textContent.trim()).filter((t) => /version/i.test(t)),
  }))()`);
  await screenshot(cdp, 'docs/evidence/phase-2-editor.png');

  const exceptions = cdp.events
    .filter((event) => event.method === 'Runtime.exceptionThrown')
    .map((event) => event.params.exceptionDetails.text);

  console.log(
    JSON.stringify(
      {
        listIncludesPlan: listText.includes('Power Supply Validation'),
        versionPage,
        beforeDraftIncludesStartNewDraft: beforeDraft.includes('Start new draft'),
        editor,
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
