#!/usr/bin/env node
/**
 * P7-04 accessibility and error-UX browser check.
 *
 * Requires the local Angular dev server and API from docs/testing.md:
 *   web  http://127.0.0.1:4200
 *   API  proxied through /api
 *
 * The script uses the real UI, real API and real PostgreSQL rows. It does not
 * save a draft, publish, start a run, or cancel a run. Error responses are
 * injected with Playwright routing so the error panels can be inspected
 * without creating product data. The cancel dialog uses a copied terminal
 * snapshot with status RUNNING because no run was active during the check;
 * the cancellation POST is never sent.
 *
 * Screenshots are written to docs/evidence/phase-7-accessibility-*.png.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE_DIR = join(ROOT, 'docs', 'evidence');
const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4200';

mkdirSync(EVIDENCE_DIR, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
const pageErrors = [];

function record(name, value) {
  results.push({ name, value });
  console.log(`\n[${name}]`);
  console.log(JSON.stringify(value, null, 2));
}

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function login(context, role, password) {
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(`${role}: ${error.message}`));
  await page.goto(`${BASE}/login`);
  await page.fill('#email', `${role}@probedesk.local`);
  await page.fill('#password', password);
  await page.click('button[type=submit]');
  await page.waitForURL('**/plans');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
  return page;
}

async function screenshot(page, name) {
  const path = join(EVIDENCE_DIR, `phase-7-accessibility-${name}.png`);
  await page.screenshot({ path, fullPage: false });
  return path;
}

async function scrollShellToTop(page) {
  await page.evaluate(() => {
    document.querySelector('mat-sidenav-content')?.scrollTo(0, 0);
  });
}

async function pageOverflow(page) {
  return page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
}

async function capturePage(page, path, label, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${BASE}${path}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
  await scrollShellToTop(page);
  const overflow = await pageOverflow(page);
  assert(
    overflow.documentWidth <= overflow.viewport && overflow.bodyWidth <= overflow.viewport,
    `${label} at ${width}px has page-level horizontal overflow: ${JSON.stringify(overflow)}`,
  );
  return { ...overflow, file: await screenshot(page, `${label}-${width}`) };
}

async function api(context, path) {
  const response = await context.request.get(`${BASE}${path}`);
  assert(response.ok(), `GET ${path} failed with ${response.status()}`);
  return response.json();
}

// Planner: plans overview, editor keyboard reorder, form errors, publish and
// discard dialogs, save failure with retained input.
const plannerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const planner = await login(plannerContext, 'planner', 'PlannerDemo!2026');
const plans = await api(plannerContext, '/api/plans');
const editablePlan = plans.find((plan) => plan.draft !== null) ?? plans[0];
assert(editablePlan !== undefined, 'No plan was available for the editor checks');

record('plans.viewport', await capturePage(planner, '/plans', 'plans', 1280));
record('plans.viewport.768', await capturePage(planner, '/plans', 'plans', 768));

await planner.setViewportSize({ width: 1280, height: 900 });
await planner.goto(`${BASE}/plans/${editablePlan.id}/edit`);
await planner.waitForLoadState('networkidle');
await planner.waitForTimeout(400);
await scrollShellToTop(planner);
const editorShot1280 = await screenshot(planner, 'plan-editor-1280');
await planner.setViewportSize({ width: 768, height: 900 });
await planner.waitForTimeout(300);
const editorShot768 = await screenshot(planner, 'plan-editor-768');
record('plan-editor.screenshots', { editorShot1280, editorShot768 });
await planner.setViewportSize({ width: 1280, height: 900 });
await planner.waitForTimeout(300);

const publishButton = planner.locator('#publish-button');
assert(await publishButton.isEnabled(), 'Publish must be enabled for a clean saved draft');
await publishButton.focus();
await planner.keyboard.press('Enter');
await planner.waitForSelector('mat-dialog-container');
await planner.waitForTimeout(300);
const publishDialog = {
  text: (await planner.locator('mat-dialog-container').innerText()).replace(/\s+/g, ' ').trim(),
  activeText: (await planner.evaluate(() => document.activeElement?.textContent ?? '')).trim(),
  screenshot: await screenshot(planner, 'publish-dialog-1280'),
};
await planner.keyboard.press('Escape');
await planner.waitForSelector('mat-dialog-container', { state: 'detached' });
await planner.waitForTimeout(300);
publishDialog.afterEscape = await planner.evaluate(() => ({
  activeId: document.activeElement?.id ?? '',
  publishUrl: location.pathname + location.search,
}));
assert(publishDialog.activeText.includes('Keep editing'), 'Publish dialog must focus Keep editing first');
assert(
  publishDialog.afterEscape.activeId === 'publish-button',
  'Publish dialog must restore focus to the Publish button',
);
record('publish-dialog', publishDialog);

