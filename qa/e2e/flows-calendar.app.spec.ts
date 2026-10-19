import { test, expect } from "./fixtures";

// The calendar, from the side of somebody planning a week on it.
//
// Three things are asserted: dragging a task from the "no due date" panel
// onto a day writes that day; dragging it back onto the panel removes it;
// and opening a task from the calendar and going back lands on the same
// view, day and filters, both by the task screen's own back link and by
// the browser's back button.
//
// The drag is dispatched rather than driven with the mouse, for the
// reason the board spec gives: Playwright's mouse does not produce
// dragstart and drop in Chromium.
//
// The drag test writes through the calendar's Server Action, which this
// file cannot name in a path:
// @covers action:(product)/app/(authenticated)/calendar/actions
//
// Prose warning, as in the other flow files: coverage is inferred from
// the text of these files, so modules are referred to in words.

test.describe.configure({ timeout: 90_000, mode: "serial" });

// This spec's own task, seeded with no due date and moved by nothing else.
const TASK = "demo-task-calendar-fixture";

// A fixed week far from today, so nothing else seeded lands in it and
// the cells the spec drops on are always drawn. 6.1.2030 is a Sunday.
const WEEK = "/app/calendar?date=2030-01-08&mine=0&show=tasks";
const DAY = "2030-01-09";

async function dragTo(page: import("@playwright/test").Page, taskId: string, day: string) {
  await page.evaluate(
    ({ taskId, day }) => {
      const card = Array.from(document.querySelectorAll(`[data-calendar-task="${taskId}"]`)).find(
        (el) => (el as HTMLElement).offsetParent !== null
      );
      const target = Array.from(document.querySelectorAll(`[data-day="${day}"]`)).find(
        (el) => (el as HTMLElement).offsetParent !== null
      );
      if (!card || !target) throw new Error(`missing task ${taskId} or day ${day}`);
      const dataTransfer = new DataTransfer();
      card.dispatchEvent(new DragEvent("dragstart", { dataTransfer, bubbles: true }));
      target.dispatchEvent(new DragEvent("dragover", { dataTransfer, bubbles: true, cancelable: true }));
      target.dispatchEvent(new DragEvent("drop", { dataTransfer, bubbles: true, cancelable: true }));
    },
    { taskId, day }
  );
}

function inCell(page: import("@playwright/test").Page, day: string) {
  return page.locator(`[data-day="${day}"]:visible [data-calendar-task="${TASK}"]`);
}

function inPanel(page: import("@playwright/test").Page) {
  return page.locator(`[data-testid="calendar-undated"] [data-calendar-task="${TASK}"]`);
}

/// Waited on BEFORE any reload: the move is optimistic, so the screen
/// changes while the write is still in flight, and a reload then would
/// cancel it. The board learned this in #102.
function nextWrite(page: import("@playwright/test").Page) {
  return page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400, { timeout: 30_000 });
}

test("the calendar draws a week with its controls and the undated panel", async ({ page }) => {
  await page.goto("/app/calendar", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "יומן", level: 1 })).toBeVisible({ timeout: 30_000 });
  for (const testId of ["calendar-view", "calendar-show", "calendar-mine", "calendar-client", "calendar-undated"]) {
    await expect(page.getByTestId(testId)).toBeVisible();
  }
});

test("a task dragged from the panel gets that day, and back again loses it", async ({ page }) => {
  await page.goto(WEEK, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("calendar-undated")).toBeVisible({ timeout: 30_000 });

  // A retry can find the task where the last attempt left it.
  if ((await inCell(page, DAY).count()) > 0) {
    const wrote = nextWrite(page);
    await dragTo(page, TASK, "undated");
    await wrote;
  }
  await expect(inPanel(page)).toBeVisible({ timeout: 30_000 });

  let wrote = nextWrite(page);
  await dragTo(page, TASK, DAY);
  await expect(inCell(page, DAY)).toBeVisible({ timeout: 30_000 });
  await wrote;
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(inCell(page, DAY)).toBeVisible({ timeout: 30_000 });
  await expect(inPanel(page)).toHaveCount(0);

  wrote = nextWrite(page);
  await dragTo(page, TASK, "undated");
  await expect(inPanel(page)).toBeVisible({ timeout: 30_000 });
  await wrote;
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(inPanel(page)).toBeVisible({ timeout: 30_000 });
});

test("opening a task and going back keeps the view and the filters", async ({ page }) => {
  const MONTH = "/app/calendar?view=month&date=2030-01-08&show=tasks&mine=0";
  await page.goto(MONTH, { waitUntil: "domcontentloaded" });
  await expect(inPanel(page)).toBeVisible({ timeout: 30_000 });

  await inPanel(page).locator("a").click();
  await page.waitForURL(new RegExp(`/app/tasks/${TASK}`), { timeout: 30_000 });

  // The task screen's own link says where it goes and goes there.
  const back = page.getByTestId("task-back");
  await expect(back).toHaveText(/חזרה ליומן/, { timeout: 30_000 });
  await back.click();
  await page.waitForURL(/\/app\/calendar\?/, { timeout: 30_000 });
  expect(new URL(page.url()).search).toBe("?view=month&date=2030-01-08&show=tasks&mine=0");

  // And the browser's back button, from the task again.
  await inPanel(page).locator("a").click();
  await page.waitForURL(new RegExp(`/app/tasks/${TASK}`), { timeout: 30_000 });
  await page.goBack({ waitUntil: "domcontentloaded" });
  expect(new URL(page.url()).search).toBe("?view=month&date=2030-01-08&show=tasks&mine=0");
  await expect(page.getByTestId("calendar-title")).toHaveText(/ינואר 2030/, { timeout: 30_000 });
});
