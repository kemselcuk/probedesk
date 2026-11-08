import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  expect,
  test,
  type BrowserContext,
  type Download,
  type Locator,
  type Page,
} from "@playwright/test";
import {
  assertE2eSerialExecution,
  cleanupE2eData,
  prepareE2eDatabase,
  type E2eDatabaseBaseline,
} from "./support/database";

/**
 * EX-12 — feature-pack browser scenario.
 *
 * The main test creates every mutable record through the real Angular UI:
 * a Planner creates a device, copies the seeded published plan into an
 * independent draft, shortens and publishes that draft; an Operator starts a
 * real NORMAL run with the device and batch; a Viewer opens the filtered
 * Overview, history drilldown, report, downloads and print preparation.
 *
 * Evidence boundaries:
 * - No route is mocked. Every visible run measurement comes from the real
 *   simulator/API/PostgreSQL path.
 * - The report and Overview canvases are the production Chart.js surfaces;
 *   `expectPaintedCanvas` proves non-empty pixels, not a fake chart.
 * - `window.print` is replaced before the app boots in the Viewer context, so
 *   native `window.print()` is observable without opening an OS print dialog.
 *   This test does not claim OS-dialog or PDF visual acceptance.
 * - The 200% CSS test is an approximation. It does not claim native browser
 *   zoom was exercised; real browser zoom remains a manual lead gate.
 */

const SEEDED_PLAN_NAME = "Power Supply Validation";
const SEEDED_VERSION_NUMBER = 2;
const PLANNER = {
  email: "planner@probedesk.local",
  password: "PlannerDemo!2026",
};
const OPERATOR = {
  email: "operator@probedesk.local",
  password: "OperatorDemo!2026",
};
const VIEWER = {
  email: "viewer@probedesk.local",
  password: "ViewerDemo!2026",
};

const SUFFIX = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const COPY_PLAN_NAME = `E2E Package Copy ${SUFFIX}`;
const COPIED_STEP_NAME = `Copied Output Voltage ${SUFFIX}`;
const DEVICE_NAME = `E2E Device ${SUFFIX}`;
const DEVICE_SERIAL = `E2E-${SUFFIX}`;
const BATCH_NUMBER = `E2E-BATCH-${SUFFIX.toUpperCase()}`;
const DEVICE_DESCRIPTION =
  `E2E long device description ${SUFFIX}. ` +
  "Simulated bench unit used only by the feature-pack browser scenario. ".repeat(
    4,
  );
const RENAMED_DEVICE_NAME = `${DEVICE_NAME} renamed`;
const RENAMED_DEVICE_SERIAL = `${DEVICE_SERIAL}-R`;
const RUN_SEED = "17";

const REPORT_CSV_HEADER = [
  "runId",
  "planName",
  "versionNumber",
  "deviceName",
  "serialNumber",
  "batchNumber",
  "scenario",
  "runStatus",
  "runOutcome",
  "stepPosition",
  "stepName",
  "unit",
  "minimum",
  "maximum",
  "sampleIndex",
  "value",
  "elapsedMs",
  "recordedAt",
  "isWithinTolerance",
] as const;

interface PrintWindow extends Window {
  __probedeskPrintCalls?: number;
}

interface OverviewResponse {
  readonly asOf: string;
  readonly filters: {
    readonly from: string;
    readonly to: string;
    readonly planId: string | null;
    readonly planVersionId: string | null;
    readonly deviceId: string | null;
    readonly batchNumber: string | null;
    readonly scenario: string | null;
  };
  readonly summary: {
    readonly totalRuns: number;
    readonly completedRuns: number;
    readonly passedRuns: number;
    readonly failedRuns: number;
    readonly runningRuns: number;
    readonly cancelledRuns: number;
    readonly interruptedRuns: number;
    readonly errorRuns: number;
    readonly passRatePercent: string | null;
    readonly averageDurationMs: string | null;
  };
  readonly trend: ReadonlyArray<{
    readonly date: string;
    readonly totalRuns: number;
    readonly completedRuns: number;
    readonly passedRuns: number;
    readonly failedRuns: number;
    readonly passRatePercent: string | null;
  }>;
  readonly topFailedSteps: readonly unknown[];
}

interface ExportedReport {
  readonly schemaVersion: number;
  readonly generatedAt: string;
  readonly runId: string;
  readonly planId: string;
  readonly planVersionId: string;
  readonly planName: string;
  readonly versionNumber: number;
  readonly deviceId: string | null;
  readonly deviceSnapshot: {
    readonly id: string;
    readonly name: string;
    readonly serialNumber: string;
    readonly deviceProfileId: string;
  } | null;
  readonly batchNumber: string | null;
  readonly scenario: string;
  readonly seed: number;
  readonly status: string;
  readonly outcome: string | null;
  readonly expectedSampleCount: number;
  readonly recordedSampleCount: number;
  readonly requestedBy: { readonly email: string; readonly role: string };
  readonly steps: ReadonlyArray<{
    readonly position: number;
    readonly name: string;
    readonly unit: string;
    readonly minimum: string;
    readonly maximum: string;
    readonly sampleCount: number;
    readonly intervalMs: number;
    readonly measurements: ReadonlyArray<{
      readonly sampleIndex: number;
      readonly value: string;
      readonly elapsedMs: number;
      readonly recordedAt: string;
      readonly isWithinTolerance: boolean;
    }>;
  }>;
}

const createdPlanIds: string[] = [];
const createdPlanNames: string[] = [COPY_PLAN_NAME];
const createdDeviceIds: string[] = [];
const createdDeviceNames: string[] = [DEVICE_NAME, RENAMED_DEVICE_NAME];
const contexts: BrowserContext[] = [];
const browserErrors: string[] = [];
let baseline: E2eDatabaseBaseline | undefined;

test.beforeAll(async () => {
  baseline = await prepareE2eDatabase();
});

test.beforeEach(() => {
  assertE2eSerialExecution(test.info().config.workers);
});