const previewsBefore = await planner.locator('.step-preview').allTextContents();
const moveDown = planner.locator('button[id^="move-down-"]').first();
const movedClientId = (await moveDown.getAttribute('id')).replace('move-down-', '');
await moveDown.focus();
await planner.keyboard.press('Enter');
await planner.waitForTimeout(400);
const moveResult = await planner.evaluate((clientId) => ({
  activeId: document.activeElement?.id ?? '',
  announcement: document
    .querySelector('.steps-section [aria-live]')
    ?.textContent?.replace(/\s+/g, ' ')
    .trim(),
  headingId: `step-heading-${clientId}`,
  headingText: document.getElementById(`step-heading-${clientId}`)?.textContent?.replace(/\s+/g, ' ').trim(),
  previews: Array.from(document.querySelectorAll('.step-preview')).map((entry) =>
    entry.textContent?.replace(/\s+/g, ' ').trim(),
  ),
}), movedClientId);
assert(moveResult.activeId === moveResult.headingId, 'Move down must focus the moved step heading');
assert(moveResult.announcement?.includes('moved to position 2'), 'Move down must announce the new position');
record('plan-editor.keyboard-reorder', {
  previewsBefore,
  ...moveResult,
  screenshot: await screenshot(planner, 'plan-editor-reordered-1280'),
});

const moveUp = planner.locator(`#move-up-${movedClientId}`);
await moveUp.focus();
await planner.keyboard.press('Enter');
await planner.waitForTimeout(400);
record('plan-editor.keyboard-reorder-restored', {
  activeId: await planner.evaluate(() => document.activeElement?.id ?? ''),
  announcement: await planner.evaluate(() =>
    document.querySelector('.steps-section [aria-live]')?.textContent?.replace(/\s+/g, ' ').trim(),
  ),
});

const originalPlanName = await planner.locator('#plan-name').inputValue();
const firstNameInput = planner.locator('input[id^="step-name-"]').first();
const firstStepId = await firstNameInput.getAttribute('id');
const originalStepName = await firstNameInput.inputValue();
assert(firstStepId !== null, 'First step name input was not found');

await planner.fill('#plan-name', '');
await planner.fill(`#${firstStepId}`, '');
const saveButton = planner.locator('button[type=submit]');
await saveButton.focus();
await planner.keyboard.press('Enter');
await planner.waitForSelector('#validation-summary');
await planner.waitForTimeout(400);
const fieldErrorState = await planner.evaluate((stepId) => {
  const describedBy = (id) => document.getElementById(id)?.getAttribute('aria-describedby') ?? '';
  const errorId = stepId.replace('step-name-', 'step-name-error-');
  return {
    activeId: document.activeElement?.id ?? '',
    summary: document.getElementById('validation-summary')?.innerText.replace(/\s+/g, ' ').trim(),
    planDescribedBy: describedBy('plan-name'),
    planError: document.getElementById('plan-name-error')?.textContent?.trim(),
    stepDescribedBy: describedBy(stepId),
    stepError: document.getElementById(errorId)?.textContent?.trim(),
  };
}, firstStepId);
assert(
  fieldErrorState.planDescribedBy?.split(/\s+/).includes('plan-name-error'),
  'Plan name error must be linked with aria-describedby',
);
assert(
  fieldErrorState.stepDescribedBy
    ?.split(/\s+/)
    .includes(firstStepId.replace('step-name-', 'step-name-error-')),
  'Step name error must be linked with aria-describedby',
);
assert(fieldErrorState.activeId === 'validation-summary', 'Invalid save must focus the validation summary');
await planner.setViewportSize({ width: 768, height: 900 });
await planner.waitForTimeout(300);
const validationShot = await screenshot(planner, 'plan-editor-validation-768');
await planner.setViewportSize({ width: 1280, height: 900 });
await planner.waitForTimeout(300);
record('plan-editor.field-errors', { ...fieldErrorState, screenshot: validationShot });

