import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import {
  assertE2eSerialExecution,
  cleanupE2eData,
  prepareE2eDatabase,
  type E2eDatabaseBaseline,
} from './support/database';

/**
 * P7-01 — the main demo flow through the real Angular application.
 *
 * Everything below is created and executed through the UI:
 * - Planner logs in, creates a three-step plan, reorders with the keyboard,
 *   saves the draft, reloads it, and publishes v1.
 * - Operator starts a FORCED_FAILURE run on Current Draw, watches the live
 *   screen, inspects the failure sample in Run Details, then starts a NORMAL
 *   run, compares both v1 runs through Run History, and checks the v1/v2 rule
 *   diff after the planner publishes a 0.65 A maximum.
 *
 * The only direct URL navigations are documented deep links for Live Run and
 * Compare Runs. Start Run currently lands on Run Details, which has no link to
 * the live screen; opening `/runs/:runId/live` is the product's documented
 * route for following a run. No run result is seeded or written by the test.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4200';
const PLANNER = {
  email: 'planner@probedesk.local',
  password: 'PlannerDemo!2026',
};
const OPERATOR = {
  email: 'operator@probedesk.local',
  password: 'OperatorDemo!2026',
};

const PLAN_NAME = `E2E Main Demo ${Date.now()} ${crypto.randomUUID().slice(0, 8)}`;
const PROFILE_LABEL = 'DC Power Module (DC_POWER_MODULE)';
const SEED = '42';

const SAMPLE_COUNT = 8;
const INTERVAL_MS = 300;
const TOTAL_SAMPLES = SAMPLE_COUNT * 3;
/** docs/simulation.md: the forced violation is at floor((sampleCount - 1) / 2). */
const FAILURE_INDEX = Math.floor((SAMPLE_COUNT - 1) / 2);
const FAILURE_VALUE = '0.600000';

const STEPS = [
  {
    name: 'Output Voltage',
    unit: 'V',
    minimum: '4.75',
    maximum: '5.25',
  },
  {
    name: 'Current Draw',
    unit: 'A',
    minimum: '0.45',
    maximum: '0.55',
  },
  {
    name: 'Case Temperature',
    unit: '°C',
    minimum: '20',
    maximum: '60',
  },
] as const;

interface ChartDebugSnapshot {
  readonly sampleCount: number;
  readonly tooltip: {
    readonly title: readonly string[];
    readonly body: readonly string[];
  } | null;
}

interface ChartDebugEntry {
  readonly canvas: HTMLCanvasElement;
  readonly stepName: string;
  readonly debug: {
    snapshot(): ChartDebugSnapshot;
    pointPixel(
      sampleIndex: number,
    ): { readonly x: number; readonly y: number } | null;
  };
}

type ChartDebugWindow = Window & { __probedeskCharts?: ChartDebugEntry[] };

const createdPlanIds: string[] = [];
let baseline: E2eDatabaseBaseline | undefined;
let plannerContext: BrowserContext | undefined;
let operatorContext: BrowserContext | undefined;
const browserErrors: string[] = [];

async function login(
  page: Page,
  role: 'planner' | 'operator',
  user: { email: string; password: string },
): Promise<void> {
  await page.goto('/login');
  await page.locator('#email').fill(user.email);
  await page.locator('#password').fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/plans$/);
  await expect(
    page.getByRole('heading', { name: 'Test Plans', level: 1 }),
  ).toBeVisible();

  // The signed-out /login probe intentionally receives 401 from /api/auth/me;
  // only listen after login so that expected probe is not reported as an error.
  page.on('console', (message) => {
    if (message.type() === 'error') {
      browserErrors.push(`${role}: ${message.text()}`);
    }
  });
}

function planRow(page: Page): Locator {
  return page.locator('table tbody tr').filter({ hasText: PLAN_NAME }).first();
}

function stepCards(page: Page): Locator {
  return page.locator('section.step-card');
}

