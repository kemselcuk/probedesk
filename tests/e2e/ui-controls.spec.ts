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

test('measurement columns stay grouped on wide screens and scroll locally on mobile', async ({ page }) => {
  await page.goto('/login');
  await page.locator('#email').fill('operator@probedesk.local');
  await page.locator('#password').fill('OperatorDemo!2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/plans$/);
  await page.goto('/runs');
  const details = page.getByRole('link', { name: /^View details for/ }).first();
  await expect(details).toBeVisible();
  await details.click();
  const table = page.locator('.pd-table--measurements:visible');
  await expect(table).toHaveCount(1);
  await expect(table.locator('tbody tr').first()).toBeVisible();
  const widths: number[] = [];
  for (const width of [1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    widths.push((await table.boundingBox())!.width);
  }
  expect(widths[1]).toBeLessThan(850);
  expect(Math.abs(widths[1] - widths[0])).toBeLessThan(1);
  const geometry = await table.evaluate(t => {
    const row = t.querySelector('tbody tr')!;
    const cells = [...row.querySelectorAll('td')];
    const time = row.querySelector('time')!;
    return {
      rowHeight: row.getBoundingClientRect().height,
      alignments: cells.map(c => getComputedStyle(c).textAlign),
      value: cells[1].textContent!.trim(),
      timestamp: time.textContent!.trim(),
      storedTimestamp: time.getAttribute('datetime'),
      fullTimestamp: time.getAttribute('title'),
    };
  });
  expect(geometry.rowHeight).toBeGreaterThanOrEqual(34);
  expect(geometry.rowHeight).toBeLessThanOrEqual(38);
  expect(geometry.alignments).toEqual(['right', 'right', 'right', 'left', 'left']);
  expect(geometry.value).toMatch(/^-?\d+\.\d{6}$/);
  expect(geometry.timestamp).toBe(geometry.storedTimestamp!.replace('T', ' ').replace('Z', ''));
  expect(geometry.fullTimestamp).toBe(geometry.storedTimestamp);
  await table.locator('tbody tr').first().click();
  await expect(table.locator('tbody tr').first()).toHaveAttribute('aria-current', 'true');

  await page.setViewportSize({ width: 390, height: 844 });
  const wrapper = table.locator('..');
  await wrapper.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  expect(await wrapper.evaluate(e => e.scrollWidth > e.clientWidth)).toBe(true);
  await wrapper.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => wrapper.evaluate(e => e.scrollLeft)).toBeGreaterThan(0);
});