await planner.fill('#plan-name', originalPlanName);
await planner.fill(`#${firstStepId}`, originalStepName);

const keptName = 'Accessibility evidence - kept input';
await planner.fill('#plan-name', keptName);
await planner.route('**/api/plans/*/draft', (route) =>
  route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({
      code: 'SERVICE_UNAVAILABLE',
      message: 'The plan service is temporarily unavailable.',
      requestId: 'req-p7-save-503',
    }),
  }),
);
await saveButton.focus();
await planner.keyboard.press('Enter');
await planner.waitForSelector('#save-error-panel');
await planner.waitForTimeout(500);
const save503 = await planner.evaluate(() => ({
  value: document.querySelector('#plan-name')?.value,
  activeId: document.activeElement?.id ?? '',
  panel: document.querySelector('#save-error-panel')?.innerText.replace(/\s+/g, ' ').trim(),
  url: location.pathname + location.search,
}));
assert(save503.value === keptName, 'Save 503 must keep the local plan name');
assert(save503.panel?.includes('req-p7-save-503'), 'Save 503 must show the requestId');
assert(save503.activeId === 'save-error-panel', 'Save 503 must focus the error panel');
await planner.locator('#save-error-panel').evaluate((element) => element.scrollIntoView({ block: 'center' }));
await planner.waitForTimeout(200);
save503.screenshot = await screenshot(planner, 'plan-save-error-1280');
record('plan-editor.save-503', save503);
await planner.unroute('**/api/plans/*/draft');

await planner.route('**/api/plans/*/draft', (route) => route.abort('failed'));
await saveButton.focus();
await planner.keyboard.press('Enter');
await planner.waitForTimeout(700);
const saveNetwork = await planner.evaluate(() => ({
  value: document.querySelector('#plan-name')?.value,
  activeId: document.activeElement?.id ?? '',
  panel: document.querySelector('#save-error-panel')?.innerText.replace(/\s+/g, ' ').trim(),
  saveState: document.querySelector('.save-state')?.textContent?.trim(),
}));
assert(
  saveNetwork.panel?.includes('The server could not be reached'),
  'Network save failure must show the normalized network message',
);
assert(saveNetwork.value === keptName, 'Network save failure must keep the local plan name');
assert(
  saveNetwork.saveState === 'Unsaved changes',
  'Failed save must not claim that changes were saved',
);
record('plan-editor.save-network', saveNetwork);
await planner.unroute('**/api/plans/*/draft');

const historyLink = planner.getByRole('link', { name: /Run History/ }).first();
await historyLink.focus();
await planner.keyboard.press('Enter');
await planner.waitForSelector('mat-dialog-container');
await planner.waitForTimeout(300);
const discardDialog = {
  activeText: (await planner.evaluate(() => document.activeElement?.textContent ?? '')).trim(),
  text: (await planner.locator('mat-dialog-container').innerText()).replace(/\s+/g, ' ').trim(),
  screenshot: await screenshot(planner, 'discard-dialog-1280'),
};
assert(discardDialog.activeText.includes('Keep editing'), 'Discard dialog must focus Keep editing');
assert(discardDialog.text.includes('Leave without saving?'), 'Discard dialog text missing');
await planner.keyboard.press('Escape');
await planner.waitForSelector('mat-dialog-container', { state: 'detached' });
await planner.waitForTimeout(400);
discardDialog.afterEscape = await planner.evaluate(() => ({
  url: location.pathname + location.search,
  value: document.querySelector('#plan-name')?.value,
}));
assert(
  discardDialog.afterEscape.url === `/plans/${editablePlan.id}/edit`,
  'Escape must keep the editor open',
);
assert(discardDialog.afterEscape.value === keptName, 'Escape must keep the unsaved local input');
record('discard-dialog', discardDialog);
await plannerContext.close();

