import { test, expect } from "./fixtures";

// The task screen, from the side of somebody actually working on a task.
//
// The scanner flagged two new capabilities with no proof behind them: the
// screen itself, and the Server Actions that write from it. A screen owes
// a browser test because a browser is the only thing that can say whether
// it works; a Server Action owes one because it is the hinge between a
// control somebody clicks and a row in the database, and each half can be
// right while the pair is broken.
//
// What is asserted here is what a person would notice, not what the code
// does. The description comes back RENDERED rather than as the characters
// that produced it. The clock starts from the work and the minutes land
// on that task. A promise the client can see refuses to close silently
// and asks first. None of those are readable from the source.
//
// Prose warning, same as the other flow files in this directory: coverage
// is inferred from the TEXT of these files, so a module named in a comment
// would hand itself credit it has not earned. Modules are referred to in
// words. The two lines below are the declared exception, and they are
// deliberately awkward to write so they stay rare.
//
// @covers screen:/app/tasks/[id]
// @covers action:(product)/app/(authenticated)/tasks/[id]/actions

test.describe.configure({ timeout: 90_000 });

const TASKS = "/app/tasks";
const TIMER = "/app/timer";

// The seeded task the demo data gives a description and a priority to, so
// that this screen has something to be demonstrated on. Matched loosely:
// every seeded name carries a "[DEMO]" prefix, and an exact string would
// bake that fixture detail into the test.
const SEEDED = /מיפוי מתחרים/;

/// Leave no timer of an earlier spec running.
///
/// One active timer per person is a database constraint, not a
/// convention, so a timer left behind by another file would make the
/// start below refuse - and read as a broken mechanism rather than as
/// untidy fixtures.
async function clearRunningTimer(page: import("@playwright/test").Page) {
  await page.goto(TIMER, { waitUntil: "domcontentloaded" });
  const stop = page.getByRole("button", { name: /עצירה ושמירה/ });
  if (await stop.isVisible().catch(() => false)) {
    await stop.click();
    await expect(page.getByText("אין טיימר פעיל")).toBeVisible({ timeout: 20_000 });
  }
}

test("the list opens the task, and the task says what the row could not", async ({ page }) => {
  await page.goto(TASKS, { waitUntil: "domcontentloaded" });

  await page.getByRole("link", { name: SEEDED }).first().click();
  await expect(page).toHaveURL(/\/app\/tasks\/[^/]+$/);

  // Rendered, not raw. The asterisks that produced this are not on the
  // screen, and the emphasis is a real element - which is the whole
  // difference between a description field and a textarea nobody reads.
  await expect(page.locator("strong", { hasText: "עד יום חמישי" })).toBeVisible();
  await expect(page.locator("code", { hasText: "INV-2024-118" })).toBeVisible();
  await expect(page.getByRole("link", { name: "אתר שלהם" })).toHaveAttribute(
    "href",
    "https://example.com/alpha"
  );
  // A link in a description leaves the app, and says so to the browser.
  await expect(page.getByRole("link", { name: "אתר שלהם" })).toHaveAttribute(
    "rel",
    /noopener/
  );

  // The two panels that read data nothing has ever displayed.
  await expect(page.getByText("שעות על המשימה")).toBeVisible();
  await expect(page.getByText("היסטוריה")).toBeVisible();
  // The audit log has recorded this since the task was seeded.
  await expect(page.getByText("המשימה נפתחה")).toBeVisible();
});

