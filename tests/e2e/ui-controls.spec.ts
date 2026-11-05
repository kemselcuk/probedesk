import { expect, test } from "@playwright/test";

// Real browser / API, seeded accounts. Read-only apart from the login session.
// No plan/run fixture, deletion, or cleanup against the user's delivery DB.
test("selection edges, calendar dates and table gutters remain usable", async ({
  page,
}) => {
  await page.goto("/login");
  await page.locator("#email").fill("operator@probedesk.local");
  await page.locator("#password").fill("OperatorDemo!2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/plans$/);

  await page.goto("/compare");
  for (const id of ["compare-left-run", "compare-right-run"]) {
    const select = page.locator(`#${id}`);
    const field = page.locator("mat-form-field").filter({ has: select });
    const box = await field.boundingBox();
    expect(box).not.toBeNull();
    // Both outer edges and the arrow side, not just the text trigger.
    for (const x of [3, box!.width / 2, box!.width - 3]) {
      await field.click({ position: { x, y: box!.height / 2 } });
      await expect(select).toHaveAttribute("aria-expanded", "true");
      await page.keyboard.press("Escape");
      await expect(select).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByRole("listbox")).toHaveCount(0);
    }
  }

  await page.goto("/runs?from=2026-11-01&to=2026-11-07");
  await expect(page.locator("#history-from")).toHaveValue("2026-11-01");
  await expect(page.locator("#history-to")).toHaveValue("2026-11-07");
  await page.getByRole("button", { name: "Choose to date" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const response = page.waitForResponse(
    (r) => r.url().includes("/api/runs?") && r.url().includes("2026-11-06"),
  );
  await page
    .getByRole("button", { name: "November 6, 2026", exact: true })
    .click();
  const request = new URL((await response).url());
  expect(request.searchParams.get("from")).toBe("2026-11-01T00:00:00.000Z");
  expect(request.searchParams.get("to")).toBe("2026-11-06T00:00:00.000Z");
  await expect(page).toHaveURL(/to=2026-11-06/);

  await page.locator("#history-to").fill("2026-02-30");
  await page.locator("#history-to").blur();
  await expect(
    page.getByText("Enter a valid date as YYYY-MM-DD."),
  ).toBeVisible();
  await expect(page).toHaveURL(/to=2026-11-06/);
  await page.locator("#history-to").fill("");
  await expect(page).not.toHaveURL(/to=/);

  await page.goto("/runs");
  await expect(page.locator("tbody tr").first()).toBeVisible();
  const problems = await page.locator("table.pd-table").evaluate((table) => {
    const rows = [...table.querySelectorAll("tbody tr")];
    return rows.flatMap((row) => {
      const first = row.firstElementChild!;
      const last = row.lastElementChild!;
      const start = parseFloat(getComputedStyle(first).paddingInlineStart);
      const end = parseFloat(getComputedStyle(last).paddingInlineEnd);
      const badge = row.querySelector(".status-badge");
      const cell = badge?.closest("td");
      const rect = badge?.getBoundingClientRect();
      const cellRect = cell?.getBoundingClientRect();
      return [
        ...(start !== 16 || end !== 16 ? ["asymmetric gutters"] : []),
        ...(rect && cellRect && rect.right > cellRect.right - 8
          ? ["badge crosses cell edge"]
          : []),
      ];
    });
  });
  expect(problems).toEqual([]);
});