function stepCard(page: Page, name: string): Locator {
  return stepCards(page).filter({ hasText: name }).first();
}

function historyRow(page: Page, runId: string): Locator {
  return page
    .locator('#run-history-table tbody tr')
    .filter({ has: page.locator(`a[href="/runs/${runId}"]`) });
}

function comparisonCount(page: Page, label: string): Locator {
  return page
    .locator('.count-line div')
    .filter({ hasText: label })
    .locator('dd');
}

function comparisonStepCard(page: Page, name: string): Locator {
  return page
    .locator('app-comparison-step-card')
    .filter({ hasText: name })
    .first();
}

async function createPlan(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'New plan' }).click();
  await expect(page.getByRole('heading', { name: 'New plan' })).toBeVisible();
  await page.locator('#create-plan-name').fill(PLAN_NAME);
  await page
    .locator('#create-plan-profile')
    .selectOption({ label: PROFILE_LABEL });
  await page.getByRole('button', { name: 'Create plan' }).click();

  await expect(page).toHaveURL(/\/plans\/[0-9a-f-]+\/edit$/);
  await expect(page.locator('#plan-name')).toHaveValue(PLAN_NAME);
  const planId = new URL(page.url()).pathname.split('/')[2];
  expect(planId).toMatch(/^[0-9a-f-]{36}$/);
  createdPlanIds.push(planId);
  return planId;
}

async function addStep(
  page: Page,
  step: (typeof STEPS)[number],
  expectedCount: number,
): Promise<void> {
  await page.locator('#add-step-button').click();
  await expect(stepCards(page)).toHaveCount(expectedCount);
  const card = stepCards(page).nth(expectedCount - 1);
  await card.locator('input[formControlName="name"]').fill(step.name);
  await card.locator('input[formControlName="unit"]').fill(step.unit);
  await card.locator('input[formControlName="minimum"]').fill(step.minimum);
  await card.locator('input[formControlName="maximum"]').fill(step.maximum);
  await card
    .locator('input[formControlName="sampleCount"]')
    .fill(String(SAMPLE_COUNT));
  await card
    .locator('input[formControlName="intervalMs"]')
    .fill(String(INTERVAL_MS));
}

/** The API stores decimal strings with six places; the form keeps typed input. */
function canonicalDecimal(value: string): string {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (match === null) {
    return value.trim();
  }
  return `${match[1]}.${(match[2] ?? '').padEnd(6, '0').slice(0, 6)}`;
}

async function expectDraftOrderAndValues(page: Page): Promise<void> {
  await expect(stepCards(page)).toHaveCount(3);
  for (const [index, step] of STEPS.entries()) {
    const card = stepCards(page).nth(index);
    await expect(card.locator('input[formControlName="name"]')).toHaveValue(
      step.name,
    );
    await expect(card.locator('input[formControlName="unit"]')).toHaveValue(
      step.unit,
    );
    await expect
      .poll(async () =>
        canonicalDecimal(
          await card.locator('input[formControlName="minimum"]').inputValue(),
        ),
      )
      .toBe(canonicalDecimal(step.minimum));
    await expect
      .poll(async () =>
        canonicalDecimal(
          await card.locator('input[formControlName="maximum"]').inputValue(),
        ),
      )
      .toBe(canonicalDecimal(step.maximum));
    await expect(
      card.locator('input[formControlName="sampleCount"]'),
    ).toHaveValue(String(SAMPLE_COUNT));
    await expect(
      card.locator('input[formControlName="intervalMs"]'),
    ).toHaveValue(String(INTERVAL_MS));
  }
}

async function saveDraft(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.locator('.save-state')).toHaveText('All changes saved');
  await expect(page.locator('#publish-button')).toBeEnabled();
}

async function publish(page: Page, versionNumber: number): Promise<void> {
  await page.locator('#publish-button').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Publish version' }).click();
  await expect(page.locator('#publish-success-heading')).toHaveText(
    `Version ${versionNumber} published`,
  );
}