// Operator: history, details, compare, live, start-run failure and a real 401.
const operatorContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const operator = await login(operatorContext, 'operator', 'OperatorDemo!2026');
const runs = await api(operatorContext, '/api/runs?limit=100');
const failedRun = runs.items.find((run) => run.outcome === 'FAILED');
assert(failedRun !== undefined, 'A FAILED run is required for the chart checks');
const terminalRuns = runs.items.filter((run) => run.status !== 'RUNNING');
const sameVersionRuns = terminalRuns.filter(
  (run) => run.planId === failedRun.planId && run.versionNumber === failedRun.versionNumber,
);
const pair = sameVersionRuns.length >= 2 ? sameVersionRuns.slice(0, 2) : terminalRuns.slice(0, 2);
assert(pair.length === 2, 'Two terminal runs are required for the comparison checks');
const operatorPlans = await api(operatorContext, '/api/plans');
const startVersionId = operatorPlans[0]?.latestPublishedVersion?.id;
assert(typeof startVersionId === 'string', 'A published version is required for Start Run');
const planNameCounts = new Map();
for (const plan of operatorPlans) {
  planNameCounts.set(plan.name, (planNameCounts.get(plan.name) ?? 0) + 1);
}
const duplicatePlanName = [...planNameCounts.entries()].find(([, count]) => count > 1)?.[0];
assert(typeof duplicatePlanName === 'string', 'Two same-name plans are required for the filter check');

record('history.viewport', await capturePage(operator, '/runs', 'history', 1280));
record('history.viewport.768', await capturePage(operator, '/runs', 'history', 768));
const historyTable = await operator.evaluate(() => {
  const region = document.querySelector('#run-history-table');
  const planCell = document.querySelector('tbody td.plan-cell');
  return {
    role: region?.getAttribute('role'),
    tabIndex: region?.getAttribute('tabindex'),
    clientWidth: region?.clientWidth,
    scrollWidth: region?.scrollWidth,
    planCellWidth: Math.round(planCell?.getBoundingClientRect().width ?? 0),
    hint: document.querySelector('#run-history-table-hint')?.textContent?.replace(/\s+/g, ' ').trim(),
  };
});
assert(historyTable.role === 'region', 'History table scroll container must be a region');
assert(historyTable.tabIndex === '0', 'History table must be keyboard focusable');
assert((historyTable.planCellWidth ?? 0) >= 170, 'History plan column must not collapse');
assert((historyTable.scrollWidth ?? 0) > (historyTable.clientWidth ?? 0), 'History table should scroll');
record('history.table-region', historyTable);
await operator.locator('#run-history-table').scrollIntoViewIfNeeded();
await operator.evaluate(() => {
  const region = document.querySelector('#run-history-table');
  if (region !== null) region.scrollLeft = region.scrollWidth;
});
await operator.waitForTimeout(300);
record('history.table-scrolled-right-768', {
  screenshot: await screenshot(operator, 'history-table-right-768'),
});

await operator.setViewportSize({ width: 1280, height: 900 });
await operator.goto(`${BASE}/runs?status=BOGUS&page=abc&from=notadate`);
await operator.waitForLoadState('networkidle');
await operator.waitForTimeout(400);
const invalidFilters = await operator.evaluate(() => ({
  warning: document.querySelector('.filter-warning')?.innerText.replace(/\s+/g, ' ').trim(),
  statusValue: document.querySelector('#history-status')?.value,
  fromValue: document.querySelector('#history-from')?.value,
  url: location.pathname + location.search,
  rows: document.querySelectorAll('tbody tr').length,
}));
assert(
  invalidFilters.warning?.includes('filter values that cannot be used'),
  'Invalid URL filters must show a visible warning',
);
assert(
  invalidFilters.statusValue === '' && invalidFilters.fromValue === '',
  'Invalid filters must not be applied',
);
record('history.invalid-url-filters', {
  ...invalidFilters,
  screenshot: await screenshot(operator, 'history-invalid-filters-1280'),
});

await operator.goto(`${BASE}/runs`);
await operator.waitForLoadState('networkidle');
const planOptions = await operator.evaluate(() =>
  Array.from(document.querySelectorAll('#history-plan option')).map((option) =>
    option.textContent?.replace(/\s+/g, ' ').trim(),
  ),
);
const duplicateOptions = planOptions.filter((text) => text?.startsWith(`${duplicatePlanName} —`));
assert(duplicateOptions.length >= 2, 'Two same-name plan options are required');
assert(
  duplicateOptions.every((text) => /\(plan [0-9a-f]{8}\)/.test(text ?? '')),
  'Same-name plan options must include a short plan id',
);
assert(new Set(duplicateOptions).size === duplicateOptions.length, 'Same-name plan options must be distinct');
record('history.plan-options', { planOptions, duplicateOptions });