// Runs after a failed assertion too. It closes every browser context and
// restores the session baseline while deleting only this file's exact ids/names.
test.afterAll(async () => {
  await Promise.all(
    contexts.map((context) => context.close().catch(() => undefined)),
  );
  if (!baseline) return;

  await cleanupE2eData({
    planIds: createdPlanIds,
    planNames: createdPlanNames,
    deviceIds: createdDeviceIds,
    deviceNames: createdDeviceNames,
    sessionBaseline: baseline.sessionIds,
    userEmails: [PLANNER.email, OPERATOR.email, VIEWER.email],
  });

  // The tracked cleanup must restore the pre-test baseline, including the
  // device and copy-provenance digests, rather than only removing known ids.
  const restored = await prepareE2eDatabase();
  expect(restored.plans).toBe(baseline.plans);
  expect(restored.runs).toBe(baseline.runs);
  expect(restored.sessions).toBe(baseline.sessions);
  expect(restored.devices).toBe(baseline.devices);
  expect(restored.devicesDigest).toBe(baseline.devicesDigest);
  expect(restored.planCopyRequests).toBe(baseline.planCopyRequests);
  expect(restored.planCopyRequestsDigest).toBe(baseline.planCopyRequestsDigest);
  expect(restored.activeRuns).toBe(0);
});

async function signIn(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.locator("#email").fill(user.email);
  await page.locator("#password").fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/overview(?:\?.*)?$/);
  await expect(
    page.getByRole("heading", { name: "Overview", level: 1 }),
  ).toBeVisible();
}

function primaryNav(page: Page): Locator {
  return page.locator("nav#primary-navigation");
}

async function openTestPlans(page: Page): Promise<void> {
  await primaryNav(page)
    .getByRole("link", { name: /Test Plans/ })
    .click();
  await expect(page).toHaveURL(/\/plans$/);
  await expect(
    page.getByRole("heading", { name: "Test Plans", level: 1 }),
  ).toBeVisible();
}

function planRow(page: Page, name: string): Locator {
  return page
    .locator("table.pd-table--plans tbody tr")
    .filter({ hasText: name })
    .first();
}

function stepCards(page: Page): Locator {
  return page.locator("section.step-card");
}

function utcCalendarDate(offsetDays: number): string {
  const now = new Date();
  const date = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + offsetDays,
    ),
  );
  return date.toISOString().slice(0, 10);
}

function pathSegments(page: Page): string[] {
  return new URL(page.url()).pathname.split("/").filter(Boolean);
}

function pathSegment(page: Page, index: number, label: string): string {
  const value = pathSegments(page)[index];
  if (value === undefined) {
    throw new Error(`Missing ${label} in ${page.url()}.`);
  }
  return value;
}

function assertUuid(value: string, label: string): void {
  expect(value, label).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
}