async function openPublishedVersion(
  page: Page,
  versionNumber: number,
): Promise<void> {
  await page
    .locator('nav#primary-navigation')
    .getByRole('link', { name: /Test Plans/ })
    .click();
  await expect(page).toHaveURL(/\/plans$/);
  await expect(planRow(page)).toBeVisible();
  await planRow(page)
    .getByRole('link', { name: `Version ${versionNumber}` })
    .click();
  await expect(page).toHaveURL(/\/plans\/[0-9a-f-]+\/versions\/[0-9a-f-]+$/);
  await expect(page.locator('#version-title')).toHaveText(PLAN_NAME);
  await expect(page.locator('.version-badge')).toHaveText(
    `Version ${versionNumber}`,
  );
}

async function startRun(
  page: Page,
  scenario: 'NORMAL' | 'FORCED_FAILURE',
  failureStepName?: string,
): Promise<string> {
  await page.locator('#start-run-link').click();
  await expect(page).toHaveURL(/\/runs\/new\?versionId=/);
  await expect(
    page.getByRole('heading', { name: 'Start Run', level: 1 }),
  ).toBeVisible();

  await page.locator('#start-run-scenario').selectOption(scenario);
  await page.locator('#start-run-seed').fill(SEED);

  if (scenario === 'FORCED_FAILURE') {
    const failureStep = page.locator('#start-run-failure-step');
    await expect(failureStep).toBeVisible();
    const optionValue = await failureStep
      .locator('option')
      .filter({ hasText: failureStepName ?? '' })
      .first()
      .getAttribute('value');
    expect(optionValue).toBeTruthy();
    await failureStep.selectOption(optionValue!);
  }

  await expect(page.locator('#start-run-submit')).toBeEnabled();
  await page.locator('#start-run-submit').click();
  // A fresh start is RUNNING and must land on the live screen without any
  // test-only deep-link navigation.
  await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}\/live$/);
  const runId = new URL(page.url()).pathname.split('/')[2];
  expect(runId).toMatch(/^[0-9a-f-]{36}$/);
  return runId!;
}

async function openLive(page: Page, runId: string): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`/runs/${runId}/live$`));
  await expect(page.locator('#live-run-summary-heading')).toHaveText(PLAN_NAME);
}

async function expectTerminalRun(
  page: Page,
  runId: string,
  outcome: 'Passed' | 'Failed',
): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`/runs/${runId}/live$`));
  await expect(page.locator('#live-run-summary .status-label')).toHaveText(
    outcome,
    {
      timeout: 30_000,
    },
  );
}

async function startV2NormalRun(page: Page): Promise<string> {
  await openPublishedVersion(page, 2);
  const startPage = page
    .locator('.steps-card table tbody tr')
    .filter({ hasText: 'Current Draw' })
    .first();
  await expect(startPage.locator('td').nth(4)).toHaveText('0.650000');
  const runId = await startRun(page, 'NORMAL');
  await openLive(page, runId);
  await expectTerminalRun(page, runId, 'Passed');
  return runId;
}

test.beforeAll(async () => {
  baseline = await prepareE2eDatabase();
});

test.beforeEach(() => {
  assertE2eSerialExecution(test.info().config.workers);
});

test.afterAll(async () => {
  await plannerContext?.close();
  await operatorContext?.close();
  if (!baseline) return;

  await cleanupE2eData({
    planIds: createdPlanIds,
    planNames: [PLAN_NAME],
    sessionBaseline: baseline.sessionIds,
    userEmails: [PLANNER.email, OPERATOR.email],
  });
});