const nextPage = operator.getByRole('button', { name: 'Next page' });
assert(await nextPage.isVisible(), 'Next page is required for the focus check');
await nextPage.focus();
await operator.keyboard.press('Enter');
await operator.waitForURL('**/runs?page=2');
await operator.waitForLoadState('networkidle');
await operator.waitForTimeout(700);
const pageFocus = await operator.evaluate(() => ({
  active: document.activeElement?.tagName + '#' + (document.activeElement?.id ?? ''),
  activeText: document.activeElement?.textContent?.trim(),
  range: document.querySelector('.result-range')?.textContent?.trim(),
  pagePosition: document.querySelector('.page-position')?.textContent?.replace(/\s+/g, ' ').trim(),
}));
assert(pageFocus.active === 'H2#history-results-heading', 'Page change must focus the results heading');
record('history.page-change-focus', pageFocus);

await operator.goto(`${BASE}/runs`);
await operator.waitForLoadState('networkidle');
await operatorContext.clearCookies();
const expiredNext = operator.getByRole('button', { name: 'Next page' });
await expiredNext.focus();
await operator.keyboard.press('Enter');
await operator.waitForURL('**/login**', { timeout: 10_000 });
await operator.waitForTimeout(700);
const expired = await operator.evaluate(() => {
  const query = new URLSearchParams(location.search);
  return {
    url: location.pathname + location.search,
    returnUrl: query.get('returnUrl'),
    reason: query.get('reason'),
    notice: document.querySelector('.session-notice')?.textContent?.replace(/\s+/g, ' ').trim(),
    activeId: document.activeElement?.id ?? '',
  };
});
assert(expired.returnUrl === '/runs?page=2', '401 redirect must preserve the exact history URL');
assert(expired.reason === 'session-expired', '401 redirect must explain the reason');
assert(expired.notice?.includes('Your session ended'), 'Login page must explain the session expiry');
assert(expired.activeId === 'login-heading', 'Login page must move focus to its heading');
await operator.setViewportSize({ width: 768, height: 900 });
await operator.waitForTimeout(300);
const expiredShot = await screenshot(operator, 'session-expired-768');
record('history.real-401', { ...expired, screenshot: expiredShot });

await operator.fill('#email', 'operator@probedesk.local');
await operator.fill('#password', 'OperatorDemo!2026');
await operator.click('button[type=submit]');
await operator.waitForURL('**/runs?page=2');
await operator.waitForLoadState('networkidle');
await operator.waitForTimeout(700);
record('history.return-after-login', {
  url: operator.url(),
  pagePosition: await operator.locator('.page-position').textContent().then((text) => text?.replace(/\s+/g, ' ').trim()),
  rows: await operator.locator('tbody tr').count(),
});

await operator.setViewportSize({ width: 1280, height: 900 });
await operator.goto(`${BASE}/runs/${failedRun.id}`);
await operator.waitForSelector('app-measurement-chart canvas');
await operator.waitForTimeout(900);
await scrollShellToTop(operator);
const detailsOverflow1280 = await pageOverflow(operator);
assert(detailsOverflow1280.documentWidth <= detailsOverflow1280.viewport, 'Details must not overflow at 1280');
record('details.viewport', {
  ...detailsOverflow1280,
  screenshot: await screenshot(operator, 'details-1280'),
});

