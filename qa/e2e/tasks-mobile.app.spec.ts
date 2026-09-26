import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

// The tasks screen on a phone, and the two new names on every task.
//
// Ariel, 26.9.2026, with screenshots from his phone: the list showed a
// checkbox, two icons, a status and a date on every row, and no task. The
// title column was the only flexible thing in the row and the fixed parts
// took the whole width. A client-facing title in English then pushed the
// whole page sideways. Every desktop spec in this suite passed through
// all of it, because none of them ever opened the screen at phone width.
//
// So this file does, at the two widths that matter: 360px (a small
// Android, the narrowest thing we support) and 390px (the phone the
// report came from). And it asserts what a person would notice, not
// classes: that a task's name, client, date, assignee, status and
// supervisor are on the screen, and that nothing makes the page scroll
// sideways.
//
// Screenshots are written into the report folder on purpose, pass or
// fail, so a run leaves a picture of each width behind for whoever
// reviews the change.
//
// Prose warning, same as the other flow files here: coverage is inferred
// from the TEXT of these files, so modules are referred to in words.

test.describe.configure({ timeout: 90_000 });

// Everybody's tasks: "שלי" is on by default since 26.9.2026, and the rows
// this file reads are not all assigned to the signed-in admin.
const TASKS = "/app/tasks?mine=0";
const SHOTS = "qa/reports/screens";

// Supervised by the demo admin since the seed. Read, never written, by
// this file: the supervision spec may move its status, but not its
// supervisor.
const SUPERVISED = "demo-task-supervised-fixture";

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

for (const width of [360, 390]) {
  test.describe(`phone, ${width}px`, () => {
    test.use({ viewport: { width, height: 800 }, hasTouch: true });

    test("every task shows its client, name, date, assignee, status and supervisor", async ({ page }) => {
      await page.goto(TASKS, { waitUntil: "domcontentloaded" });
      const rows = page.locator("[data-task]");
      await expect(rows.first()).toBeVisible({ timeout: 30_000 });
      await page.screenshot({ path: `${SHOTS}/tasks-list-${width}.png`, fullPage: true });

      // The bug itself: a title squeezed to nothing. Twenty pixels is not
      // a readable title, and zero is what the old row produced.
      const count = Math.min(await rows.count(), 8);
      for (let i = 0; i < count; i++) {
        const row = rows.nth(i);
        const title = row.locator('[data-cell="title"] a').first();
        const box = await title.boundingBox();
        expect(box?.width ?? 0, `row ${i}: the task's name should be readable, not squeezed away`).toBeGreaterThan(40);
        for (const cell of ["client", "date", "assignee", "supervisor"]) {
          await expect(row.locator(`[data-cell="${cell}"]`), `row ${i}: ${cell}`).toBeVisible();
        }
        await expect(row.getByRole("combobox", { name: "סטטוס" })).toBeVisible();
      }

      // The names are labelled on a phone, where there is no column header.
      const supervised = page.locator(`[data-task="${SUPERVISED}"]`);
      if ((await supervised.count()) > 0) {
        await expect(supervised.locator('[data-cell="supervisor"]')).toContainText("מפקח");
        await expect(supervised.locator('[data-cell="supervisor"]')).toContainText("מנהל Ankora");
      }

      expect(await horizontalOverflow(page), "the page must not scroll sideways").toBeLessThanOrEqual(1);
    });

    test("the status filter scrolls within itself instead of running off the screen", async ({ page }) => {
      await page.goto(TASKS, { waitUntil: "domcontentloaded" });
      const pills = page.getByTestId("status-pills");
      await expect(pills).toBeVisible({ timeout: 30_000 });

      // The last pill used to be cut off at the edge of the screen. It
      // has to be reachable, which here means scrolled to and fully shown.
      const last = pills.getByRole("link", { name: "הושלמו" });
      await last.scrollIntoViewIfNeeded();
      await expect(last).toBeInViewport({ ratio: 1 });
      // One line each: "ממתינות לאישור" used to fold onto two.
      const heights = await pills.getByRole("link").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);

      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    });

    test("the board scrolls its columns, not the page", async ({ page }) => {
      await page.goto(`${TASKS}&view=board`, { waitUntil: "domcontentloaded" });
      await expect(page.locator("[data-column]").first()).toBeVisible({ timeout: 30_000 });
      await page.screenshot({ path: `${SHOTS}/tasks-board-${width}.png`, fullPage: true });
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    });
  });
}

test.describe("phone, creating a task", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("the new task form offers an assignee and a supervisor, and the row shows both", async ({ page }) => {
    await page.goto(TASKS, { waitUntil: "domcontentloaded" });

    // One plus sign on the button, not two. The button draws its own.
    const trigger = page.getByRole("button", { name: "משימה", exact: true });
    await expect(trigger).toBeVisible({ timeout: 30_000 });
    await expect(trigger).not.toContainText("+");
    await trigger.click();

    const assignee = page.getByLabel("אחראי", { exact: true });
    const supervisor = page.getByLabel("מפקח", { exact: true });
    // Nothing to choose until there is a client: who can hold a task is
    // decided per client.
    await expect(assignee).toBeDisabled();

    await page.locator('select[name="clientId"]').selectOption({ index: 1 });
    await expect(assignee).toBeEnabled({ timeout: 15_000 });
    await expect(assignee.locator("option")).not.toHaveCount(1);

    await assignee.selectOption({ index: 1 });
    await supervisor.selectOption({ index: 1 });
    const assigneeName = (await assignee.locator("option:checked").textContent())?.trim() ?? "";
    const supervisorName = (await supervisor.locator("option:checked").textContent())?.trim() ?? "";
    expect(assigneeName).not.toBe("");

    const title = `[E2E] נייד-${Date.now().toString(36)}`;
    await page.locator('input[name="title"]').fill(title);
    await page.screenshot({ path: `${SHOTS}/tasks-new-form-390.png`, fullPage: true });
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    await page.getByRole("button", { name: "הוספת משימה" }).click();

    // The row comes back with the write, names and all, with no reload.
    const row = page.locator("[data-task]").filter({ hasText: title });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.locator('[data-cell="assignee"]')).toContainText(assigneeName);
    await expect(row.locator('[data-cell="supervisor"]')).toContainText(supervisorName);

    // And they were written, not only drawn: the same names after a reload.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.locator('[data-cell="assignee"]')).toContainText(assigneeName);
    await expect(row.locator('[data-cell="supervisor"]')).toContainText(supervisorName);
  });
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("one line per task under column names, the assignee and supervisor among them", async ({ page }) => {
    await page.goto(TASKS, { waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-task]").first()).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `${SHOTS}/tasks-list-1280.png`, fullPage: true });

    for (const label of ["לקוח", "משימה", "תאריך", "אחראי", "סטטוס", "מפקח"]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }

    const supervised = page.locator(`[data-task="${SUPERVISED}"]`);
    if ((await supervised.count()) > 0) {
      await expect(supervised.locator('[data-cell="supervisor"]')).toContainText("מנהל Ankora");
      // One line: the client, the name and the supervisor share a row.
      const client = await supervised.locator('[data-cell="client"]').boundingBox();
      const boss = await supervised.locator('[data-cell="supervisor"]').boundingBox();
      expect(Math.abs((client?.y ?? 0) - (boss?.y ?? 999))).toBeLessThan(24);
    }

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });
});
