// Two-tab stale-revision check for the plan editor (real Chrome, real API).
// Usage: PLAN_ID=... node scripts/phase-2-two-tab-check.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9335;
const APP = 'http://127.0.0.1:4200';
const PLAN_ID = process.env.PLAN_ID;
if (!PLAN_ID) throw new Error('PLAN_ID is required');

const userDataDir = mkdtempSync(join(tmpdir(), 'probedesk-chrome-'));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${userDataDir}`,
  '--headless=new',
  '--window-size=1280,900',
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

async function openTab(url) {
  const target = await (
    await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, {
      method: 'PUT',
    })
  ).json();
  const cdp = await connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  return cdp;
}

const setInput = (index, value) => `(() => {
  const inputs = document.querySelectorAll('input[id^="step-maximum-"]');
  const input = inputs[${index}];
  if (!input) throw new Error('maximum input ${index} not found');
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(input, ${JSON.stringify(value)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`;

const clickButton = (text) => `(() => {
  const button = Array.from(document.querySelectorAll('button'))
    .find((candidate) => candidate.textContent.trim() === ${JSON.stringify(text)});
  if (!button) throw new Error('button not found: ' + ${JSON.stringify(text)});
  button.click();
})()`;

async function main() {
  await waitForChrome();
  const tabA = await openTab(`${APP}/login`);
  await waitFor(tabA, `!!document.querySelector('#email')`);
  await evaluate(tabA, `(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const email = document.querySelector('#email');
    const password = document.querySelector('#password');
    set.call(email, 'planner@probedesk.local');
    email.dispatchEvent(new Event('input', { bubbles: true }));
    set.call(password, 'PlannerDemo!2026');
    password.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('form').requestSubmit();
  })()`);
  await waitFor(tabA, `location.pathname === '/plans'`);

  const tabB = await openTab(`${APP}/plans/${PLAN_ID}/edit`);
  await tabA.send('Page.navigate', { url: `${APP}/plans/${PLAN_ID}/edit` });
  await waitFor(tabA, `document.querySelectorAll('input[id^="step-maximum-"]').length === 3`);
  await waitFor(tabB, `document.querySelectorAll('input[id^="step-maximum-"]').length === 3`);

  const initialRevision = await evaluate(tabA, `(() => {
    const term = Array.from(document.querySelectorAll('dt')).find((dt) => dt.textContent.trim() === 'Draft revision');
    return term?.nextElementSibling?.textContent.trim() ?? null;
  })()`);

  // Tab A saves first.
  await evaluate(tabA, setInput(2, '0.650000'));
  await evaluate(tabA, clickButton('Save draft'));
  await waitFor(tabA, `(() => {
    const term = Array.from(document.querySelectorAll('dt')).find((dt) => dt.textContent.trim() === 'Draft revision');
    return term?.nextElementSibling?.textContent.trim() === '2';
  })()`);

  // Tab B still has revision 1 and tries to save its own edit.
  await evaluate(tabB, setInput(1, '5.300000'));
  await evaluate(tabB, clickButton('Save draft'));
  await waitFor(tabB, `document.body.innerText.includes('This draft changed in another session')`);

  const conflict = await evaluate(tabB, `(() => ({
    heading: document.querySelector('#conflict-heading')?.textContent.trim() ?? null,
    maximums: Array.from(document.querySelectorAll('input[id^="step-maximum-"]')).map((input) => input.value),
    alertText: Array.from(document.querySelectorAll('[role="alert"]')).map((node) => node.textContent.trim()).join(' | '),
  }))()`);

  const serverState = await evaluate(tabB, `fetch('/api/plans/${PLAN_ID}').then((response) => response.json()).then((plan) => ({
    revision: plan.draft?.editRevision ?? null,
    maximums: plan.draft?.steps?.map((step) => step.maximum) ?? [],
  }))`);

  const shot = await tabB.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('docs/evidence/phase-2-two-tab-conflict.png', Buffer.from(shot.data, 'base64'));

  const exceptions = [...tabA.events, ...tabB.events]
    .filter((event) => event.method === 'Runtime.exceptionThrown')
    .map((event) => event.params.exceptionDetails.text);

  console.log(JSON.stringify({ initialRevision, conflict, serverState, exceptions }, null, 2));
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