await operator.setViewportSize({ width: 768, height: 900 });
await operator.waitForTimeout(500);
const detailsOverflow = await pageOverflow(operator);
assert(detailsOverflow.documentWidth <= detailsOverflow.viewport, 'Details must not overflow at 768');
await scrollShellToTop(operator);
const detailsShot768 = await screenshot(operator, 'details-768');
await operator.locator('.measurement-chart').first().scrollIntoViewIfNeeded();
await operator.waitForTimeout(300);
const detailsChart768 = await screenshot(operator, 'details-chart-768');
await operator.locator('.measurements .table-scroll').first().scrollIntoViewIfNeeded();
await operator.waitForTimeout(300);
const detailsTable = await operator.evaluate(() => {
  const region = document.querySelector('.measurements .table-scroll');
  return {
    clientWidth: region?.clientWidth,
    scrollWidth: region?.scrollWidth,
    role: region?.getAttribute('role'),
    tabIndex: region?.getAttribute('tabindex'),
    label: region?.getAttribute('aria-label'),
  };
});
assert(detailsTable.role === 'region', 'Details table must be a region');
assert(detailsTable.tabIndex === '0', 'Details table must be keyboard focusable');
assert(
  (detailsTable.scrollWidth ?? 0) <= (detailsTable.clientWidth ?? 0),
  'Details measurement table should fit at 768',
);
const detailsTable768 = await screenshot(operator, 'details-table-768');
record('details.viewport.768', {
  ...detailsOverflow,
  screenshots: { detailsShot768, detailsChart768, detailsTable768 },
  table: detailsTable,
});

const failureButton = operator.locator('.failure-item').first();
assert(await failureButton.count(), 'A chart failure list is required');
await failureButton.focus();
await operator.keyboard.press('Enter');
await operator.waitForTimeout(500);
const failureSelection = await operator.evaluate(() => ({
  activeId: document.activeElement?.id ?? '',
  ariaCurrent: document.activeElement?.getAttribute('aria-current'),
  selectedRows: document.querySelectorAll('tr.is-selected').length,
  announcement: Array.from(document.querySelectorAll('[role="status"]'))
    .map((entry) => entry.textContent?.replace(/\s+/g, ' ').trim())
    .find((text) => text?.includes('Outside tolerance')),
}));
assert(failureSelection.activeId.startsWith('measurement-row-'), 'Failure selection must focus the row');
assert(failureSelection.ariaCurrent === 'true', 'Selected row must expose aria-current');
assert(failureSelection.selectedRows === 1, 'Exactly one measurement row must be selected');
record('details.chart-failure-keyboard', failureSelection);

await operator.setViewportSize({ width: 1280, height: 900 });
await operator.goto(`${BASE}/compare?leftRunId=${pair[0].id}&rightRunId=${pair[1].id}`);
await operator.waitForLoadState('networkidle');
await operator.waitForSelector('.comparison-summary');
await operator.waitForTimeout(900);
await scrollShellToTop(operator);
const compareOverflow1280 = await pageOverflow(operator);
assert(compareOverflow1280.documentWidth <= compareOverflow1280.viewport, 'Compare must not overflow at 1280');
record('compare.viewport', {
  ...compareOverflow1280,
  screenshot: await screenshot(operator, 'compare-1280'),
});
await operator.setViewportSize({ width: 768, height: 900 });
await operator.waitForTimeout(500);
const compareOverflow = await pageOverflow(operator);
assert(compareOverflow.documentWidth <= compareOverflow.viewport, 'Compare must not overflow at 768');
await scrollShellToTop(operator);
const compareShot768 = await screenshot(operator, 'compare-768');
await operator.locator('.comparison-chart').first().scrollIntoViewIfNeeded();
await operator.waitForTimeout(300);
const compareChart768 = await screenshot(operator, 'compare-chart-768');
const compareTables = await operator.evaluate(() =>
  Array.from(document.querySelectorAll('.step-card .table-scroll')).map((region) => ({
    clientWidth: region.clientWidth,
    scrollWidth: region.scrollWidth,
  })),
);
assert(
  compareTables.every((table) => table.scrollWidth <= table.clientWidth),
  'Compare tables must fit their containers at 768',
);
const seriesToggle = operator.locator('.series-toggle').first();
assert((await seriesToggle.count()) === 1, 'A comparison chart series toggle is required');
const toggleBefore = await seriesToggle.getAttribute('aria-pressed');
await seriesToggle.focus();
await operator.keyboard.press('Enter');
await operator.waitForTimeout(300);
const toggleAfter = await seriesToggle.getAttribute('aria-pressed');
const toggleAnnouncement = await operator.evaluate(() =>
  document.querySelector('.comparison-chart [role="status"]')?.textContent?.replace(/\s+/g, ' ').trim(),
);
assert(toggleBefore !== toggleAfter, 'Enter must toggle the series visibility');
assert(
  toggleAnnouncement?.includes('recorded data and backend results did not change'),
  'Series toggle announcement missing',
);
record('compare.viewport.768', {
  ...compareOverflow,
  screenshots: { compareShot768, compareChart768 },
  tables: compareTables,
});
record('compare.series-toggle-keyboard', {
  before: toggleBefore,
  after: toggleAfter,
  announcement: toggleAnnouncement,
});

