import { test, expect } from "./fixtures";

// The board, from the side of somebody moving work across it.
//
// Two things are asserted and the second is the one that matters.
//
// The first is that dragging a card writes. The second is that the board
// is not a second way to write: the drop calls the same Server Action the
// list's checkbox calls, so every rule the domain holds still holds here.
// A board that could close a supervised task, or a promise with nothing
// to say to the client, would be a hole that no test of the list would
// ever find.
//
// Native HTML5 drag and drop is dispatched here rather than driven with
// the mouse. Playwright's mouse movements do not produce dragstart and
// drop in Chromium, so a mouse-driven version of this test would pass by
// doing nothing at all, which is worse than no test.
//
// Prose warning, same as the other flow files here: coverage is inferred
// from the TEXT of these files, so a module named in a comment would hand
// itself credit it has not earned. Modules are referred to in words.

test.describe.configure({ timeout: 90_000 });

const BOARD = "/app/tasks?view=board";

// This file's own card. Seeded with a fixed id, internal, unsupervised,
// and read by nothing else: a card this spec drags is a card whose
// column it has to be able to predict.
const CARD = "demo-task-board-fixture";
const SUPERVISED = "demo-task-board-supervised";

/// Drag a card onto a column, the way a browser does it.
async function dragTo(page: import("@playwright/test").Page, taskId: string, status: string) {
  await page.evaluate(
    ({ taskId, status }) => {
      const card = document.querySelector(`[data-task-card="${taskId}"]`);
      const column = document.querySelector(`[data-column="${status}"]`);
      if (!card || !column) throw new Error(`missing card ${taskId} or column ${status}`);
      // One DataTransfer across all three events, which is what a real
      // drag has: the id written on dragstart is the id read on drop.
      const dataTransfer = new DataTransfer();
      card.dispatchEvent(new DragEvent("dragstart", { dataTransfer, bubbles: true }));
      column.dispatchEvent(new DragEvent("dragover", { dataTransfer, bubbles: true, cancelable: true }));
      column.dispatchEvent(new DragEvent("drop", { dataTransfer, bubbles: true, cancelable: true }));
    },
    { taskId, status }
  );
}

function cardIn(page: import("@playwright/test").Page, status: string, taskId: string) {
  return page.locator(`[data-column="${status}"] [data-task-card="${taskId}"]`);
}

test("the board shows the four live statuses as columns", async ({ page }) => {
  await page.goto(BOARD, { waitUntil: "domcontentloaded" });

  for (const label of ["פתוחות", "בביצוע", "ממתינות לאישור", "הושלמו"]) {
    await expect(page.getByRole("heading", { name: new RegExp(label) })).toBeVisible({ timeout: 30_000 });
  }

  // ARCHIVED deliberately has no column: archived work is not a stage of
  // anything, and a column for it would be a permanent graveyard beside
  // four live ones.
  await expect(page.locator('[data-column="ARCHIVED"]')).toHaveCount(0);
});

test("dragging a card moves the task, and it stays moved", async ({ page }) => {
  await page.goto(BOARD, { waitUntil: "domcontentloaded" });
  await expect(page.locator(`[data-task-card="${CARD}"]`)).toBeVisible({ timeout: 30_000 });

  // Where it is now, rather than where the seed put it: this group can
  // be retried, and a test that assumes its fixture is untouched is a
  // test that fails on its second attempt for no reason.
  const startedOpen = (await cardIn(page, "OPEN", CARD).count()) > 0;
  const to = startedOpen ? "IN_PROGRESS" : "OPEN";

  // Waited on BEFORE the reload, and this is not belt and braces. The
  // card moves optimistically, so the assertion below passes while the
  // write is still in flight, and a reload at that moment cancels it -
  // the test would then be asserting against its own aborted write. Four
  // tests in this suite were doing exactly that until #102.
  const wrote = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.status() < 400,
    { timeout: 30_000 }
  );

  await dragTo(page, CARD, to);
  await expect(cardIn(page, to, CARD)).toBeVisible({ timeout: 30_000 });
  await wrote;

  // Written, not just moved on screen.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(cardIn(page, to, CARD)).toBeVisible({ timeout: 30_000 });
});

test("the board cannot close a task that needs an approval", async ({ page }) => {
  // The assertion this file exists for. The rule lives in the domain and
  // the board goes through it, so the card comes back rather than the
  // task closing.
  await page.goto(BOARD, { waitUntil: "domcontentloaded" });

  // Its own fixture, and nothing else touches it, so it is where the
  // seed put it and the assertion can say so outright.
  await expect(cardIn(page, "OPEN", SUPERVISED)).toBeVisible({ timeout: 30_000 });

  await dragTo(page, SUPERVISED, "DONE");

  await expect(page.getByText("המשימה לא הוזזה")).toBeVisible({ timeout: 30_000 });
  // Back where it was, not left on "הושלמה" with a toast beside it.
  await expect(cardIn(page, "OPEN", SUPERVISED)).toBeVisible({ timeout: 30_000 });
  await expect(cardIn(page, "DONE", SUPERVISED)).toHaveCount(0);
});
