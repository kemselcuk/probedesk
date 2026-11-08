import { readFile } from "node:fs/promises";
import {
  expect,
  test,
  type Browser,
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
import {
  seedEdgeFixture,
  type EdgeFixtureStepInput,
} from "./support/ex12-edge-fixtures";

/**
 * EX-12 edge coverage: real 10,000-measurement report/export/chart/print and
 * terminal failed/partial report rendering.
 *
 * Every fixture row lives only in the dedicated `_test` database addressed by
 * `E2E_DATABASE_URL`; the helper follows the executor's write order and leaves
 * the database immutability triggers enabled. The browser, API, PostgreSQL,
 * Chart.js canvases and Chromium print pipeline are real. Only the OS print
 * dialog wrapper is replaced so native `window.print()` stays observable.
 *
 * Explicit boundary: Playwright/Chrome automation cannot trigger native
 * browser zoom (Ctrl/Cmd +) or the OS print dialog reliably. This file does
 * not substitute CSS zoom or `deviceScaleFactor` for either check; those remain
 * reported limitations instead of a false pass.
 */

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
const DEMO_EMAILS = [PLANNER.email, OPERATOR.email, VIEWER.email];

const SUFFIX = `${Date.now()}`.slice(-10);
const LONG_PLAN_NAME =
  "EX-12 10k measurement report fixture - full production-style qualification record";
const LONG_DEVICE_NAME =
  "EX12 Edge Bench Power Module with an intentionally long recorded device name for wrapping";
const LONG_DEVICE_SERIAL = `EX12/EDGE-${SUFFIX}.${"A".repeat(64)}`;
const LONG_BATCH = `EX12-BATCH-${SUFFIX}.${"B".repeat(64)}`;

const CSV_HEADER = [
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
  readonly status: string;
  readonly outcome: string | null;
  readonly reasonCode: string | null;
  readonly expectedSampleCount: number;
  readonly recordedSampleCount: number;
  readonly requestedBy: { readonly email: string; readonly role: string };
  readonly steps: ReadonlyArray<{
    readonly runStepId: string;
    readonly logicalStepId: string;
    readonly position: number;
    readonly name: string;
    readonly unit: string;
    readonly minimum: string;
    readonly maximum: string;
    readonly sampleCount: number;
    readonly intervalMs: number;
    readonly status: string;
    readonly outcome: string | null;
    readonly recordedCount: number;
    readonly outOfToleranceCount: number;
    readonly firstFailureSampleIndex: number | null;
    readonly statistics: {
      readonly minimum: string | null;
      readonly maximum: string | null;
      readonly average: string | null;
      readonly sampleCount: number | null;
    };
    readonly measurements: ReadonlyArray<{
      readonly sampleIndex: number;
      readonly value: string;
      readonly elapsedMs: number;
      readonly recordedAt: string;
      readonly isWithinTolerance: boolean;
    }>;
  }>;
}

interface CanvasPixels {
  readonly width: number;
  readonly height: number;
  readonly painted: number;
  readonly spanX: number;
  readonly redPixels: number;
}

const planIds: string[] = [];
const deviceIds: string[] = [];
const contexts: BrowserContext[] = [];
const browserErrors: string[] = [];
let baseline: E2eDatabaseBaseline | undefined;

const tracker = {
  trackPlan(planId: string): void {
    planIds.push(planId);
  },
  trackDevice(deviceId: string): void {
    deviceIds.push(deviceId);
  },
};

test.beforeAll(async () => {
  baseline = await prepareE2eDatabase();
});

test.beforeEach(() => {
  assertE2eSerialExecution(test.info().config.workers);
});

test.afterAll(async () => {
  await Promise.all(
    contexts.map((context) => context.close().catch(() => undefined)),
  );
  if (!baseline) return;

  await cleanupE2eData({
    planIds,
    deviceIds,
    sessionBaseline: baseline.sessionIds,
    userEmails: DEMO_EMAILS,
  });

  const restored = await prepareE2eDatabase();
  expect(restored.plans).toBe(baseline.plans);
  expect(restored.runs).toBe(baseline.runs);
  expect(restored.sessions).toBe(baseline.sessions);
  expect(restored.devices).toBe(baseline.devices);
  expect(restored.demoDevices).toBe(baseline.demoDevices);
  expect(restored.devicesDigest).toBe(baseline.devicesDigest);
  expect(restored.planCopyRequests).toBe(baseline.planCopyRequests);
  expect(restored.planCopyRequestsDigest).toBe(baseline.planCopyRequestsDigest);
  expect(restored.activeRuns).toBe(0);
});

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(VIEWER.email);
  await page.locator("#password").fill(VIEWER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/overview(?:\?.*)?$/);
  await expect(
    page.getByRole("heading", { name: "Overview", level: 1 }),
  ).toBeVisible();
}