await operator.setViewportSize({ width: 1280, height: 900 });
await operator.goto(`${BASE}/runs/${failedRun.id}/live`);
await operator.waitForLoadState('networkidle');
await operator.waitForSelector('#live-charts-section');
await operator.waitForTimeout(900);
await scrollShellToTop(operator);
const liveOverflow1280 = await pageOverflow(operator);
assert(liveOverflow1280.documentWidth <= liveOverflow1280.viewport, 'Live Run must not overflow at 1280');
record('live.viewport', {
  ...liveOverflow1280,
  screenshot: await screenshot(operator, 'live-1280'),
});
await operator.setViewportSize({ width: 768, height: 900 });
await operator.waitForTimeout(500);
const liveOverflow = await pageOverflow(operator);
assert(liveOverflow.documentWidth <= liveOverflow.viewport, 'Live Run must not overflow at 768');
await scrollShellToTop(operator);
const liveShot768 = await screenshot(operator, 'live-768');
await operator.locator('#live-charts-section').scrollIntoViewIfNeeded();
await operator.waitForTimeout(300);
const liveChart768 = await screenshot(operator, 'live-chart-768');
const liveTables = await operator.evaluate(() =>
  Array.from(
    document.querySelectorAll(
      '#live-charts-section .table-scroll, .measurements-section .table-scroll',
    ),
  ).map((region) => ({
    clientWidth: region.clientWidth,
    scrollWidth: region.scrollWidth,
    role: region.getAttribute('role'),
    tabIndex: region.getAttribute('tabindex'),
  })),
);
assert(
  liveTables.every((table) => table.scrollWidth <= table.clientWidth),
  'Live Run tables must fit their containers at 768',
);
assert(
  liveTables.every((table) => table.role === 'region' && table.tabIndex === '0'),
  'Live Run tables must be keyboard-focusable regions',
);
record('live.viewport.768', {
  ...liveOverflow,
  screenshots: { liveShot768, liveChart768 },
  tables: liveTables,
});

await operator.setViewportSize({ width: 1280, height: 900 });
await operator.goto(`${BASE}/runs/new?versionId=${startVersionId}`);
await operator.waitForLoadState('networkidle');
await operator.waitForTimeout(300);
await operator.fill('#start-run-seed', '12345');
await operator.selectOption('#start-run-scenario', 'RANDOM');
await operator.fill('#start-run-error-probability', '0.25');
await operator.route('**/api/runs', (route) =>
  route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({
      code: 'SERVICE_UNAVAILABLE',
      message: 'The run service is temporarily unavailable.',
      requestId: 'req-p7-start-503',
    }),
  }),
);
const startButton = operator.locator('#start-run-submit');
await startButton.focus();
await operator.keyboard.press('Enter');
await operator.waitForSelector('#start-run-error-panel');
await operator.waitForTimeout(600);
const start503 = await operator.evaluate(() => ({
  seed: document.querySelector('#start-run-seed')?.value,
  scenario: document.querySelector('#start-run-scenario')?.value,
  probability: document.querySelector('#start-run-error-probability')?.value,
  activeId: document.activeElement?.id ?? '',
  panel: document.querySelector('#start-run-error-panel')?.innerText.replace(/\s+/g, ' ').trim(),
  url: location.pathname + location.search,
  buttonText: document.querySelector('#start-run-submit')?.textContent?.trim(),
}));
assert(start503.seed === '12345' && start503.probability === '0.25', 'Start 503 must keep all inputs');
assert(start503.panel?.includes('req-p7-start-503'), 'Start 503 must show the requestId');
assert(start503.panel?.includes('Your settings are still here.'), 'Start 503 must reassure about the form');
assert(start503.activeId === 'start-run-error-panel', 'Start 503 must focus the error panel');
assert(start503.url.includes('/runs/new'), 'Start 503 must not navigate as if it succeeded');
await operator.locator('#start-run-error-panel').evaluate((element) => element.scrollIntoView({ block: 'center' }));
await operator.waitForTimeout(200);
start503.screenshot = await screenshot(operator, 'start-run-error-1280');
record('start-run.503', start503);
await operator.unroute('**/api/runs');