test('runs the main demo flow through plans, live execution, history, compare and v2', async ({
  browser,
}) => {
  test.setTimeout(180_000);

  plannerContext = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 1000 },
  });
  operatorContext = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 1000 },
  });
  // Enable the opt-in chart registry used by P5-06 so the real canvas can prove
  // that the failed sample is plotted, not merely listed in a table.
  await operatorContext.addInitScript(() => {
    (window as ChartDebugWindow).__probedeskChartDebug = true;
  });

  const plannerPage = await plannerContext.newPage();
  const operatorPage = await operatorContext.newPage();
  for (const [role, page] of [
    ['planner', plannerPage],
    ['operator', operatorPage],
  ] as const) {
    page.on('pageerror', (error) => {
      browserErrors.push(`${role}: ${error.message}`);
    });
  }

  // 1. Planner: login, create the plan, add steps, reorder with the keyboard.
  await login(plannerPage, 'planner', PLANNER);
  const planId = await createPlan(plannerPage);

  for (const [index, step] of STEPS.entries()) {
    await addStep(plannerPage, step, index + 1);
  }
  await expectDraftOrderAndValues(plannerPage);

  const currentDrawBeforeMove = stepCard(plannerPage, 'Current Draw');
  await currentDrawBeforeMove
    .getByRole('button', { name: 'Move step 2 down' })
    .focus();
  await plannerPage.keyboard.press('Enter');
  await expect(stepCards(plannerPage).nth(2)).toContainText('Current Draw');
  await expect(
    stepCards(plannerPage).nth(2).locator('h3.step-heading'),
  ).toHaveText('Step 3');

  const currentDrawAfterMove = stepCard(plannerPage, 'Current Draw');
  await currentDrawAfterMove
    .getByRole('button', { name: 'Move step 3 up' })
    .focus();
  await plannerPage.keyboard.press('Space');
  await expect(stepCards(plannerPage).nth(1)).toContainText('Current Draw');
  await expect(
    stepCards(plannerPage).nth(1).locator('h3.step-heading'),
  ).toHaveText('Step 2');
  await expectDraftOrderAndValues(plannerPage);

  // Save and reload: the visible order and all fields have to survive.
  await saveDraft(plannerPage);
  await plannerPage.reload();
  await expect(plannerPage.locator('#plan-name')).toHaveValue(PLAN_NAME);
  await expectDraftOrderAndValues(plannerPage);

  // Publish v1, read the immutable published screen, then return to the plan.
  await plannerPage.locator('#publish-button').click();
  await expect(plannerPage.getByRole('dialog')).toBeVisible();
  await plannerPage.getByRole('button', { name: 'Publish version' }).click();
  await expect(plannerPage.locator('#publish-success-heading')).toHaveText(
    'Version 1 published',
  );
  await plannerPage
    .locator('#publish-success')
    .getByRole('link', { name: 'View version 1' })
    .click();
  await expect(plannerPage).toHaveURL(
    new RegExp(`/plans/${planId}/versions/[0-9a-f-]+$`),
  );
  await expect(plannerPage.locator('#version-title')).toHaveText(PLAN_NAME);
  await expect(plannerPage.locator('.version-state')).toHaveText(
    'Published version',
  );
  await expect(plannerPage.locator('.version-badge')).toHaveText('Version 1');
  await expect(plannerPage.locator('.steps-card tbody tr')).toHaveCount(3);

  // 2. Operator: start a FORCED_FAILURE run on Current Draw.
  await login(operatorPage, 'operator', OPERATOR);
  await openPublishedVersion(operatorPage, 1);
  await expect(operatorPage.locator('.draft-bar')).toHaveCount(0);

  const failedRunId = await startRun(
    operatorPage,
    'FORCED_FAILURE',
    'Current Draw',
  );
  await openLive(operatorPage, failedRunId);

  // Live progress must be visible before the terminal FAILED state.
  const liveStatus = operatorPage.locator('#live-run-summary .status-label');
  await expect(liveStatus).toHaveText('Running', { timeout: 10_000 });
  const progressLabel = operatorPage.locator('.progress-label');
  await expect(progressLabel).toContainText(
    `of ${TOTAL_SAMPLES} samples recorded`,
  );
  const initialProgress = (await progressLabel.textContent())?.trim() ?? '';
  await expect
    .poll(async () => (await progressLabel.textContent())?.trim() ?? '')
    .not.toBe(initialProgress);
  await operatorPage.screenshot({
    path: 'docs/evidence/phase-7-live-running.png',
  });

  await expect(liveStatus).toHaveText('Failed', { timeout: 30_000 });
  await expect(operatorPage.locator('.terminal-summary')).toContainText(
    'The run completed and at least one step failed.',
  );

  const liveSteps = operatorPage.locator('ol.step-list > li.step-row');
  const liveCurrentDraw = liveSteps.filter({ hasText: 'Current Draw' }).first();
  await expect(liveCurrentDraw.locator('[data-first-violation]')).toContainText(
    `First failing sample: ${FAILURE_INDEX}`,
  );
  await expect(liveCurrentDraw.locator('.step-status')).toHaveText('Completed');
  await expect(liveCurrentDraw.locator('.step-outcome')).toHaveText('Failed');
  await expect(liveCurrentDraw.locator('.step-counters')).toContainText(
    `${SAMPLE_COUNT} of ${SAMPLE_COUNT}`,
  );

  // The third step continues after the failure and completes.
  const liveTemperature = liveSteps
    .filter({ hasText: 'Case Temperature' })
    .first();
  await expect(liveTemperature.locator('.step-status')).toHaveText('Completed');
  await expect(liveTemperature.locator('.step-outcome')).toHaveText('Passed');

  const liveCurrentDrawChart = operatorPage
    .locator('article.chart-step')
    .filter({ hasText: 'Current Draw' })
    .first();
  await expect(
    liveCurrentDrawChart.locator('.step-measurements tbody tr'),
  ).toHaveCount(SAMPLE_COUNT);
  await expect(
    liveCurrentDrawChart
      .locator('.step-measurements tbody tr')
      .filter({ hasText: FAILURE_VALUE }),
  ).toContainText('Outside tolerance');

  await liveCurrentDraw.scrollIntoViewIfNeeded();
  await operatorPage.screenshot({
    path: 'docs/evidence/phase-7-live-failed.png',
  });

  // Run Details: the stored failure and the real chart both point at the sample.
  await operatorPage.locator('#live-run-details-link').click();
  await expect(operatorPage).toHaveURL(new RegExp(`/runs/${failedRunId}$`));
  await expect(operatorPage.locator('#run-summary-heading')).toHaveText(
    PLAN_NAME,
  );
  await expect(
    operatorPage.locator('#run-snapshot-region .status-label'),
  ).toHaveText('Failed');
  await expect(operatorPage.locator('#first-failure-summary')).toContainText(
    'Step 2: Current Draw',
  );
  await expect(operatorPage.locator('#first-failure-summary')).toContainText(
    `Sample index ${FAILURE_INDEX}`,
  );
  await expect(operatorPage.locator('#first-failure-summary')).toContainText(
    `${FAILURE_VALUE} A`,
  );

  await operatorPage
    .getByRole('button', { name: 'Show sample in measurements' })
    .click();
  const selectedRow = operatorPage.locator('tr[aria-current="true"]');
  await expect(selectedRow).toHaveCount(1);
  await expect(selectedRow).toContainText('Outside tolerance');
  await expect(selectedRow.locator('td').nth(1)).toHaveText(FAILURE_VALUE);

  const chartInfo = await operatorPage.evaluate((sampleIndex) => {
    const entries = (window as ChartDebugWindow).__probedeskCharts ?? [];
    const entry = entries.find(
      (candidate) => candidate.stepName === 'Current Draw',
    );
    if (!entry) {
      return null;
    }
    entry.canvas.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = entry.canvas.getBoundingClientRect();
    const point = entry.debug.pointPixel(sampleIndex);
    return {
      sampleCount: entry.debug.snapshot().sampleCount,
      point:
        point === null ? null : { x: rect.x + point.x, y: rect.y + point.y },
    };
  }, FAILURE_INDEX);
  expect(chartInfo).not.toBeNull();
  expect(chartInfo!.sampleCount).toBe(SAMPLE_COUNT);
  expect(chartInfo!.point).not.toBeNull();

  await operatorPage.mouse.move(
    chartInfo!.point!.x - 3,
    chartInfo!.point!.y - 3,
  );
  await operatorPage.mouse.move(chartInfo!.point!.x, chartInfo!.point!.y);
  await expect
    .poll(async () =>
      operatorPage.evaluate(() => {
        const entries = (window as ChartDebugWindow).__probedeskCharts ?? [];
        const entry = entries.find(
          (candidate) => candidate.stepName === 'Current Draw',
        );
        const tooltip = entry?.debug.snapshot().tooltip ?? null;
        return tooltip === null
          ? ''
          : [...tooltip.title, ...tooltip.body].join(' ');
      }),
    )
    .toContain(FAILURE_VALUE);
  await operatorPage.screenshot({
    path: 'docs/evidence/phase-7-failed-details.png',
  });

  // 3. A new NORMAL run of the same v1 reaches PASSED.
  await openPublishedVersion(operatorPage, 1);
  const passedRunId = await startRun(operatorPage, 'NORMAL');
  await openLive(operatorPage, passedRunId);
  await expectTerminalRun(operatorPage, passedRunId, 'Passed');
  await expect(operatorPage.locator('.terminal-summary')).toContainText(
    'The run completed and every step passed.',
  );
  await expect(
    operatorPage.locator('ol.step-list > li.step-row .step-outcome'),
  ).toHaveText(['Passed', 'Passed', 'Passed']);

  // Both terminal runs are visible in history. Compare them through the UI
  // selection rather than a hand-built deep link.
  await operatorPage
    .locator('nav#primary-navigation')
    .getByRole('link', { name: /Run History/ })
    .click();
  await expect(operatorPage).toHaveURL(/\/runs$/);
  await operatorPage
    .locator('#history-plan')
    .selectOption({ label: PLAN_NAME });
  await expect(operatorPage).toHaveURL(
    new RegExp(`/runs\\?.*planId=${planId}`),
  );
  await expect(historyRow(operatorPage, failedRunId)).toBeVisible();
  await expect(historyRow(operatorPage, passedRunId)).toBeVisible();
  await expect(
    historyRow(operatorPage, failedRunId).locator('.status-label'),
  ).toHaveText('Failed');
  await expect(
    historyRow(operatorPage, passedRunId).locator('.status-label'),
  ).toHaveText('Passed');
  await expect(historyRow(operatorPage, failedRunId)).toContainText(
    `Sample index ${FAILURE_INDEX}`,
  );
  await expect(historyRow(operatorPage, passedRunId)).not.toContainText(
    'First failure',
  );

  await operatorPage.locator(`#compare-${failedRunId}`).check();
  await operatorPage.locator(`#compare-${passedRunId}`).check();
  await expect(operatorPage.locator('#compare-selected-runs')).toBeEnabled();
  await operatorPage.locator('#compare-selected-runs').click();
  await expect(operatorPage).toHaveURL(/\/compare\?/);
  const selectionParams = new URL(operatorPage.url()).searchParams;
  expect(selectionParams.get('leftRunId')).toBe(failedRunId);
  expect(selectionParams.get('rightRunId')).toBe(passedRunId);

  await expect(
    operatorPage.locator('#comparison-summary-heading'),
  ).toBeVisible();
  const leftCard = operatorPage.locator('.run-card[data-side="left"]');
  const rightCard = operatorPage.locator('.run-card[data-side="right"]');
  await expect(leftCard).toContainText('Version 1');
  await expect(rightCard).toContainText('Version 1');
  await expect(leftCard.locator('.status-label')).toHaveText('Failed');
  await expect(rightCard.locator('.status-label')).toHaveText('Passed');
  await operatorPage.locator('.summary-notes > summary').click();
  await expect(
    operatorPage.getByText('Both runs used the same plan version'),
  ).toBeVisible();
  await expect(comparisonCount(operatorPage, 'Shared steps')).toHaveText('3');
  await expect(comparisonCount(operatorPage, 'Only in right run')).toHaveText(
    '0',
  );
  await expect(comparisonCount(operatorPage, 'Only in left run')).toHaveText(
    '0',
  );
  await expect(comparisonCount(operatorPage, 'Changed rule fields')).toHaveText(
    '0',
  );

  const v1CurrentDraw = comparisonStepCard(operatorPage, 'Current Draw');
  await expect(v1CurrentDraw).toContainText('No rule field changed');
  const v1Maximum = v1CurrentDraw.locator('[data-field="maximum"]');
  await expect(v1Maximum.locator('td .mono')).toHaveText([
    '0.550000',
    '0.550000',
  ]);
  // Rule fields never receive an invented delta column value.
  await expect(v1Maximum.locator('td').nth(2)).toHaveText('—');
  const v1Outcome = v1CurrentDraw.locator('tr[data-evaluation="outcome"]');
  await expect(v1Outcome.locator('td').nth(0)).toHaveText('Failed');
  await expect(v1Outcome.locator('td').nth(1)).toHaveText('Passed');
  const v1OutOfTolerance = v1CurrentDraw.locator(
    'tr[data-evaluation="out-of-tolerance"]',
  );
  await expect(v1OutOfTolerance.locator('td').nth(0)).toHaveText('1');
  await expect(v1OutOfTolerance.locator('td').nth(1)).toHaveText('0');
  const v1FirstFailure = v1CurrentDraw.locator(
    'tr[data-evaluation="first-failure"]',
  );
  await expect(v1FirstFailure.locator('td').nth(0)).toHaveText(
    `Sample ${FAILURE_INDEX}`,
  );
  await expect(v1FirstFailure.locator('td').nth(1)).toHaveText('None recorded');

  await operatorPage.screenshot({
    path: 'docs/evidence/phase-7-compare-v1-runs.png',
  });

  // 5. Planner starts a v2 draft from v1, changes only Current Draw's maximum,
  // and publishes it. Step identities stay stable.
  await plannerPage.getByRole('link', { name: 'Back to plan' }).click();
  await expect(plannerPage).toHaveURL(new RegExp(`/plans/${planId}/edit$`));
  await expect(plannerPage.locator('#no-draft-heading')).toBeVisible();
  await plannerPage.locator('#start-new-draft-button').click();
  await expect(plannerPage.locator('#plan-name')).toBeVisible();

  const draftCurrentDraw = stepCard(plannerPage, 'Current Draw');
  await expect(
    draftCurrentDraw.locator('input[formControlName="maximum"]'),
  ).toHaveValue('0.550000');
  await draftCurrentDraw
    .locator('input[formControlName="maximum"]')
    .fill('0.65');
  await saveDraft(plannerPage);
  await publish(plannerPage, 2);
  await plannerPage
    .locator('#publish-success')
    .getByRole('link', { name: 'View version 2' })
    .click();
  await expect(plannerPage).toHaveURL(
    new RegExp(`/plans/${planId}/versions/[0-9a-f-]+$`),
  );
  await expect(plannerPage.locator('.version-badge')).toHaveText('Version 2');
  const v2CurrentDraw = plannerPage
    .locator('.steps-card tbody tr')
    .filter({ hasText: 'Current Draw' })
    .first();
  await expect(v2CurrentDraw.locator('td').nth(4)).toHaveText('0.650000');

  // The old v1 FAILED run keeps its stored 0.55 A rule and Failed verdict.
  await operatorPage.goto(`/runs/${failedRunId}`);
  await expect(
    operatorPage.locator('#run-snapshot-region .status-label'),
  ).toHaveText('Failed');
  await expect(operatorPage.locator('.run-meta-line')).toContainText(
    'Version 1',
  );
  const oldCurrentDraw = operatorPage
    .locator('.step-card:not([hidden])')
    .filter({ hasText: 'Current Draw' })
    .first();
  await expect(oldCurrentDraw.locator('.step-rules')).toContainText(
    '0.550000 A',
  );
  await expect(oldCurrentDraw.locator('.step-outcome')).toHaveText('Failed');

  // A v2 NORMAL run makes the cross-version comparison possible.
  const v2RunId = await startV2NormalRun(operatorPage);
  await operatorPage.goto(
    `/compare?leftRunId=${failedRunId}&rightRunId=${v2RunId}`,
  );
  await expect(
    operatorPage.locator('#comparison-summary-heading'),
  ).toBeVisible();
  await expect(
    operatorPage.locator('.run-card[data-side="left"]'),
  ).toContainText('Version 1');
  await expect(
    operatorPage.locator('.run-card[data-side="right"]'),
  ).toContainText('Version 2');
  await expect(
    operatorPage.locator('.run-card[data-side="left"] .status-label'),
  ).toHaveText('Failed');
  await expect(
    operatorPage.locator('.run-card[data-side="right"] .status-label'),
  ).toHaveText('Passed');
  await operatorPage.locator('.summary-notes > summary').click();
  await expect(
    operatorPage.getByText('The runs used different plan versions'),
  ).toBeVisible();
  await expect(operatorPage.getByText(/scenarios differ/)).toBeVisible();
  await expect(comparisonCount(operatorPage, 'Changed rule fields')).toHaveText(
    '1',
  );

  const versionedCurrentDraw = comparisonStepCard(operatorPage, 'Current Draw');
  const versionedMaximum = versionedCurrentDraw.locator(
    '[data-field="maximum"]',
  );
  await expect(versionedMaximum).toHaveAttribute('data-changed', 'true');
  await expect(versionedMaximum.locator('td .mono')).toHaveText([
    '0.550000',
    '0.650000',
  ]);
  // The changed maximum is a rule diff, not a numeric measurement delta.
  await expect(versionedMaximum.locator('td').nth(2)).toHaveText('—');
  await expect(
    versionedCurrentDraw.locator('tr[data-evaluation="outcome"] td').nth(1),
  ).toHaveText('Passed');
  await expect(
    versionedCurrentDraw
      .locator('tr[data-evaluation="first-failure"] td')
      .nth(1),
  ).toHaveText('None recorded');

  await operatorPage
    .locator('.step-jump-button', { hasText: 'Current Draw' })
    .first()
    .click();
  await expect(
    operatorPage.locator('app-comparison-step-card:not([hidden]) .step-header h3'),
  ).toHaveText(/Current Draw/);
  await operatorPage
    .locator('app-comparison-step-card:not([hidden]) .rule-section > summary')
    .click();

  await operatorPage.screenshot({
    path: 'docs/evidence/phase-7-compare-v1-v2.png',
  });
  await versionedMaximum.scrollIntoViewIfNeeded();
  await operatorPage.screenshot({
    path: 'docs/evidence/phase-7-compare-v1-v2-rules.png',
  });

  expect(browserErrors).toEqual([]);

  // Sign out both roles through the UI so the sessions are revoked as well.
  await operatorPage.getByRole('button', { name: /Sign out/ }).click();
  await expect(operatorPage).toHaveURL(/\/login$/);
  await plannerPage.getByRole('button', { name: /Sign out/ }).click();
  await expect(plannerPage).toHaveURL(/\/login$/);
});