function trackPageErrors(page: Page, label: string): void {
  page.on("pageerror", (error) => {
    browserErrors.push(`${label} pageerror: ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(`${label} console: ${message.text()}`);
    }
  });
}

async function newViewerPage(browser: Browser, label: string): Promise<Page> {
  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:4321",
    viewport: { width: 1280, height: 1000 },
  });
  contexts.push(context);
  await context.addInitScript(() => {
    const target = window as PrintWindow;
    target.__probedeskPrintCalls = 0;
    window.print = () => {
      target.__probedeskPrintCalls = (target.__probedeskPrintCalls ?? 0) + 1;
    };
  });
  const page = await context.newPage();
  await signIn(page);
  trackPageErrors(page, label);
  return page;
}

async function readCanvasPixels(canvas: Locator): Promise<CanvasPixels> {
  return canvas.evaluate((element) => {
    const surface = element as HTMLCanvasElement;
    const context = surface.getContext("2d");
    if (context === null || surface.width === 0 || surface.height === 0) {
      return {
        width: surface.width,
        height: surface.height,
        painted: 0,
        spanX: 0,
        redPixels: 0,
      };
    }

    const pixels = context.getImageData(
      0,
      0,
      surface.width,
      surface.height,
    ).data;
    let painted = 0;
    let minX = surface.width;
    let maxX = -1;
    let redPixels = 0;

    for (let y = 0; y < surface.height; y += 1) {
      for (let x = 0; x < surface.width; x += 1) {
        const offset = (y * surface.width + x) * 4;
        const alpha = pixels[offset + 3] ?? 0;
        if (alpha === 0) continue;
        painted += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        const red = pixels[offset] ?? 0;
        const green = pixels[offset + 1] ?? 0;
        const blue = pixels[offset + 2] ?? 0;
        if (red > 120 && green < 90 && blue < 90) redPixels += 1;
      }
    }

    return {
      width: surface.width,
      height: surface.height,
      painted,
      spanX: maxX >= 0 ? maxX - minX + 1 : 0,
      redPixels,
    };
  });
}

async function expectPaintedChart(
  canvas: Locator,
  options: { readonly wide?: boolean; readonly failure?: boolean } = {},
): Promise<CanvasPixels> {
  await expect
    .poll(async () => (await readCanvasPixels(canvas)).painted, {
      timeout: 60_000,
    })
    .toBeGreaterThan(500);
  const pixels = await readCanvasPixels(canvas);
  expect(pixels.width).toBeGreaterThan(0);
  expect(pixels.height).toBeGreaterThan(0);
  if (options.wide) {
    expect(pixels.spanX).toBeGreaterThan(pixels.width * 0.8);
  }
  if (options.failure) {
    expect(pixels.redPixels).toBeGreaterThan(0);
  }
  return pixels;
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

async function downloadReport(
  page: Page,
  format: "csv" | "json",
  runId: string,
): Promise<Buffer> {
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", {
      name: format === "csv" ? "Download CSV" : "Download JSON",
    })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    `probedesk-run-${runId.toLowerCase()}.${format}`,
  );
  return readDownload(download);
}

async function prepareAndPrint(
  page: Page,
  expectedCharts: number,
  pdfPath: string,
): Promise<void> {
  await expect(
    page.getByRole("button", { name: "Print / Save PDF" }),
  ).toBeEnabled({ timeout: 120_000 });
  await page.getByRole("button", { name: "Print / Save PDF" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as PrintWindow).__probedeskPrintCalls ?? 0),
    )
    .toBe(1);
  await expect(page.locator("body")).toHaveClass(/pd-print-report/);
  await expect(page.locator("app-report-chart .print-chart")).toHaveCount(
    expectedCharts,
  );

  const printCharts = page.locator("app-report-chart .print-chart");
  for (let index = 0; index < expectedCharts; index += 1) {
    const chart = printCharts.nth(index);
    await expect(chart).toHaveAttribute("src", /^data:image\/png;base64,/);
    await expect
      .poll(() =>
        chart.evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
  }
  await expect(page.locator(".print-warning")).toBeHidden();

  await page.emulateMedia({ media: "print" });
  await expect
    .poll(() =>
      page
        .locator(".report-actions")
        .first()
        .evaluate((element) => getComputedStyle(element).display),
    )
    .toBe("none");
  await expect
    .poll(() =>
      page
        .locator("app-report-chart .chart-frame")
        .first()
        .evaluate((element) => getComputedStyle(element).display),
    )
    .toBe("none");
  await expect
    .poll(() =>
      printCharts
        .first()
        .evaluate((element) => getComputedStyle(element).display),
    )
    .toBe("block");

  await page.pdf({
    path: pdfPath,
    format: "A4",
    margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" },
    printBackground: true,
  });
  await page.emulateMedia({ media: "screen" });
}

function tenThousandFixture() {
  const steps: EdgeFixtureStepInput[] = Array.from(
    { length: 10 },
    (_, index) => ({
      name:
        index === 0
          ? "Step 01 Output Voltage - long snapshot name used to verify wrapping in the printed report"
          : `Step ${String(index + 1).padStart(2, "0")} Output Voltage`,
      unit: "V",
      minimum: "4.750000",
      maximum: "5.250000",
      sampleCount: 1000,
      intervalMs: 100,
      status: "COMPLETED" as const,
      outcome: "PASSED" as const,
    }),
  );

  return {
    planName: LONG_PLAN_NAME,
    deviceName: LONG_DEVICE_NAME,
    deviceSerial: LONG_DEVICE_SERIAL,
    batchNumber: LONG_BATCH,
    status: "COMPLETED" as const,
    outcome: "PASSED" as const,
    startedAt: "2026-11-01T10:00:00.000Z",
    finishedAt: "2026-11-01T10:16:40.000Z",
    steps,
  };
}

test("real 10,000 measurements render, print and export through the report stack", async ({
  browser,
}) => {
  test.setTimeout(600_000);
  const fixture = await seedEdgeFixture(tenThousandFixture(), tracker);
  expect(fixture.expectedSampleCount).toBe(10_000);
  expect(fixture.recordedSampleCount).toBe(10_000);

  const page = await newViewerPage(browser, "viewer-10k");
  await page.goto(`/runs/${fixture.runId}/report`);
  await expect(page.locator("article.report-document")).toBeVisible({
    timeout: 120_000,
  });
  await expect(page.locator(".report-heading h1")).toHaveText(LONG_PLAN_NAME);
  await expect(page.locator(".report-heading")).toContainText(
    "Simulated test results",
  );
  await expect(page.locator(".report-heading")).toContainText(
    "Published version 1",
  );
  await expect(
    page.locator(".report-heading p").filter({ hasText: "Recorded samples:" }),
  ).toContainText("10000 / 10000");
  await expect(page.locator(".report-heading")).toContainText(
    `Run ID: ${fixture.runId}`,
  );

  const metadata = page.locator("app-run-device-metadata .metadata");
  await expect(metadata).toContainText("Recorded device");
  await expect(metadata).toContainText(`${LONG_DEVICE_NAME} · `);
  await expect(metadata).toContainText(LONG_DEVICE_SERIAL);
  await expect(metadata).toContainText(LONG_BATCH);

  const steps = page.locator("section.report-step");
  await expect(steps).toHaveCount(10);
  for (const [index, step] of fixture.steps.entries()) {
    await expect(steps.nth(index).locator("h2")).toContainText(
      `${step.position}. ${step.name}`,
    );
    await expect(steps.nth(index).locator(".chart-summary")).toContainText(
      "1000 recorded samples",
    );
  }

  const canvases = page.locator("app-report-chart canvas");
  await expect(canvases).toHaveCount(10);
  for (let index = 0; index < 10; index += 1) {
    const pixels = await expectPaintedChart(canvases.nth(index), {
      wide: true,
    });
    expect(pixels.painted).toBeGreaterThan(500);
  }

  const csv = (await downloadReport(page, "csv", fixture.runId)).toString(
    "utf8",
  );
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  const csvLines = csv.slice(1).split("\r\n");
  expect(csvLines.at(-1)).toBe("");
  expect(csvLines[0]).toBe(CSV_HEADER.join(","));
  const dataLines = csvLines.slice(1, -1);
  expect(dataLines).toHaveLength(10_000);

  const firstCells = dataLines[0]!.split(",");
  const lastCells = dataLines.at(-1)!.split(",");
  const firstStep = fixture.steps[0]!;
  const lastStep = fixture.steps.at(-1)!;
  expect(firstCells).toHaveLength(CSV_HEADER.length);
  expect(firstCells[0]).toBe(fixture.runId);
  expect(firstCells[1]).toBe(LONG_PLAN_NAME);
  expect(firstCells[2]).toBe("1");
  expect(firstCells[3]).toBe(LONG_DEVICE_NAME);
  expect(firstCells[4]).toBe(LONG_DEVICE_SERIAL);
  expect(firstCells[5]).toBe(LONG_BATCH);
  expect(firstCells[6]).toBe("NORMAL");
  expect(firstCells[7]).toBe("COMPLETED");
  expect(firstCells[8]).toBe("PASSED");
  expect(firstCells[9]).toBe("1");
  expect(firstCells[10]).toBe(firstStep.name);
  expect(firstCells[11]).toBe("V");
  expect(firstCells[12]).toBe("4.750000");
  expect(firstCells[13]).toBe("5.250000");
  expect(firstCells[14]).toBe("0");
  expect(firstCells[15]).toBe(firstStep.values[0]);
  expect(firstCells[16]).toBe("0");
  expect(firstCells[17]).toBe("2026-11-01T10:00:00.000Z");
  expect(firstCells[18]).toBe("true");

  expect(lastCells).toHaveLength(CSV_HEADER.length);
  expect(lastCells[9]).toBe("10");
  expect(lastCells[10]).toBe(lastStep.name);
  expect(lastCells[14]).toBe("999");
  expect(lastCells[15]).toBe(lastStep.values[999]);
  expect(lastCells[16]).toBe("99900");
  expect(lastCells[18]).toBe("true");
  for (const line of dataLines) {
    const cells = line.split(",");
    expect(cells).toHaveLength(CSV_HEADER.length);
    expect(cells[15]).toMatch(/^-?\d+\.\d{6}$/);
    expect(cells[18]).toBe("true");
  }

  const json = JSON.parse(
    (await downloadReport(page, "json", fixture.runId)).toString("utf8"),
  ) as ExportedReport;
  expect(json.schemaVersion).toBe(1);
  expect(json.runId).toBe(fixture.runId);
  expect(json.planId).toBe(fixture.planId);
  expect(json.planVersionId).toBe(fixture.revisionId);
  expect(json.planName).toBe(LONG_PLAN_NAME);
  expect(json.versionNumber).toBe(1);
  expect(json.deviceId).toBe(fixture.deviceId);
  expect(json.deviceSnapshot).toMatchObject({
    id: fixture.deviceId,
    name: LONG_DEVICE_NAME,
    serialNumber: LONG_DEVICE_SERIAL,
  });
  expect(json.batchNumber).toBe(LONG_BATCH);
  expect(json.scenario).toBe("NORMAL");
  expect(json.status).toBe("COMPLETED");
  expect(json.outcome).toBe("PASSED");
  expect(json.expectedSampleCount).toBe(10_000);
  expect(json.recordedSampleCount).toBe(10_000);
  expect(json.requestedBy).toMatchObject({
    email: OPERATOR.email,
    role: "OPERATOR",
  });
  expect(json.steps).toHaveLength(10);
  let sampleTotal = 0;
  for (const [index, step] of json.steps.entries()) {
    const source = fixture.steps[index]!;
    expect(step.position).toBe(source.position);
    expect(step.name).toBe(source.name);
    expect(step.unit).toBe("V");
    expect(step.minimum).toBe("4.750000");
    expect(step.maximum).toBe("5.250000");
    expect(step.sampleCount).toBe(1000);
    expect(step.recordedCount).toBe(1000);
    expect(step.status).toBe("COMPLETED");
    expect(step.outcome).toBe("PASSED");
    expect(step.outOfToleranceCount).toBe(0);
    expect(step.measurements).toHaveLength(1000);
    sampleTotal += step.measurements.length;
    expect(step.measurements[0]).toMatchObject({
      sampleIndex: 0,
      value: source.values[0],
      elapsedMs: 0,
      isWithinTolerance: true,
    });
    expect(step.measurements[999]).toMatchObject({
      sampleIndex: 999,
      value: source.values[999],
      elapsedMs: 99_900,
      isWithinTolerance: true,
    });
  }
  expect(sampleTotal).toBe(10_000);
  const exportedKeys = collectKeys(json);
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

  // Long plan/device/step/table text must not widen the document at 390 px.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("article.report-document")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    )
    .toBe(0);
  const rulesRegion = page
    .locator("section.report-step .pd-table-wrap")
    .first();
  await expect
    .poll(() =>
      rulesRegion.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      ),
    )
    .toBe(true);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    )
    .toBeLessThanOrEqual(0);

  await prepareAndPrint(
    page,
    10,
    test.info().outputPath("ex12-10k-report.pdf"),
  );

  expect(browserErrors).toEqual([]);
});

test("failed report preserves the backend verdict, negative decimal and printed failure evidence", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const fixture = await seedEdgeFixture(
    {
      planName: `EX-12 failed report fixture ${SUFFIX}`,
      deviceName: `EX12 Edge Failed Device ${SUFFIX}`,
      deviceSerial: `EX12/FAILED-${SUFFIX}`,
      batchNumber: `EX12-FAILED-BATCH-${SUFFIX}`,
      status: "COMPLETED",
      outcome: "FAILED",
      scenario: "FORCED_FAILURE",
      startedAt: "2026-11-02T09:00:00.000Z",
      finishedAt: "2026-11-02T09:00:10.000Z",
      steps: [
        {
          name: "Step 01 Supply Rail Passed",
          unit: "V",
          minimum: "0.000000",
          maximum: "10.000000",
          sampleCount: 4,
          intervalMs: 100,
          status: "COMPLETED",
          outcome: "PASSED",
        },
        {
          name: "Step 02 Negative Rail Failed",
          unit: "V",
          minimum: "-1.000000",
          maximum: "1.000000",
          sampleCount: 4,
          intervalMs: 100,
          status: "COMPLETED",
          outcome: "FAILED",
          failureSampleIndex: 1,
          failureValue: "-1.500000",
        },
      ],
    },
    tracker,
  );

  const page = await newViewerPage(browser, "viewer-failed");
  await page.goto(`/runs/${fixture.runId}/report`);
  await expect(page.locator("article.report-document")).toBeVisible();
  await expect(page.locator(".report-heading .status-label")).toHaveText(
    "Failed",
  );
  await expect(
    page
      .locator(".metadata-grid > div")
      .filter({ hasText: "Scenario" })
      .locator("dd"),
  ).toHaveText("Forced failure");
  await expect(page.getByText(/Partial result:/)).toHaveCount(0);

  const steps = page.locator("section.report-step");
  await expect(steps).toHaveCount(2);
  await expect(steps.nth(0).locator(".pd-table tbody tr td").nth(4)).toHaveText(
    "0",
  );
  await expect(steps.nth(1).locator(".pd-table tbody tr td").nth(0)).toHaveText(
    "V",
  );
  await expect(steps.nth(1).locator(".pd-table tbody tr td").nth(1)).toHaveText(
    "-1.000000",
  );
  await expect(steps.nth(1).locator("td").nth(4)).toHaveText("1");
  const failureStepStats = steps.nth(1).locator(".statistics dd");
  await expect(failureStepStats.nth(0)).toHaveText("-1.500000");
  await expect(failureStepStats.nth(1)).toHaveText(
    fixture.steps[1]!.statistics!.maximum,
  );
  await expect(failureStepStats.nth(2)).toHaveText(
    fixture.steps[1]!.statistics!.average,
  );
  await expect(failureStepStats.nth(3)).toHaveText("4");
  await expect(failureStepStats.nth(4)).toHaveText("1");
  await expect(steps.nth(1).locator(".chart-summary")).toContainText(
    "1 recorded sample is outside tolerance. First failing sample index: 1.",
  );

  const canvases = page.locator("app-report-chart canvas");
  await expect(canvases).toHaveCount(2);
  await expectPaintedChart(canvases.nth(1), { failure: true });
  for (let index = 0; index < 2; index += 1) {
    await expectPaintedChart(canvases.nth(index), { wide: true });
  }

  const csv = (await downloadReport(page, "csv", fixture.runId)).toString(
    "utf8",
  );
  const lines = csv.slice(1).split("\r\n");
  expect(lines[0]).toBe(CSV_HEADER.join(","));
  expect(lines.slice(1, -1)).toHaveLength(8);
  for (const line of lines.slice(1, -1)) {
    const cells = line.split(",");
    expect(cells).toHaveLength(CSV_HEADER.length);
    expect(cells[1]).toBe(fixture.planName);
    expect(cells[6]).toBe("FORCED_FAILURE");
    expect(cells[7]).toBe("COMPLETED");
    expect(cells[8]).toBe("FAILED");
    if (cells[9] === "2") {
      expect(cells[12]).toBe("-1.000000");
      expect(cells[13]).toBe("1.000000");
      if (cells[14] === "1") {
        expect(cells[15]).toBe("-1.500000");
        expect(cells[18]).toBe("false");
      }
    }
  }

  const json = JSON.parse(
    (await downloadReport(page, "json", fixture.runId)).toString("utf8"),
  ) as ExportedReport;
  expect(json.status).toBe("COMPLETED");
  expect(json.outcome).toBe("FAILED");
  expect(json.scenario).toBe("FORCED_FAILURE");
  expect(json.steps[1]!.outOfToleranceCount).toBe(1);
  expect(json.steps[1]!.firstFailureSampleIndex).toBe(1);
  expect(json.steps[1]!.statistics.minimum).toBe("-1.500000");
  expect(json.steps[1]!.measurements[1]!.value).toBe("-1.500000");
  expect(json.steps[1]!.measurements[1]!.isWithinTolerance).toBe(false);
  await expect(page.locator(".report-heading .status-label")).toHaveText(
    "Failed",
  );

  await prepareAndPrint(
    page,
    2,
    test.info().outputPath("ex12-failed-report.pdf"),
  );

  expect(browserErrors).toEqual([]);
});

test("cancelled partial report shows missing samples honestly in DOM, CSV, JSON and print", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const fixture = await seedEdgeFixture(
    {
      planName: `EX-12 partial report fixture ${SUFFIX}`,
      deviceName: `EX12 Edge Partial Device ${SUFFIX}`,
      deviceSerial: `EX12/PARTIAL-${SUFFIX}`,
      batchNumber: `EX12-PARTIAL-BATCH-${SUFFIX}`,
      status: "CANCELLED",
      outcome: null,
      reasonCode: "USER_CANCELLED",
      startedAt: "2026-11-03T08:00:00.000Z",
      finishedAt: "2026-11-03T08:00:30.000Z",
      steps: [
        {
          name: "Step 01 Completed Stage",
          unit: "V",
          minimum: "0.000000",
          maximum: "5.000000",
          sampleCount: 4,
          intervalMs: 100,
          status: "COMPLETED",
          outcome: "PASSED",
        },
        {
          name: "Step 02 Cancelled Mid-Stage",
          unit: "A",
          minimum: "0.000000",
          maximum: "2.000000",
          sampleCount: 4,
          intervalMs: 100,
          recordedCount: 2,
          status: "CANCELLED",
          outcome: null,
        },
        {
          name: "Step 03 Never Started",
          unit: "C",
          minimum: "20.000000",
          maximum: "60.000000",
          sampleCount: 4,
          intervalMs: 100,
          recordedCount: 0,
          status: "NOT_RUN",
          outcome: null,
        },
      ],
    },
    tracker,
  );
  expect(fixture.recordedSampleCount).toBe(6);
  expect(fixture.expectedSampleCount).toBe(12);

  const page = await newViewerPage(browser, "viewer-partial");
  await page.goto(`/runs/${fixture.runId}/report`);
  await expect(page.locator("article.report-document")).toBeVisible();
  await expect(page.locator(".report-heading .status-label")).toHaveText(
    "Cancelled",
  );
  await expect(page.locator(".report-heading .pd-notice")).toHaveText(
    "Partial result: CANCELLED. Missing samples and unavailable statistics are not inferred.",
  );
  await expect(
    page.locator(".report-heading p").filter({ hasText: "Recorded samples:" }),
  ).toContainText("6 / 12");

  const steps = page.locator("section.report-step");
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(0).locator("h2")).toHaveText(
    "1. Step 01 Completed Stage",
  );
  await expect(steps.nth(0).locator("p").first()).toContainText(
    "Completed · Passed · Recorded 4 / 4 samples",
  );
  await expect(steps.nth(1).locator("p").first()).toContainText(
    /Cancelled .*Recorded 2 \/ 4 samples/,
  );
  for (const index of [0, 1, 2, 3]) {
    await expect(steps.nth(1).locator(".statistics dd").nth(index)).toHaveText(
      "Not available",
    );
  }
  await expect(steps.nth(1).locator(".statistics dd").nth(4)).toHaveText(
    "None recorded",
  );
  await expect(steps.nth(2).locator("p").first()).toContainText(
    /Not run .*Recorded 0 \/ 4 samples/,
  );
  await expect(steps.nth(2).getByText("No samples recorded.")).toBeVisible();
  await expect(steps.nth(2).locator(".chart-summary")).toContainText(
    "No samples were recorded for step 3",
  );

  const canvases = page.locator("app-report-chart canvas");
  await expect(canvases).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) {
    // The partial and not-run steps still draw their copied tolerance rules.
    await expectPaintedChart(canvases.nth(index));
  }

  const csv = (await downloadReport(page, "csv", fixture.runId)).toString(
    "utf8",
  );
  const lines = csv.slice(1).split("\r\n");
  expect(lines[0]).toBe(CSV_HEADER.join(","));
  const rows = lines.slice(1, -1).map((line) => line.split(","));
  expect(rows).toHaveLength(6);
  expect(rows.filter((cells) => cells[9] === "1")).toHaveLength(4);
  expect(rows.filter((cells) => cells[9] === "2")).toHaveLength(2);
  expect(rows.filter((cells) => cells[9] === "3")).toHaveLength(0);
  expect(rows.map((cells) => cells[14])).toEqual([
    "0",
    "1",
    "2",
    "3",
    "0",
    "1",
  ]);

  const json = JSON.parse(
    (await downloadReport(page, "json", fixture.runId)).toString("utf8"),
  ) as ExportedReport;
  expect(json.status).toBe("CANCELLED");
  expect(json.outcome).toBeNull();
  expect(json.reasonCode).toBe("USER_CANCELLED");
  expect(json.expectedSampleCount).toBe(12);
  expect(json.recordedSampleCount).toBe(6);
  expect(json.steps.map((step) => step.status)).toEqual([
    "COMPLETED",
    "CANCELLED",
    "NOT_RUN",
  ]);
  expect(json.steps.map((step) => step.measurements.length)).toEqual([4, 2, 0]);
  expect(json.steps[1]!.statistics).toEqual({
    minimum: null,
    maximum: null,
    average: null,
    sampleCount: null,
  });
  expect(json.steps[2]!.recordedCount).toBe(0);
  expect(json.steps[2]!.statistics.minimum).toBeNull();

  await prepareAndPrint(
    page,
    3,
    test.info().outputPath("ex12-partial-report.pdf"),
  );

  expect(browserErrors).toEqual([]);
});