await operator.route('**/api/runs', (route) => route.abort('failed'));
await startButton.focus();
await operator.keyboard.press('Enter');
await operator.waitForTimeout(700);
const startNetwork = await operator.evaluate(() => ({
  seed: document.querySelector('#start-run-seed')?.value,
  activeId: document.activeElement?.id ?? '',
  panel: document.querySelector('#start-run-error-panel')?.innerText.replace(/\s+/g, ' ').trim(),
  url: location.pathname + location.search,
}));
assert(
  startNetwork.panel?.includes('The server could not be reached'),
  'Start network failure message missing',
);
assert(startNetwork.seed === '12345', 'Start network failure must keep the input');
record('start-run.network', startNetwork);
await operator.unroute('**/api/runs');

// Cancel dialog: a copied terminal snapshot is served as RUNNING only for this
// page load; Escape must close the dialog, restore focus, and never send the
// cancellation POST.
const failedSnapshot = await api(operatorContext, `/api/runs/${failedRun.id}`);
const runningFixture = { ...failedSnapshot, status: 'RUNNING', outcome: null, finishedAt: null };
await operator.route(`**/api/runs/${failedRun.id}`, (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(runningFixture) }),
);
await operator.goto(`${BASE}/runs/${failedRun.id}`);
await operator.waitForSelector('#cancel-run-button');
await operator.waitForTimeout(300);
await operator.locator('#cancel-run-button').focus();
await operator.keyboard.press('Enter');
await operator.waitForSelector('mat-dialog-container');
await operator.waitForTimeout(300);
const cancelDialog = {
  text: (await operator.locator('mat-dialog-container').innerText()).replace(/\s+/g, ' ').trim(),
  activeText: (await operator.evaluate(() => document.activeElement?.textContent ?? '')).trim(),
  screenshot: await screenshot(operator, 'cancel-dialog-1280'),
};
assert(cancelDialog.text.includes('Cancel this run?'), 'Cancel dialog did not open');
assert(cancelDialog.activeText.includes('Keep running'), 'Cancel dialog must focus Keep running');
const cancelRequests = [];
operator.on('request', (request) => {
  if (request.method() === 'POST' && request.url().endsWith(`/api/runs/${failedRun.id}/cancel`)) {
    cancelRequests.push(request.url());
  }
});
await operator.keyboard.press('Escape');
await operator.waitForSelector('mat-dialog-container', { state: 'detached' });
await operator.waitForTimeout(400);
cancelDialog.afterEscape = await operator.evaluate(() => ({
  activeId: document.activeElement?.id ?? '',
  status: document.querySelector('.status-badge')?.textContent?.replace(/\s+/g, ' ').trim(),
}));
assert(cancelDialog.afterEscape.activeId === 'cancel-run-button', 'Cancel dialog must restore focus');
assert(cancelDialog.afterEscape.status?.includes('Running'), 'Escape must not change the run status');
assert(cancelRequests.length === 0, 'Escape must not send a cancellation request');
record('cancel-dialog.keyboard', cancelDialog);
await operator.unroute(`**/api/runs/${failedRun.id}`);

assert(pageErrors.length === 0, `Unexpected page errors: ${pageErrors.join('; ')}`);
record('page-errors', pageErrors);

const screenshotFiles = results
  .flatMap((entry) => [
    typeof entry.value?.file === 'string' ? entry.value.file : null,
    ...(typeof entry.value?.screenshot === 'string' ? [entry.value.screenshot] : []),
    ...(entry.value?.screenshots ? Object.values(entry.value.screenshots) : []),
  ])
  .filter((file) => typeof file === 'string')
  .map((file) => file.replace(`${ROOT}/`, ''));

record('summary', {
  screenshots: [...new Set(screenshotFiles)],
  resultCount: results.length,
});

await operatorContext.close();
await browser.close();
console.log('\nP7-04 accessibility browser check passed.');