// Serial, and sharing one task: these are stages of a single piece of
// work, not independent checks. Creating a task per assertion would make
// the file slower and would stop testing the thing that matters - that
// the same task carries all of it at once.
test.describe.serial("one task, from opening it to closing it", () => {
  const title = `[E2E] משימה-${Date.now().toString(36)}`;
  let taskUrl = "";

  test("a task created from the list opens on its own screen", async ({ page }) => {
    await page.goto(TASKS, { waitUntil: "domcontentloaded" });

    await page.getByRole("button", { name: "+ משימה" }).click();
    await page.locator('select[name="clientId"]').selectOption({ index: 1 });
    await page.locator('input[name="title"]').fill(title);
    await page.locator('input[name="clientVisible"]').check();
    await page.getByRole("button", { name: "הוספת משימה" }).click();

    // Thirty seconds, for the same reason the adoption spec spends them:
    // the row arrives on its own, and on one CI run that took longer than
    // twenty. How long it takes is a finding, not a convenience.
    const row = page.locator("[data-task]").filter({ hasText: title });
    await expect(row, "the task the drawer just created is not in the list").toBeVisible({
      timeout: 30_000,
    });

    await row.getByRole("link", { name: title }).click();
    await expect(page).toHaveURL(/\/app\/tasks\/[^/]+$/);
    taskUrl = page.url();
  });

  test("priority and description are written from the screen and survive a reload", async ({ page }) => {
    await page.goto(taskUrl, { waitUntil: "domcontentloaded" });

    await page.getByLabel("עדיפות").selectOption("URGENT");
    await expect(page.getByText("העדיפות: דחופה")).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "הוספת תיאור" }).click();
    await page
      .getByPlaceholder(/מה צריך לעשות/)
      .fill("כתובת: הרצל 5.\n\n- לאסוף את המסמך\n- **להחתים** לפני חמישי");
    await page.getByRole("button", { name: "שמירה" }).click();
    await expect(page.getByText("התיאור עודכן")).toBeVisible({ timeout: 30_000 });

    // Reloaded, because this half is about what reached the database
    // rather than about what the screen did optimistically.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByLabel("עדיפות")).toHaveValue("URGENT");
    await expect(page.locator("strong", { hasText: "להחתים" })).toBeVisible();
    await expect(page.getByText("כתובת: הרצל 5.")).toBeVisible();
  });

  test("the clock starts from the work, and the minutes land on this task", async ({ page }) => {
    await clearRunningTimer(page);
    await page.goto(taskUrl, { waitUntil: "domcontentloaded" });

    // Before: nothing has been reported against it.
    await expect(page.getByText("עדיין לא דווח זמן על המשימה הזו")).toBeVisible();

    await page.getByRole("button", { name: "הפעלת טיימר" }).click();
    // The button becomes the running clock, which is how a person knows
    // it took - there is no other confirmation on this screen.
    await expect(page.getByRole("button", { name: /עצירה/ })).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: /עצירה/ }).click();
    await expect(page.getByText("הטיימר נעצר")).toBeVisible({ timeout: 30_000 });

    await page.reload({ waitUntil: "domcontentloaded" });
    // The entry is on THIS task now, which is the point of starting from
    // it: the empty state is gone and the roll-up names the person.
    await expect(page.getByText("עדיין לא דווח זמן על המשימה הזו")).toHaveCount(0);
    await expect(page.getByText("שעות על המשימה")).toBeVisible();
  });

  test("a promise the client can see refuses to close without a sentence for them", async ({ page }) => {
    await page.goto(taskUrl, { waitUntil: "domcontentloaded" });

    // The close asks BEFORE it happens. The server would refuse it
    // anyway; being refused after the fact for something nobody was
    // asked is the failure this interception exists to avoid.
    await page.getByLabel("סטטוס").selectOption("DONE");
    await expect(page.getByText("לפני הסגירה: מה קרה בפועל?")).toBeVisible({ timeout: 30_000 });

    const outcome = "אספנו את המסמך והחתמנו אותו, הכול סגור.";
    await page.getByLabel("משפט התוצאה לפני סגירה").fill(outcome);
    await page.getByRole("button", { name: "סגירה", exact: true }).click();

    await expect(page.getByText("המשימה הושלמה")).toBeVisible({ timeout: 30_000 });

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByLabel("סטטוס")).toHaveValue("DONE");
    // And the sentence is where the client will read it, still editable.
    await expect(page.getByText(outcome)).toBeVisible();
  });
});
