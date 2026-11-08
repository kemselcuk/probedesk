import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type Playwright,
} from '@playwright/test';
import {
  assertE2eSerialExecution,
  cleanupE2eData,
  prepareE2eDatabase,
  type E2eDatabaseBaseline,
} from './support/database';

const createdPlanIds: string[] = [];
let baseline: E2eDatabaseBaseline | undefined;
const PLANNER = { email: 'planner@probedesk.local', password: 'PlannerDemo!2026' };
const OPERATOR = { email: 'operator@probedesk.local', password: 'OperatorDemo!2026' };
const PLAN_NAME = `Version consistency ${Date.now()} ${crypto.randomUUID().slice(0, 8)}`;

test.beforeAll(async () => {
  baseline = await prepareE2eDatabase();
});

test.beforeEach(() => {
  assertE2eSerialExecution(test.info().config.workers);
});

test.afterAll(async () => {
  if (!baseline) return;

  await cleanupE2eData({
    planIds: createdPlanIds,
    planNames: [PLAN_NAME],
    sessionBaseline: baseline.sessionIds,
    userEmails: [PLANNER.email, OPERATOR.email],
  });
});

const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:3100';
const ORIGIN = { Origin: API };

interface StartedRun {
  readonly runId: string;
}

async function login(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<void> {
  const response = await request.post(`${API}/api/auth/login`, {
    headers: ORIGIN,
    data: { email, password },
  });
  expect(response.status()).toBe(200);
}

async function newRequestContext(
  playwright: Playwright,
  email: string,
  password: string,
): Promise<APIRequestContext> {
  const context = await playwright.request.newContext({ baseURL: API });
  await login(context, email, password);
  return context;
}

async function mutationHeaders(
  request: APIRequestContext,
): Promise<Record<string, string>> {
  const state = await request.storageState();
  const xsrf = state.cookies.find((cookie) => cookie.name === 'XSRF-TOKEN')?.value;
  return { ...ORIGIN, ...(xsrf ? { 'X-XSRF-TOKEN': xsrf } : {}) };
}

async function startRun(
  request: APIRequestContext,
  body: Record<string, unknown>,
): Promise<string> {
  const response = await request.post(`${API}/api/runs`, {
    headers: { ...(await mutationHeaders(request)), 'Idempotency-Key': `p6-${crypto.randomUUID()}` },
    data: body,
  });
  expect(response.status()).toBe(202);
  return ((await response.json()) as StartedRun).runId;
}

async function waitForTerminal(
  request: APIRequestContext,
  runId: string,
): Promise<any> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const response = await request.get(`${API}/api/runs/${runId}`);
    const snapshot = await response.json();
    if (snapshot.status !== 'RUNNING') return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Run ${runId} did not finish`);
}

async function loginUi(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/overview(?:\?.*)?$/);
}

test('compares a failed v1 run with v2 after the tolerance changed to 0.65 A', async ({
  page,
  playwright,
}) => {
  const planner = await newRequestContext(
    playwright,
    PLANNER.email,
    PLANNER.password,
  );
  const operator = await newRequestContext(
    playwright,
    OPERATOR.email,
    OPERATOR.password,
  );

  const profiles = await (await planner.get(`${API}/api/device-profiles`)).json();
  const profileId = profiles[0].id;

  const created = await planner.post(`${API}/api/plans`, {
    headers: await mutationHeaders(planner),
    data: { name: PLAN_NAME, profileId },
  });
  expect(created.status()).toBe(201);
  const planId = (await created.json()).id as string;
  createdPlanIds.push(planId);

  const steps = [
    { logicalStepId: '', name: 'Output Voltage', unit: 'V', minimum: '4.75', maximum: '5.25', sampleCount: 3, intervalMs: 100 },
    { logicalStepId: '', name: 'Current Draw', unit: 'A', minimum: '0.45', maximum: '0.55', sampleCount: 3, intervalMs: 100 },
    { logicalStepId: '', name: 'Case Temperature', unit: '°C', minimum: '20', maximum: '60', sampleCount: 3, intervalMs: 100 },
  ];

  const saved = await planner.put(`${API}/api/plans/${planId}/draft`, {
    headers: await mutationHeaders(planner),
    data: { name: PLAN_NAME, expectedRevision: 1, steps },
  });
  expect(saved.status()).toBe(200);
  const savedDraft = await saved.json();
  const currentDraw = savedDraft.steps.find((step: any) => step.name === 'Current Draw');

  const publishedV1 = await planner.post(`${API}/api/plans/${planId}/draft/publish`, {
    headers: await mutationHeaders(planner),
    data: { expectedRevision: 2 },
  });
  expect(publishedV1.status()).toBe(201);
  const v1 = await publishedV1.json();

  const v1RunId = await startRun(operator, {
    planVersionId: v1.id,
    scenario: 'FORCED_FAILURE',
    seed: 15,
    failureStepId: currentDraw.logicalStepId,
  });
  const v1Run = await waitForTerminal(operator, v1RunId);
  expect(v1Run.outcome).toBe('FAILED');
  expect(v1Run.steps.find((step: any) => step.name === 'Current Draw').measurements[1].value).toBe('0.600000');

  // Publish v2 with a 0.65 A tolerance and start a second run.
  const draftV2 = await planner.post(`${API}/api/plans/${planId}/drafts`, {
    headers: await mutationHeaders(planner),
  });
  expect(draftV2.status()).toBe(201);
  const draft = await draftV2.json();
  const updated = draft.steps.map((step: any) => {
    if (step.name === 'Current Draw') {
      return {
        logicalStepId: step.logicalStepId,
        name: step.name,
        unit: step.unit,
        minimum: step.minimum,
        maximum: '0.65',
        sampleCount: 4,
        intervalMs: 200,
      };
    }
    if (step.name === 'Case Temperature') {
      // Same physical range expressed in a different unit: no numeric delta is allowed.
      return {
        logicalStepId: step.logicalStepId,
        name: step.name,
        unit: '°F',
        minimum: '68',
        maximum: '140',
        sampleCount: step.sampleCount,
        intervalMs: step.intervalMs,
      };
    }
    return {
      logicalStepId: step.logicalStepId,
      name: step.name,
      unit: step.unit,
      minimum: step.minimum,
      maximum: step.maximum,
      sampleCount: step.sampleCount,
      intervalMs: step.intervalMs,
    };
  });
  const savedV2 = await planner.put(`${API}/api/plans/${planId}/draft`, {
    headers: await mutationHeaders(planner),
    data: { name: PLAN_NAME, expectedRevision: 1, steps: updated },
  });
  expect(savedV2.status()).toBe(200);
  const publishedV2 = await planner.post(`${API}/api/plans/${planId}/draft/publish`, {
    headers: await mutationHeaders(planner),
    data: { expectedRevision: 2 },
  });
  expect(publishedV2.status()).toBe(201);
  const v2 = await publishedV2.json();

  const v2RunId = await startRun(operator, {
    planVersionId: v2.id,
    scenario: 'FORCED_FAILURE',
    seed: 15,
    failureStepId: currentDraw.logicalStepId,
  });
  const v2Run = await waitForTerminal(operator, v2RunId);
  expect(v2Run.outcome).toBe('FAILED');

  // The old run keeps its 0.55 A rule and Failed verdict.
  const oldRun = await (await operator.get(`${API}/api/runs/${v1RunId}`)).json();
  expect(oldRun.outcome).toBe('FAILED');
  expect(oldRun.steps.find((step: any) => step.name === 'Current Draw').maximum).toBe('0.550000');

  const comparison = await (
    await operator.get(`${API}/api/comparisons?leftRunId=${v1RunId}&rightRunId=${v2RunId}`)
  ).json();
  const changed = comparison.matchedSteps.find(
    (step: any) => step.left.name === 'Current Draw',
  );
  expect(changed.changedFields).toContainEqual({
    field: 'maximum',
    left: '0.550000',
    right: '0.650000',
  });
  expect(changed.changedFields).toContainEqual({
    field: 'sampleCount',
    left: 3,
    right: 4,
  });
  expect(changed.numericComparison.comparable).toBe(true);
  const unitChanged = comparison.matchedSteps.find(
    (step: any) => step.left.name === 'Case Temperature',
  );
  expect(unitChanged.numericComparison).toMatchObject({
    comparable: false,
    reason: 'UNIT_MISMATCH',
    statistics: null,
  });

  // Real browser: rule diffs, series toggles, tooltip, zoom/reset.
  await page.addInitScript(() => {
    (window as any).__probedeskChartDebug = true;
  });
  await loginUi(page, OPERATOR.email, OPERATOR.password);
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  await page.goto(`/compare?leftRunId=${v1RunId}&rightRunId=${v2RunId}`);
  await page
    .locator('.step-jump-button', { hasText: 'Current Draw' })
    .first()
    .click();
  await expect(
    page.locator('app-comparison-step-card:not([hidden]) .step-header h3'),
  ).toHaveText(/Current Draw/);
  await expect(page.getByText('Changed rule fields', { exact: true }).first()).toBeVisible();
  await page
    .locator('app-comparison-step-card:not([hidden]) .rule-section > summary')
    .click();
  await expect(page.getByText('0.550000', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('0.650000', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Failed').first()).toBeVisible();
  // P6-05: unit change => separate panels and no numeric delta.
  await page
    .locator('.step-jump-button', { hasText: 'Case Temperature' })
    .first()
    .click();
  await expect(
    page.locator('app-comparison-step-card:not([hidden]) .step-header h3'),
  ).toHaveText(/Case Temperature/);
  await expect(page.getByText('Unit changed').first()).toBeVisible();
  await page
    .locator('app-comparison-step-card:not([hidden]) .rule-section > summary')
    .click();
  await expect(page.getByText('Not calculated — units differ').first()).toBeVisible();
  await expect(page.getByText('°F').first()).toBeVisible();
  const unitCard = page
    .locator('app-comparison-step-card:not([hidden])')
    .first();
  await expect(unitCard.locator('.separate-panels canvas')).toHaveCount(2);
  await page
    .locator('.step-jump-button', { hasText: 'Current Draw' })
    .first()
    .click();
  await expect(
    page.locator('app-comparison-step-card:not([hidden]) .step-header h3'),
  ).toHaveText(/Current Draw/);

  const leftToggle = page
    .locator('app-comparison-step-card:not([hidden]) .series-toggle--left')
    .first();
  await expect(leftToggle).toHaveAttribute('aria-pressed', 'true');
  const rightMetaBefore = await page
    .locator('app-comparison-step-card:not([hidden]) .series-toggle--right .series-meta')
    .first()
    .textContent();
  await leftToggle.click();
  await expect(leftToggle).toHaveAttribute('aria-pressed', 'false');
  expect(
    await page
      .locator('app-comparison-step-card:not([hidden]) .series-toggle--right .series-meta')
      .first()
      .textContent(),
  ).toBe(rightMetaBefore);
  await leftToggle.click();
  await expect(leftToggle).toHaveAttribute('aria-pressed', 'true');

  await page.evaluate(() => {
    const entries = (window as any).__probedeskComparisonCharts ?? [];
    const entry = entries.find((candidate: any) => candidate.leftStepName === 'Current Draw');
    entry?.canvas.scrollIntoView({ block: 'center', inline: 'center' });
  });
  await page.waitForTimeout(200);
  const chartInfo = await page.evaluate(() => {
    const entries = (window as any).__probedeskComparisonCharts ?? [];
    const entry = entries.find((candidate: any) => candidate.leftStepName === 'Current Draw');
    if (!entry) return null;
    const point = entry.debug.pointPixel(1);
    const rect = entry.canvas.getBoundingClientRect();
    return {
      point,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      tooltip: entry.debug.snapshot().tooltip,
    };
  });
  expect(chartInfo).not.toBeNull();
  expect(chartInfo!.point).not.toBeNull();

  const targetX = chartInfo!.rect.x + chartInfo!.point!.x;
  const targetY = chartInfo!.rect.y + chartInfo!.point!.y;
  await page.mouse.move(targetX - 4, targetY - 4);
  await page.mouse.move(targetX, targetY);
  await page.waitForTimeout(200);
  const tooltip = await page.evaluate(() => {
    const entries = (window as any).__probedeskComparisonCharts ?? [];
    const entry = entries.find((candidate: any) => candidate.leftStepName === 'Current Draw');
    return entry?.debug.snapshot().tooltip ?? null;
  });
  expect(tooltip).not.toBeNull();
  const tooltipText = `${tooltip.title.join(' ')} ${tooltip.body.join(' ')}`;
  expect(tooltipText).toContain('Current Draw');
  expect(tooltipText).toContain('0.600000');

  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(300);
  const zoomed = await page.evaluate(() => {
    const entries = (window as any).__probedeskComparisonCharts ?? [];
    const entry = entries.find((candidate: any) => candidate.leftStepName === 'Current Draw');
    return entry.debug.snapshot().zoomed;
  });
  expect(zoomed).toBe(true);
  await page
    .locator('.comparison-chart', { hasText: 'Comparison chart — Current Draw' })
    .first()
    .getByRole('button', { name: 'Reset view' })
    .click();
  await page.waitForTimeout(300);
  const reset = await page.evaluate(() => {
    const entries = (window as any).__probedeskComparisonCharts ?? [];
    const entry = entries.find((candidate: any) => candidate.leftStepName === 'Current Draw');
    return entry.debug.snapshot().zoomed;
  });
  expect(reset).toBe(false);

  await page.screenshot({
    path: 'test-results/phase-6-compare-playwright.png',
    fullPage: false,
  });
  expect(consoleErrors).toEqual([]);

  await planner.dispose();
  await operator.dispose();
});
