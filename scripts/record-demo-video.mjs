// Records the short ProbeDesk demo video from the running delivery stack.
// Usage: APP_URL=http://127.0.0.1:8080 node scripts/record-demo-video.mjs
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const APP = process.env.APP_URL ?? 'http://127.0.0.1:8080';
const API = process.env.API_URL ?? `${APP}/api`;
const outputDir = 'docs/evidence/video-work';
const finalVideo = 'docs/evidence/probedesk-demo.mp4';

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: outputDir, size: { width: 1280, height: 800 } },
});
const page = await context.newPage();

async function caption(text) {
  await page.evaluate((value) => {
    let node = document.getElementById('demo-caption');
    if (!node) {
      node = document.createElement('div');
      node.id = 'demo-caption';
      node.style.cssText = [
        'position:fixed',
        'left:24px',
        'bottom:24px',
        'z-index:99999',
        'max-width:900px',
        'padding:14px 20px',
        'border-radius:12px',
        'background:rgba(16,24,40,.92)',
        'color:#fff',
        'font:500 18px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',
        'box-shadow:0 8px 30px rgba(0,0,0,.25)',
      ].join(';');
      document.body.appendChild(node);
    }
    node.textContent = value;
  }, text);
  await page.waitForTimeout(2400);
}

async function slowScrollTo(selector) {
  await page.locator(selector).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(1400);
}

async function login(email, password) {
  await page.goto(`${APP}/login`);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/plans$/);
}

await page.addInitScript(() => {
  window.__probedeskChartDebug = true;
});

// Resolve demo ids from the public API after a browser login.
await login('operator@probedesk.local', 'OperatorDemo!2026');
const ids = await page.evaluate(async ({ api }) => {
  const runs = await fetch(`${api}/runs?limit=20`).then((response) => response.json());
  const failed = runs.items.find((run) => run.outcome === 'FAILED');
  const passed = runs.items.find(
    (run) => run.outcome === 'PASSED' && run.versionNumber === 1,
  );
  const v2 = runs.items.find((run) => run.outcome === 'PASSED' && run.versionNumber === 2);
  const versions = await fetch(`${api}/plans/${failed.planId}/versions`).then((r) => r.json());
  return {
    failedRun: failed.id,
    passedRun: passed.id,
    v2Run: v2.id,
    v1: versions.find((version) => version.versionNumber === 1).id,
    v2: versions.find((version) => version.versionNumber === 2).id,
  };
}, { api: API });

await caption('ProbeDesk — versioned measurement plans, deterministic runs and comparison');

await page.goto(`${APP}/plans`);
await caption('One seeded plan, two immutable published versions, real measured runs');
await slowScrollTo('main');

await page.goto(`${APP}/runs`);
await caption('Run History: backend counters, first failure and partial results');
await slowScrollTo('table');

await page.goto(`${APP}/runs/${ids.failedRun}`);
await caption('FAILED run keeps its own snapshot rules — later v2 changes cannot alter it');
await slowScrollTo('app-measurement-chart');

const chartPoint = await page.evaluate(() => {
  const entries = window.__probedeskCharts ?? [];
  const entry = entries.find((candidate) => candidate.stepName === 'Current Draw');
  if (!entry) return null;
  const point = entry.debug.pointPixel(14);
  const rect = entry.canvas.getBoundingClientRect();
  return point ? { x: rect.x + point.x, y: rect.y + point.y } : null;
});
if (chartPoint) {
  await page.mouse.move(chartPoint.x - 3, chartPoint.y - 3);
  await page.mouse.move(chartPoint.x, chartPoint.y);
  await page.waitForTimeout(2400);
  await caption('The failure is the stored 0.600000 A sample — the backend verdict, not a chart guess');
}

await page.goto(`${APP}/compare?leftRunId=${ids.failedRun}&rightRunId=${ids.v2Run}`);
await caption('Compare v1 FAILED with v2 PASSED: changed rules are highlighted, no invented deltas');
await slowScrollTo('app-comparison-step-card');

await page.goto(`${APP}/runs/${ids.v2Run}`);
await caption('The v2 run passes under the new 0.65 A limit; both versions remain inspectable');
await slowScrollTo('main');

await caption('ProbeDesk demo complete — local Docker Compose delivery, no paid services');
await page.waitForTimeout(2200);

const videoPath = await page.video().path();
await context.close();
await browser.close();

try {
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-i',
      videoPath,
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '24',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-an',
      finalVideo,
    ],
    { stdio: 'ignore' },
  );
  console.log(`Wrote ${finalVideo}`);
} finally {
  rmSync(outputDir, { recursive: true, force: true });
}