function trackPageErrors(page: Page, role: string): void {
  page.on("pageerror", (error) => {
    browserErrors.push(`${role} pageerror: ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(`${role} console: ${message.text()}`);
    }
  });
}

async function readCanvasReadiness(canvas: Locator): Promise<{
  width: number;
  height: number;
  painted: number;
}> {
  return canvas.evaluate((element) => {
    const surface = element as HTMLCanvasElement;
    const context = surface.getContext("2d");
    if (context === null || surface.width === 0 || surface.height === 0) {
      return { width: surface.width, height: surface.height, painted: 0 };
    }
    const pixels = context.getImageData(
      0,
      0,
      surface.width,
      surface.height,
    ).data;
    let painted = 0;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] !== 0) painted += 1;
    }
    return {
      width: surface.width,
      height: surface.height,
      painted,
    };
  });
}

async function expectPaintedCanvas(canvas: Locator): Promise<void> {
  await expect
    .poll(async () => (await readCanvasReadiness(canvas)).painted)
    .toBeGreaterThan(500);
  const readiness = await readCanvasReadiness(canvas);
  expect(readiness.width).toBeGreaterThan(0);
  expect(readiness.height).toBeGreaterThan(0);
}

async function readDownload(download: Download): Promise<Buffer> {
  const filePath = await download.path();
  if (filePath === null) {
    throw new Error("The browser download did not produce a local file.");
  }
  return readFile(filePath);
}

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      collectKeys(child, keys);
    }
  }
  return keys;
}

test("planner copies and publishes a plan, operator runs it, viewer reports and exports it", async ({
  browser,
}) => {
  test.setTimeout(240_000);

  // --- Planner: device, plan copy, short draft, publish -------------------
  const plannerContext = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:4200",
    viewport: { width: 1280, height: 1000 },
  });
  contexts.push(plannerContext);
  const plannerPage = await plannerContext.newPage();
  await signIn(plannerPage, PLANNER);
  trackPageErrors(plannerPage, "planner");

  await primaryNav(plannerPage)
    .getByRole("link", { name: /Devices/ })
    .click();
  await expect(plannerPage).toHaveURL(/\/devices$/);
  await plannerPage.getByRole("button", { name: "New device" }).click();
  const deviceDialog = plannerPage.getByRole("dialog");
  await expect(
    deviceDialog.getByRole("heading", { name: "New device" }),
  ).toBeVisible();
  await deviceDialog.locator("#device-name").fill(DEVICE_NAME);
  await deviceDialog.locator("#device-serial").fill(DEVICE_SERIAL);
  await deviceDialog.locator("#device-description").fill(DEVICE_DESCRIPTION);
  await deviceDialog.getByRole("button", { name: "Save device" }).click();
  await expect(deviceDialog).toHaveCount(0);

  const deviceRow = plannerPage
    .locator("table.devices-table tbody tr")
    .filter({ hasText: DEVICE_NAME })
    .first();
  await expect(deviceRow).toBeVisible();
  await expect(deviceRow).toContainText(DEVICE_SERIAL);
  await expect(deviceRow).toContainText("Active");
  const deviceHref = await deviceRow.locator("a").getAttribute("href");
  expect(deviceHref).toMatch(/^\/devices\/[0-9a-f-]{36}$/);
  const deviceId = deviceHref!.split("/").at(-1)!;
  assertUuid(deviceId, "device id");
  createdDeviceIds.push(deviceId);
  createdDeviceNames.push(DEVICE_NAME);

  await deviceRow.getByRole("link", { name: DEVICE_NAME }).click();
  await expect(plannerPage).toHaveURL(new RegExp(`/devices/${deviceId}$`));
  await expect(
    plannerPage.getByRole("heading", { name: DEVICE_NAME, level: 1 }),
  ).toBeVisible();
  const deviceRecord = plannerPage.locator(".device-card dd");
  await expect(deviceRecord.nth(0)).toHaveText(DEVICE_SERIAL);
  await expect(deviceRecord.nth(2)).toHaveText("Active");
  await expect(deviceRecord.nth(3)).toHaveText(DEVICE_DESCRIPTION);

  await openTestPlans(plannerPage);
  const seededRow = planRow(plannerPage, SEEDED_PLAN_NAME);
  await expect(seededRow).toBeVisible();
  await seededRow
    .getByRole("link", { name: `Version ${SEEDED_VERSION_NUMBER}` })
    .click();
  await expect(plannerPage).toHaveURL(
    /\/plans\/[0-9a-f-]+\/versions\/[0-9a-f-]+$/,
  );
  const sourcePlanId = pathSegment(plannerPage, 1, "source plan id");
  const sourceVersionId = pathSegment(plannerPage, 3, "source version id");
  assertUuid(sourcePlanId, "source plan id");
  assertUuid(sourceVersionId, "source version id");
  await expect(plannerPage.locator("#version-title")).toHaveText(
    SEEDED_PLAN_NAME,
  );
  await expect(plannerPage.locator(".version-badge")).toHaveText(
    `Version ${SEEDED_VERSION_NUMBER}`,
  );
  await expect(plannerPage.locator(".steps-card tbody tr")).toHaveCount(3);
  await expect(
    plannerPage
      .locator(".steps-card tbody tr")
      .filter({ hasText: "Current Draw" })
      .locator("td")
      .nth(4),
  ).toHaveText("0.650000");

  await plannerPage
    .getByRole("button", {
      name: `Copy ${SEEDED_PLAN_NAME}, version ${SEEDED_VERSION_NUMBER} as a new plan`,
    })
    .click();
  const copyDialog = plannerPage.getByRole("dialog");
  await expect(
    copyDialog.getByRole("heading", { name: "Copy as new plan" }),
  ).toBeVisible();
  await expect(copyDialog.locator(".source")).toContainText(SEEDED_PLAN_NAME);
  await expect(copyDialog.locator(".source")).toContainText(
    `Version ${SEEDED_VERSION_NUMBER}`,
  );
  await expect(copyDialog.locator("#copy-plan-description")).toContainText(
    "independent draft",
  );
  await expect(copyDialog.locator("#copy-plan-description")).toContainText(
    "source plan and its run history stay unchanged",
  );
  await expect(copyDialog.locator("#copy-plan-name")).toHaveValue(
    `${SEEDED_PLAN_NAME} (copy)`,
  );
  await copyDialog.locator("#copy-plan-name").fill(COPY_PLAN_NAME);
  await copyDialog
    .getByRole("button", { name: "Create independent draft" })
    .click();
  await expect(copyDialog).toHaveCount(0);
  await expect(plannerPage).toHaveURL(/\/plans\/[0-9a-f-]+\/edit$/);
  const copyPlanId = pathSegment(plannerPage, 1, "copy plan id");
  assertUuid(copyPlanId, "copy plan id");
  expect(copyPlanId).not.toBe(sourcePlanId);
  createdPlanIds.push(copyPlanId);
  createdPlanNames.push(COPY_PLAN_NAME);
  await expect(plannerPage.locator("#plan-name")).toHaveValue(COPY_PLAN_NAME);
  await expect(stepCards(plannerPage)).toHaveCount(3);
  await expect(
    stepCards(plannerPage).nth(1).locator('input[formControlName="name"]'),
  ).toHaveValue("Current Draw");

  // Shorten the copied draft: one step, four samples, minimum allowed interval.
  await plannerPage.getByRole("button", { name: "Remove step 3" }).click();
  await expect(stepCards(plannerPage)).toHaveCount(2);
  await plannerPage.getByRole("button", { name: "Remove step 2" }).click();
  await expect(stepCards(plannerPage)).toHaveCount(1);
  const copiedStep = stepCards(plannerPage).first();
  await copiedStep
    .locator('input[formControlName="name"]')
    .fill(COPIED_STEP_NAME);
  await copiedStep.locator('input[formControlName="unit"]').fill("V");
  await copiedStep.locator('input[formControlName="minimum"]').fill("4.75");
  await copiedStep.locator('input[formControlName="maximum"]').fill("5.25");
  await copiedStep.locator('input[formControlName="sampleCount"]').fill("4");
  await copiedStep.locator('input[formControlName="intervalMs"]').fill("100");

  await plannerPage.getByRole("button", { name: "Save draft" }).click();
  await expect(plannerPage.locator(".save-state")).toHaveText(
    "All changes saved",
  );
  await plannerPage.locator("#publish-button").click();
  const publishDialog = plannerPage.getByRole("dialog");
  await expect(publishDialog).toBeVisible();
  await publishDialog.getByRole("button", { name: "Publish version" }).click();
  await expect(plannerPage.locator("#publish-success-heading")).toHaveText(
    "Version 1 published",
  );
  await plannerPage
    .locator("#publish-success")
    .getByRole("link", { name: "View version 1" })
    .click();
  await expect(plannerPage).toHaveURL(
    new RegExp(`/plans/${copyPlanId}/versions/[0-9a-f-]+$`),
  );
  const copyVersionId = pathSegment(plannerPage, 3, "copy version id");
  assertUuid(copyVersionId, "copy version id");
  expect(copyVersionId).not.toBe(sourceVersionId);
  await expect(plannerPage.locator("#version-title")).toHaveText(
    COPY_PLAN_NAME,
  );
  await expect(plannerPage.locator(".version-state")).toHaveText(
    "Published version",
  );
  await expect(plannerPage.locator(".version-badge")).toHaveText("Version 1");
  await expect(plannerPage.locator(".steps-card tbody tr")).toHaveCount(1);
  const copiedVersionRow = plannerPage.locator(".steps-card tbody tr").first();
  await expect(copiedVersionRow.locator("td").nth(1)).toHaveText(
    COPIED_STEP_NAME,
  );
  await expect(copiedVersionRow.locator("td").nth(3)).toHaveText("4.750000");
  await expect(copiedVersionRow.locator("td").nth(4)).toHaveText("5.250000");
  await expect(copiedVersionRow.locator("td").nth(5)).toHaveText("4");
  await expect(copiedVersionRow.locator("td").nth(6)).toHaveText("100");

  // The source version is still a distinct, unchanged three-step v2.
  await plannerPage.goto(`/plans/${sourcePlanId}/versions/${sourceVersionId}`);
  await expect(plannerPage.locator("#version-title")).toHaveText(
    SEEDED_PLAN_NAME,
  );
  await expect(plannerPage.locator(".version-badge")).toHaveText(
    `Version ${SEEDED_VERSION_NUMBER}`,
  );
  await expect(plannerPage.locator(".steps-card tbody tr")).toHaveCount(3);
  await expect(
    plannerPage
      .locator(".steps-card tbody tr")
      .filter({ hasText: "Current Draw" })
      .locator("td")
      .nth(4),
  ).toHaveText("0.650000");

  // --- Operator: real NORMAL run with device and batch --------------------
  const operatorContext = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:4200",
    viewport: { width: 1280, height: 1000 },
  });
  contexts.push(operatorContext);
  const operatorPage = await operatorContext.newPage();
  await signIn(operatorPage, OPERATOR);
  trackPageErrors(operatorPage, "operator");

  await openTestPlans(operatorPage);
  const copiedPlanRow = planRow(operatorPage, COPY_PLAN_NAME);
  await expect(copiedPlanRow).toBeVisible();
  await copiedPlanRow.getByRole("link", { name: "Version 1" }).click();
  await expect(operatorPage).toHaveURL(
    new RegExp(`/plans/${copyPlanId}/versions/${copyVersionId}$`),
  );
  await operatorPage.locator("#start-run-link").click();
  await expect(operatorPage).toHaveURL(/\/runs\/new\?versionId=/);
  await expect(
    operatorPage.getByRole("heading", { name: "Start Run", level: 1 }),
  ).toBeVisible();

  await operatorPage
    .locator('mat-select[aria-label="Device (optional)"]')
    .click();
  await operatorPage
    .getByRole("option", {
      name: `${DEVICE_NAME} · ${DEVICE_SERIAL}`,
      exact: true,
    })
    .click();
  await expect(
    operatorPage.getByText(
      `Selected: ${DEVICE_NAME} · ${DEVICE_SERIAL}. Active.`,
    ),
  ).toBeVisible();
  await operatorPage.locator("#start-run-batch").fill(BATCH_NUMBER);
  await operatorPage.locator("#start-run-scenario").click();
  await operatorPage
    .getByRole("option", { name: "Normal", exact: true })
    .click();
  await operatorPage.locator("#start-run-seed").fill(RUN_SEED);
  await expect(operatorPage.locator("#start-run-submit")).toBeEnabled();
  await operatorPage.locator("#start-run-submit").click();
  await expect
    .poll(() => new URL(operatorPage.url()).pathname)
    .toMatch(/^\/runs\/[0-9a-f-]{36}(?:\/live)?$/);
  const runId = pathSegment(operatorPage, 1, "run id");
  assertUuid(runId, "run id");
  // The UI opens the live screen for a fresh RUNNING start. The short run is
  // allowed to finish before the start response is rendered; both landings
  // still use the same real run and are verified on Details below.
  if (new URL(operatorPage.url()).pathname.endsWith("/live")) {
    await expect(
      operatorPage.locator("#live-run-summary .status-label"),
    ).toHaveText("Passed", { timeout: 30_000 });
    await expect(operatorPage.locator(".terminal-summary")).toContainText(
      "The run completed and every step passed.",
    );
    await expect(operatorPage.locator(".progress-label")).toContainText(
      "of 4 samples recorded",
    );
    await operatorPage.locator("#live-run-details-link").click();
  }
  await expect(operatorPage).toHaveURL(new RegExp(`/runs/${runId}$`));
  await expect(operatorPage.locator("#run-summary-heading")).toHaveText(
    COPY_PLAN_NAME,
  );
  await expect(
    operatorPage.locator("#run-snapshot-region .status-label"),
  ).toHaveText("Passed");
  await expect(operatorPage.locator(".run-meta-line")).toContainText(
    "Version 1",
  );
  await expect(operatorPage.locator(".run-meta-line")).toContainText(runId);
  await expect(operatorPage.locator("#total-out-of-tolerance")).toHaveText("0");
  await expect(operatorPage.locator("#partial-sample-summary")).toHaveText(
    "None — every expected sample was recorded",
  );
  const detailMetadata = operatorPage.locator(
    "app-run-device-metadata .metadata",
  );
  await expect(detailMetadata).toContainText("Recorded device");
  await expect(detailMetadata).toContainText(
    `${DEVICE_NAME} · ${DEVICE_SERIAL}`,
  );
  await expect(detailMetadata).toContainText("Batch number");
  await expect(detailMetadata).toContainText(BATCH_NUMBER);
  await operatorPage.locator(".run-metadata-disclosure > summary").click();
  const runMetadata = operatorPage.locator("dl.run-metadata");
  await expect(
    runMetadata
      .locator("dt")
      .filter({ hasText: /^Scenario$/ })
      .locator("..")
      .locator("dd"),
  ).toHaveText("Normal (NORMAL)");
  await expect(
    runMetadata
      .locator("dt")
      .filter({ hasText: /^Seed$/ })
      .locator("..")
      .locator("dd"),
  ).toHaveText(RUN_SEED);
  await expect(
    runMetadata
      .locator("dt")
      .filter({ hasText: /^Requested by$/ })
      .locator("..")
      .locator("dd"),
  ).toContainText(OPERATOR.email);
  const detailStep = operatorPage.locator(".step-card:not([hidden])").first();
  await expect(detailStep.locator(".step-outcome")).toHaveText("Passed");
  await expect(
    detailStep.locator(".pd-table--measurements tbody tr"),
  ).toHaveCount(4);
  await expect(detailStep.locator(".tolerance--outside")).toHaveCount(0);

  // --- Planner renames the current device; the run snapshot must not move --
  await plannerPage.goto(`/devices/${deviceId}`);
  await plannerPage.getByRole("button", { name: "Edit device" }).click();
  const editDialog = plannerPage.getByRole("dialog");
  await expect(editDialog).toBeVisible();
  await editDialog.locator("#device-name").fill(RENAMED_DEVICE_NAME);
  await editDialog.locator("#device-serial").fill(RENAMED_DEVICE_SERIAL);
  await editDialog.getByRole("button", { name: "Save device" }).click();
  await expect(editDialog).toHaveCount(0);
  await expect(
    plannerPage.getByRole("heading", { name: RENAMED_DEVICE_NAME, level: 1 }),
  ).toBeVisible();
  const renamedRecord = plannerPage.locator(".device-card dd");
  await expect(renamedRecord.nth(0)).toHaveText(RENAMED_DEVICE_SERIAL);
  await expect(renamedRecord.nth(2)).toHaveText("Active");
  await expect(renamedRecord.nth(3)).toHaveText(DEVICE_DESCRIPTION);

  // Fresh load after the rename still shows the values copied at start.
  await operatorPage.goto(`/runs/${runId}`);
  await expect(
    operatorPage.locator("#run-snapshot-region .status-label"),
  ).toHaveText("Passed");
  await expect(
    operatorPage.locator("app-run-device-metadata .metadata"),
  ).toContainText(`${DEVICE_NAME} · ${DEVICE_SERIAL}`);
  await expect(
    operatorPage.locator("app-run-device-metadata .metadata"),
  ).not.toContainText(RENAMED_DEVICE_NAME);

  // --- Viewer: filtered Overview, backend KPI strings, drilldown ----------
  const viewerContext = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:4200",
    viewport: { width: 1440, height: 1000 },
  });
  contexts.push(viewerContext);
  // The wrapper makes the native print invocation observable without an OS
  // dialog. It must be installed before the report page loads.
  await viewerContext.addInitScript(() => {
    const target = window as PrintWindow;
    target.__probedeskPrintCalls = 0;
    window.print = () => {
      target.__probedeskPrintCalls = (target.__probedeskPrintCalls ?? 0) + 1;
    };
  });
  const viewerPage = await viewerContext.newPage();
  await signIn(viewerPage, VIEWER);
  trackPageErrors(viewerPage, "viewer");
  await expect(viewerPage.locator(".kpis")).toBeVisible();

  const fromDate = utcCalendarDate(-1);
  const toDate = utcCalendarDate(1);
  await viewerPage.locator("#overview-from").fill(fromDate);
  await viewerPage.locator("#overview-from").press("Tab");
  await viewerPage.locator("#overview-to").fill(toDate);
  await viewerPage.locator("#overview-to").press("Tab");
  await viewerPage.locator("#overview-plan").click();
  await viewerPage
    .getByRole("option", { name: COPY_PLAN_NAME, exact: true })
    .click();
  await viewerPage.locator("#overview-version").click();
  await viewerPage
    .getByRole("option", {
      name: `Version 1 · ${COPY_PLAN_NAME}`,
      exact: true,
    })
    .click();
  await viewerPage.locator("#overview-scenario").click();
  await viewerPage.getByRole("option", { name: "Normal", exact: true }).click();
  await viewerPage.locator("#overview-batch").fill(BATCH_NUMBER);
  await viewerPage.locator("details.device-filter > summary").click();
  await viewerPage.locator('mat-select[aria-label="Device filter"]').click();
  await viewerPage
    .getByRole("option", {
      name: `${RENAMED_DEVICE_NAME} · ${RENAMED_DEVICE_SERIAL}`,
      exact: true,
    })
    .click();
  await expect(
    viewerPage.locator("details.device-filter > summary"),
  ).toContainText("Device filter:");

  const overviewResponsePromise = viewerPage.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname.endsWith("/api/analytics/overview") &&
      url.searchParams.get("deviceId") === deviceId &&
      url.searchParams.get("planId") === copyPlanId
    );
  });
  await viewerPage.getByRole("button", { name: "Apply filters" }).click();
  const overviewResponse = await overviewResponsePromise;
  expect(overviewResponse.ok()).toBe(true);
  const overview = (await overviewResponse.json()) as OverviewResponse;
  expect(overview.filters.planId).toBe(copyPlanId);
  expect(overview.filters.planVersionId).toBe(copyVersionId);
  expect(overview.filters.deviceId).toBe(deviceId);
  expect(overview.filters.batchNumber).toBe(BATCH_NUMBER);
  expect(overview.filters.scenario).toBe("NORMAL");
  expect(overview.summary.totalRuns).toBe(1);
  expect(overview.summary.completedRuns).toBe(1);
  expect(overview.summary.passedRuns).toBe(1);
  expect(overview.summary.failedRuns).toBe(0);
  expect(overview.summary.runningRuns).toBe(0);
  expect(overview.summary.passRatePercent).toBe("100.00");
  expect(overview.summary.averageDurationMs).toMatch(/^\d+\.\d{3}$/);

  const appliedFilters = viewerPage.locator('[aria-label="Applied filters"]');
  await expect(appliedFilters).toContainText(`Plan: ${copyPlanId}`);
  await expect(appliedFilters).toContainText(`Version: ${copyVersionId}`);
  await expect(appliedFilters).toContainText(`Device: ${deviceId}`);
  await expect(appliedFilters).toContainText(`Batch: ${BATCH_NUMBER}`);
  await expect(appliedFilters).toContainText("Scenario: NORMAL");

  async function expectKpi(label: string, value: string): Promise<void> {
    await expect(
      viewerPage.locator(".kpi").filter({ hasText: label }).locator("strong"),
    ).toHaveText(value);
  }
  await expectKpi("Total runs", String(overview.summary.totalRuns));
  await expectKpi("Pass rate", `${overview.summary.passRatePercent}%`);
  await expectKpi("Failed runs", String(overview.summary.failedRuns));
  await expectKpi(
    "Average duration",
    `${overview.summary.averageDurationMs} ms`,
  );
  const stateCounts = viewerPage.locator("nav.state-counts");
  await expect(stateCounts).toContainText("Running");
  await expect(
    stateCounts.locator("a", { hasText: "Running" }).locator("strong"),
  ).toHaveText(String(overview.summary.runningRuns));
  await expect(
    stateCounts.locator("a", { hasText: "Cancelled" }).locator("strong"),
  ).toHaveText(String(overview.summary.cancelledRuns));
  await expect(
    stateCounts.locator("a", { hasText: "Interrupted" }).locator("strong"),
  ).toHaveText(String(overview.summary.interruptedRuns));
  await expect(
    stateCounts.locator("a", { hasText: "Error" }).locator("strong"),
  ).toHaveText(String(overview.summary.errorRuns));

  const activeDay = overview.trend.find((day) => day.totalRuns === 1);
  expect(activeDay).toBeDefined();
  expect(activeDay!.completedRuns).toBe(1);
  expect(activeDay!.passedRuns).toBe(1);
  expect(activeDay!.failedRuns).toBe(0);
  expect(activeDay!.passRatePercent).toBe("100.00");
  const activeTrendRow = viewerPage
    .locator(".trend-table tbody tr")
    .filter({ hasText: activeDay!.date });
  await expect(activeTrendRow).toBeVisible();
  await expect(activeTrendRow.locator("td").nth(0)).toHaveText("1");
  await expect(activeTrendRow.locator("td").nth(1)).toHaveText("1");
  await expect(activeTrendRow.locator("td").nth(2)).toHaveText("1");
  await expect(activeTrendRow.locator("td").nth(3)).toHaveText("0");
  await expect(activeTrendRow.locator("td").nth(8)).toHaveText("100.00%");
  await expect(
    viewerPage.getByText("No failed completed steps in this selection."),
  ).toBeVisible();

  // KPI drilldown keeps every applied filter and opens the recorded run.
  await viewerPage.locator(".kpi").filter({ hasText: "Total runs" }).click();
  await expect(viewerPage).toHaveURL(/\/runs\?/);
  const historyUrl = new URL(viewerPage.url());
  expect(historyUrl.searchParams.get("from")).toBe(overview.filters.from);
  expect(historyUrl.searchParams.get("to")).toBe(overview.filters.to);
  expect(historyUrl.searchParams.get("planId")).toBe(copyPlanId);
  expect(historyUrl.searchParams.get("planVersionId")).toBe(copyVersionId);
  expect(historyUrl.searchParams.get("deviceId")).toBe(deviceId);
  expect(historyUrl.searchParams.get("batchNumber")).toBe(BATCH_NUMBER);
  expect(historyUrl.searchParams.get("scenario")).toBe("NORMAL");
  await expect(viewerPage.locator("#history-batch")).toHaveValue(BATCH_NUMBER);
  await expect(viewerPage.locator("#history-plan")).toContainText(
    COPY_PLAN_NAME,
  );
  await viewerPage.locator("#history-version").click();
  await expect(
    viewerPage.getByRole("option", {
      name: `Version 1 · ${COPY_PLAN_NAME}`,
      exact: true,
    }),
  ).toBeVisible();
  await viewerPage.keyboard.press("Escape");
  await expect(viewerPage.locator("#history-scenario")).toContainText("Normal");
  const historyRow = viewerPage
    .locator("#run-history-table tbody tr")
    .filter({ has: viewerPage.locator(`a[href="/runs/${runId}"]`) });
  await expect(historyRow).toBeVisible();
  await expect(historyRow).toContainText(COPY_PLAN_NAME);
  await expect(historyRow).toContainText("Version 1");
  await expect(historyRow).toContainText(`${DEVICE_NAME} · ${DEVICE_SERIAL}`);
  await expect(historyRow).toContainText(`Batch ${BATCH_NUMBER}`);
  await expect(historyRow.locator(".status-label")).toHaveText("Passed");
  await expect(historyRow).toContainText("4 of 4");

  // --- Viewer: direct report URL, refresh, copied rules and metadata ------
  await viewerPage.goto(`/runs/${runId}/report`);
  await expect(viewerPage.locator("article.report-document")).toBeVisible();
  await expect(viewerPage.locator(".report-heading h1")).toHaveText(
    COPY_PLAN_NAME,
  );
  await expect(
    viewerPage.locator("app-run-device-metadata .metadata"),
  ).toContainText(`${DEVICE_NAME} · ${DEVICE_SERIAL}`);
  await expect(
    viewerPage.locator("app-run-device-metadata .metadata"),
  ).toContainText(BATCH_NUMBER);
  await expect(viewerPage.locator(".report-heading")).toContainText(
    "Published version 1",
  );
  await expect(
    viewerPage
      .locator(".report-heading p")
      .filter({ hasText: "Recorded samples:" }),
  ).toContainText("4 / 4");
  const reportStep = viewerPage.locator("section.report-step").first();
  await expect(reportStep.locator("h2")).toHaveText(`1. ${COPIED_STEP_NAME}`);
  const rules = reportStep.locator(".pd-table tbody tr td");
  await expect(rules.nth(0)).toHaveText("V");
  await expect(rules.nth(1)).toHaveText("4.750000");
  await expect(rules.nth(2)).toHaveText("5.250000");
  await expect(rules.nth(3)).toHaveText("100 ms");
  await expect(rules.nth(4)).toHaveText("0");
  await expect(viewerPage.getByText(/Partial result:/)).toHaveCount(0);

  await viewerPage.reload();
  await expect(viewerPage.locator("article.report-document")).toBeVisible();
  await expect(viewerPage.locator(".report-heading h1")).toHaveText(
    COPY_PLAN_NAME,
  );
  await expect(
    viewerPage.getByRole("button", { name: "Print / Save PDF" }),
  ).toBeEnabled({
    timeout: 30_000,
  });

  const reportCanvases = viewerPage.locator("app-report-chart canvas");
  await expect(reportCanvases).toHaveCount(1);
  await expectPaintedCanvas(reportCanvases.first());

  // Print preparation: the observable hook replaces the native dialog.
  await viewerPage.getByRole("button", { name: "Print / Save PDF" }).click();
  await expect
    .poll(() =>
      viewerPage.evaluate(
        () => (window as PrintWindow).__probedeskPrintCalls ?? 0,
      ),
    )
    .toBe(1);
  await expect(viewerPage.locator("body")).toHaveClass(/pd-print-report/);
  const printChart = viewerPage
    .locator("app-report-chart .print-chart")
    .first();
  await expect(viewerPage.locator("app-report-chart .print-chart")).toHaveCount(
    1,
  );
  await expect(printChart).toHaveAttribute("src", /^data:image\/png;base64,/);
  await expect
    .poll(() =>
      printChart.evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(
    viewerPage.getByRole("button", { name: "Print / Save PDF" }),
  ).toBeVisible();
  await expect(viewerPage.locator(".print-warning")).toBeHidden();

  // Print media hides navigation/actions and swaps the screen canvas for the
  // prepared image. This is CSS/media readiness, not a PDF or OS-dialog claim.
  await viewerPage.emulateMedia({ media: "print" });
  await expect
    .poll(() =>
      viewerPage
        .locator(".report-actions")
        .first()
        .evaluate((element) => getComputedStyle(element).display),
    )
    .toBe("none");
  await expect
    .poll(() =>
      printChart.evaluate((element) => getComputedStyle(element).display),
    )
    .toBe("block");
  await expect
    .poll(() =>
      viewerPage
        .locator("app-report-chart .chart-frame")
        .first()
        .evaluate((element) => getComputedStyle(element).display),
    )
    .toBe("none");
  await viewerPage.pdf({
    path: test.info().outputPath("run-report.pdf"),
    preferCSSPageSize: true,
    printBackground: true,
  });
  await viewerPage.emulateMedia({ media: "screen" });

  // --- Viewer: real CSV and JSON downloads --------------------------------
  const csvDownloadPromise = viewerPage.waitForEvent("download");
  await viewerPage.getByRole("button", { name: "Download CSV" }).click();
  const csvDownload = await csvDownloadPromise;
  expect(csvDownload.suggestedFilename()).toBe(
    `probedesk-run-${runId.toLowerCase()}.csv`,
  );
  const csvBuffer = await readDownload(csvDownload);
  expect([...csvBuffer.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const csvText = csvBuffer.toString("utf8");
  expect(csvText.charCodeAt(0)).toBe(0xfeff);
  const csvLines = csvText.slice(1).split("\r\n");
  expect(csvLines.at(-1)).toBe("");
  const csvDataLines = csvLines.slice(1, -1);
  expect(csvLines[0]).toBe(REPORT_CSV_HEADER.join(","));
  expect(csvDataLines).toHaveLength(4);
  for (const [index, line] of csvDataLines.entries()) {
    const cells = line.split(",");
    expect(cells).toHaveLength(REPORT_CSV_HEADER.length);
    expect(cells[0]).toBe(runId);
    expect(cells[1]).toBe(COPY_PLAN_NAME);
    expect(cells[2]).toBe("1");
    expect(cells[3]).toBe(DEVICE_NAME);
    expect(cells[4]).toBe(DEVICE_SERIAL);
    expect(cells[5]).toBe(BATCH_NUMBER);
    expect(cells[6]).toBe("NORMAL");
    expect(cells[7]).toBe("COMPLETED");
    expect(cells[8]).toBe("PASSED");
    expect(cells[9]).toBe("1");
    expect(cells[10]).toBe(COPIED_STEP_NAME);
    expect(cells[11]).toBe("V");
    expect(cells[12]).toBe("4.750000");
    expect(cells[13]).toBe("5.250000");
    expect(cells[14]).toBe(String(index));
    expect(cells[15]).toMatch(/^-?\d+\.\d{6}$/);
    expect(cells[16]).toMatch(/^\d+$/);
    expect(cells[17]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(cells[18]).toBe("true");
  }

  const jsonDownloadPromise = viewerPage.waitForEvent("download");
  await viewerPage.getByRole("button", { name: "Download JSON" }).click();
  const jsonDownload = await jsonDownloadPromise;
  expect(jsonDownload.suggestedFilename()).toBe(
    `probedesk-run-${runId.toLowerCase()}.json`,
  );
  const jsonText = (await readDownload(jsonDownload)).toString("utf8");
  const exported = JSON.parse(jsonText) as ExportedReport;
  expect(exported.schemaVersion).toBe(1);
  expect(exported.runId).toBe(runId);
  expect(exported.planId).toBe(copyPlanId);
  expect(exported.planVersionId).toBe(copyVersionId);
  expect(exported.planName).toBe(COPY_PLAN_NAME);
  expect(exported.versionNumber).toBe(1);
  expect(exported.deviceId).toBe(deviceId);
  expect(exported.deviceSnapshot).toMatchObject({
    id: deviceId,
    name: DEVICE_NAME,
    serialNumber: DEVICE_SERIAL,
  });
  assertUuid(exported.deviceSnapshot!.deviceProfileId, "profile id");
  expect(exported.batchNumber).toBe(BATCH_NUMBER);
  expect(exported.scenario).toBe("NORMAL");
  expect(exported.seed).toBe(Number(RUN_SEED));
  expect(exported.status).toBe("COMPLETED");
  expect(exported.outcome).toBe("PASSED");
  expect(exported.expectedSampleCount).toBe(4);
  expect(exported.recordedSampleCount).toBe(4);
  expect(exported.requestedBy).toMatchObject({
    email: OPERATOR.email,
    role: "OPERATOR",
  });
  expect(exported.steps).toHaveLength(1);
  const exportedStep = exported.steps[0];
  if (!exportedStep) {
    throw new Error("The exported report did not contain its single step.");
  }
  expect(exportedStep.name).toBe(COPIED_STEP_NAME);
  expect(exportedStep.unit).toBe("V");
  expect(exportedStep.minimum).toBe("4.750000");
  expect(exportedStep.maximum).toBe("5.250000");
  expect(exportedStep.sampleCount).toBe(4);
  expect(exportedStep.intervalMs).toBe(100);
  expect(exportedStep.measurements).toHaveLength(4);
  for (const [index, measurement] of exportedStep.measurements.entries()) {
    expect(measurement.sampleIndex).toBe(index);
    expect(measurement.value).toMatch(/^-?\d+\.\d{6}$/);
    expect(measurement.isWithinTolerance).toBe(true);
    expect(measurement.recordedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  }
  const exportedKeys = collectKeys(exported);
  for (const forbidden of [
    "session",
    "sessionId",
    "passwordHash",
    "requestHash",
    "idempotencyKey",
    "runEvents",
    "eventPayload",
  ]) {
    expect(exportedKeys.has(forbidden)).toBe(false);
  }

  // --- Viewer: legacy run keeps explicit null device/batch metadata -------
  await viewerPage.goto(`/runs?planId=${sourcePlanId}`);
  await expect(viewerPage.locator("#run-history-table")).toBeVisible();
  const legacyRow = viewerPage
    .locator("#run-history-table tbody tr")
    .filter({ hasText: "No device recorded" })
    .filter({ hasText: "Passed" })
    .first();
  await expect(legacyRow).toBeVisible();
  await expect(legacyRow).toContainText("No batch recorded");
  await legacyRow.getByRole("link", { name: /View details for/ }).click();
  await expect(viewerPage).toHaveURL(/\/runs\/[0-9a-f-]{36}$/);
  const legacyRunId = pathSegment(viewerPage, 1, "legacy run id");
  await viewerPage.getByRole("link", { name: "View report" }).click();
  await expect(viewerPage).toHaveURL(
    new RegExp(`/runs/${legacyRunId}/report$`),
  );
  await expect(viewerPage.locator("article.report-document")).toBeVisible();
  await expect(viewerPage.locator(".report-heading h1")).toHaveText(
    SEEDED_PLAN_NAME,
  );
  const legacyMetadata = viewerPage.locator(
    "app-run-device-metadata .metadata",
  );
  await expect(legacyMetadata).toContainText("No device recorded");
  await expect(legacyMetadata).toContainText("No batch recorded");
  await expect(
    viewerPage
      .locator("app-run-device-metadata .metadata > div")
      .filter({ hasText: "Recorded device" }),
  ).toContainText("No device recorded");
  await expect(
    viewerPage.getByRole("button", { name: "Print / Save PDF" }),
  ).toBeEnabled({
    timeout: 30_000,
  });
  const legacyCanvases = viewerPage.locator("app-report-chart canvas");
  await expect(legacyCanvases).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) {
    await expectPaintedCanvas(legacyCanvases.nth(index));
  }
  await viewerPage.getByRole("button", { name: "Print / Save PDF" }).click();
  await expect
    .poll(() =>
      viewerPage.evaluate(
        () => (window as PrintWindow).__probedeskPrintCalls ?? 0,
      ),
    )
    .toBe(1);
  const legacyPrintCharts = viewerPage.locator("app-report-chart .print-chart");
  await expect(legacyPrintCharts).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) {
    const chart = legacyPrintCharts.nth(index);
    await expect(chart).toHaveAttribute("src", /^data:image\/png;base64,/);
    await expect
      .poll(() =>
        chart.evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
  }

  await viewerPage.emulateMedia({ media: "print" });
  await viewerPage.pdf({
    path: test.info().outputPath("legacy-report.pdf"),
    preferCSSPageSize: true,
    printBackground: true,
  });
  await viewerPage.emulateMedia({ media: "screen" });
  expect(browserErrors).toEqual([]);
});

test("overview and history stay usable at 390, 768, 1280 and 1440", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:4200",
    viewport: { width: 1280, height: 900 },
  });
  contexts.push(context);
  const page = await context.newPage();
  await signIn(page, VIEWER);
  trackPageErrors(page, "viewer-responsive");
  await expect(page.locator(".kpis")).toBeVisible();

  const kpiLabels = [
    "Total runs",
    "Pass rate",
    "Failed runs",
    "Average duration",
  ];
  const trendRegion = page.getByRole("region", { name: "Daily run results" });
  for (const width of [390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(".kpis")).toBeVisible();
    for (const label of kpiLabels) {
      const kpi = page
        .locator(".kpis")
        .getByRole("link", { name: new RegExp(`^${label}`) });
      await expect(kpi).toBeVisible();
      await expect(kpi.locator("strong")).toHaveText(/\S/);
    }
    await expect(trendRegion).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      )
      .toBe(0);
    if (width < 1440) {
      await expect
        .poll(() =>
          trendRegion.evaluate(
            (element) => element.scrollWidth > element.clientWidth,
          ),
        )
        .toBe(true);
    }
  }

  // Below 1024 px the sidebar becomes a keyboard-operated modal surface.
  await page.setViewportSize({ width: 390, height: 844 });
  const navToggle = page.locator("button.nav-toggle");
  await expect(navToggle).toBeVisible();
  await expect(page.locator("mat-sidenav")).not.toHaveClass(
    /mat-drawer-opened/,
  );
  await navToggle.press("Enter");
  await expect(navToggle).toHaveAttribute("aria-expanded", "true");
  await expect(primaryNav(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(navToggle).toHaveAttribute("aria-expanded", "false");
  await expect(navToggle).toBeFocused();

  // The whole form-field surface, not only its label, opens the dropdown.
  const planSelect = page.locator("#overview-plan");
  const planField = page.locator("mat-form-field").filter({ has: planSelect });
  await planField.scrollIntoViewIfNeeded();
  const planBox = await planField.boundingBox();
  expect(planBox).not.toBeNull();
  for (const x of [3, planBox!.width / 2, planBox!.width - 3]) {
    await planField.click({ position: { x, y: planBox!.height / 2 } });
    await expect(planSelect).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(planSelect).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("listbox")).toHaveCount(0);
  }

  // Datepicker popup opens, exposes its grid, and closes with the keyboard.
  await page.getByRole("button", { name: "Choose from date" }).click();
  const calendarDialog = page.getByRole("dialog");
  await expect(calendarDialog).toBeVisible();
  await expect(calendarDialog.locator("mat-calendar")).toBeVisible();
  const calendarHeader = calendarDialog.getByRole("button", {
    name: "Choose month and year",
  });
  await calendarHeader.focus();
  await expect(calendarHeader).toBeFocused();
  // Material intentionally ignores close() while its enter animation is running.
  await expect(page.locator("mat-datepicker-content")).not.toHaveClass(
    /mat-datepicker-content-animating/,
  );
  await calendarHeader.press("Escape");
  await expect(calendarDialog).toHaveCount(0);

  // A wide data table scrolls inside its region, never the document.
  await expect(trendRegion).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    )
    .toBe(0);
  await expect
    .poll(() =>
      trendRegion.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      ),
    )
    .toBe(true);
  await trendRegion.focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => trendRegion.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);

  // The production Overview Chart.js canvas has real drawn pixels.
  const overviewCanvas = page.locator("app-overview-trend canvas");
  await expect(overviewCanvas).toHaveCount(1);
  await expectPaintedCanvas(overviewCanvas.first());

  const historyRegion = page.locator("#run-history-table");
  await page.goto("/runs");
  await expect(historyRegion).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    )
    .toBe(0);
  await expect
    .poll(() =>
      historyRegion.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      ),
    )
    .toBe(true);
  await historyRegion.focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => historyRegion.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);

  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator("button.nav-toggle")).toHaveCount(0);
  await expect(primaryNav(page)).toBeVisible();
  expect(browserErrors).toEqual([]);
});

test("CSS 200% zoom approximation keeps overview values reachable", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:4200",
    viewport: { width: 1280, height: 900 },
  });
  contexts.push(context);
  const page = await context.newPage();
  await signIn(page, VIEWER);
  trackPageErrors(page, "viewer-zoom");
  await expect(page.locator(".kpis")).toBeVisible();

  // CSS zoom is only an approximation of browser zoom; this test deliberately
  // does not claim the native browser zoom command was exercised.
  await page.evaluate(() => {
    document.body.style.zoom = "2";
  });
  expect(await page.evaluate(() => getComputedStyle(document.body).zoom)).toBe(
    "2",
  );
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
  await expect(
    page
      .locator(".kpis")
      .getByRole("link", { name: /^Pass rate/ })
      .locator("strong"),
  ).toHaveText(/\S/);

  const trendRegion = page.getByRole("region", { name: "Daily run results" });
  await trendRegion.scrollIntoViewIfNeeded();
  await expect(trendRegion).toBeVisible();
  const hasLocalOverflow = await trendRegion.evaluate(
    (element) => element.scrollWidth > element.clientWidth,
  );
  if (hasLocalOverflow) {
    await trendRegion.focus();
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() => trendRegion.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(0);
  }

  await page.evaluate(() => {
    document.body.style.zoom = "";
  });
  expect(
    await page.evaluate(() => getComputedStyle(document.body).zoom),
  ).not.toBe("2");
  expect(browserErrors).toEqual([]);
});
