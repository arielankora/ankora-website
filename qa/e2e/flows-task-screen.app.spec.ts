import { test, expect } from "./fixtures";

// The task screen, from the side of somebody actually working on a task.
//
// The scanner flagged two new capabilities with nothing behind them: the
// screen itself, and the Server Actions that write from it. A screen owes
// a browser test because a browser is the only thing that can say whether
// it works; a Server Action owes one because it is the hinge between a
// control somebody clicks and a row in the database, and each half can be
// right while the pair is broken.
//
// Everything here runs against ONE seeded task that exists for this file
// and is read by nothing else. Two earlier versions of this spec failed
// for reasons that had nothing to do with the screen, and both are worth
// stating because they are why it looks like this:
//
//   - It created its task through the list drawer, hanging four tests off
//     the one step in this suite that has been failing and passing on
//     retry for several releases. A stale list reported itself as a
//     broken task screen.
//   - It asserted the history panel's EMPTY state on a shared seeded
//     task. That task is empty only until another spec touches it, so the
//     assertion passed or failed by running order.
//
// Prose warning, same as the other flow files here: coverage is inferred
// from the TEXT of these files, so a module named in a comment would hand
// itself credit it has not earned. Modules are referred to in words. The
// two lines below are the declared exception.
//
// @covers screen:/app/tasks/[id]
// @covers action:(product)/app/(authenticated)/tasks/[id]/actions

test.describe.configure({ timeout: 90_000 });

const TASKS = "/app/tasks";
const TIMER = "/app/timer";

// This file's own task. Matched loosely: every seeded name carries a
// "[DEMO]" prefix, and an exact string would bake that into the test.
const FIXTURE = /תיאום מול ועד הבית/;

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

// The seed gives this task a fixed id, so every test after the first can
// go straight to it.
//
// That is not a shortcut, it is the difference between a suite that
// finishes and one that does not. The tasks list is the slowest screen in
// this product right now, and an earlier version of this file loaded it
// four times to reach the same row - minutes of browser time spent
// re-proving a link that the first test already asserts, on a run that
// other specs are timing out inside.
const FIXTURE_URL = "/app/tasks/demo-task-screen-fixture";

// Serial, and in this order: these are stages of one piece of work, and
// the last of them closes the task the others need open.
test.describe.serial("one task, from opening it to closing it", () => {
  test("the list opens the task, and the task says what the row could not", async ({ page }) => {
    // The one test that goes through the list, because the link from a
    // row to its task is the thing being asserted here.
    await page.goto(TASKS, { waitUntil: "domcontentloaded" });
    await page.getByRole("link", { name: FIXTURE }).first().click();
    await expect(page).toHaveURL(new RegExp(`${FIXTURE_URL}$`));

    // Rendered, not raw. The asterisks that produced this are not on the
    // screen and the emphasis is a real element, which is the whole
    // difference between a description field and a textarea nobody reads.
    await expect(page.locator("strong", { hasText: "בלי לשאול אף אחד" })).toBeVisible();
    await expect(page.locator("code", { hasText: "VA-2026-07" })).toBeVisible();

    const link = page.getByRole("link", { name: "באתר העירייה" });
    await expect(link).toHaveAttribute("href", "https://example.com/vaad");
    // A link inside a description leaves the app, and says so to the
    // browser rather than handing it the referrer.
    await expect(link).toHaveAttribute("rel", /noopener/);

    // The two panels that read data nothing has ever displayed. Asserted
    // as present, not as empty or full: what they hold depends on what
    // has already run, and an assertion that depends on running order is
    // one that will eventually fail for no reason anyone can act on.
    await expect(page.getByText("שעות על המשימה")).toBeVisible();
    // Phase 3 replaced the read-only history panel with the thread: one
    // list carrying the changes, the words and the files, so a status
    // change and the sentence explaining it sit next to each other.
    await expect(page.getByRole("heading", { name: "שרשור" })).toBeVisible();
  });

  test("priority and description are written from the screen and survive a reload", async ({ page }) => {
    await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });

    await page.getByLabel("עדיפות").selectOption("URGENT");
    await expect(page.getByText("העדיפות: דחופה")).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "עריכה" }).first().click();
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

    // And the history, now that this task has been through the product's
    // own write path twice. The audit log has recorded task changes since
    // phase 1 with nothing to display them; this is the first assertion
    // that a person can actually see one.
    //
    // The whole line, not just the field name: "עדיפות" on its own also
    // matches the select's label a few centimetres above, so it would
    // pass with no history rendered at all.
    await expect(page.getByText("המשימה עודכנה: עדיפות")).toBeVisible();
  });

  test("the clock starts from the work, and the minutes land on this task", async ({ page }) => {
    await clearRunningTimer(page);
    await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });

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
    // it: the empty state is gone.
    await expect(page.getByText("עדיין לא דווח זמן על המשימה הזו")).toHaveCount(0);
  });

  test("a promise the client can see refuses to close without a sentence for them", async ({ page }) => {
    await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });

    // Internal until this click. Becoming something a client reads is the
    // step that puts the task under the close rule at all.
    await page.getByRole("button", { name: "פנימית" }).click();
    await expect(page.getByText("המשימה מוצגת ללקוח")).toBeVisible({ timeout: 30_000 });

    // The close asks BEFORE it happens. The server would refuse it
    // anyway; being refused after the fact for something nobody was asked
    // is the failure this interception exists to avoid.
    await page.getByLabel("סטטוס").selectOption("DONE");
    await expect(page.getByText("לפני הסגירה: מה קרה בפועל?")).toBeVisible({ timeout: 30_000 });

    const outcome = "תיאמנו מול הוועד, המפתח נאסף והטופס הוגש.";
    await page.getByLabel("משפט התוצאה לפני סגירה").fill(outcome);
    await page.getByRole("button", { name: "סגירת המשימה" }).click();
    await expect(page.getByText("המשימה הושלמה")).toBeVisible({ timeout: 30_000 });

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByLabel("סטטוס")).toHaveValue("DONE");
    // And the sentence is where the client will read it, still editable.
    await expect(page.getByText(outcome)).toBeVisible();
  });
});

// Tasks phase 3. Appended to this file rather than given its own,
// because it is the same screen and the same seeded task, and a second
// file would mean a second fixture and a second serial group competing
// for it.
//
// What is asserted here is the round trip a browser is the only thing
// that can check: typing into the composer, the server taking it, and
// the words coming back on the screen without a reload. The rules
// underneath (who may delete, what the merge orders by, what an empty
// body does) are checked where they can be checked in milliseconds, in
// the integration suite.
test("a comment is written on the task and comes back on the screen", async ({ page }) => {
  await page.goto("/app/tasks/demo-task-screen-fixture", { waitUntil: "domcontentloaded" });

  const composer = page.getByLabel("הערה חדשה");
  await expect(composer).toBeVisible({ timeout: 30_000 });

  // Unique per run: this task is written to by the tests above it, and a
  // fixed string would match an entry left by the previous run.
  const said = `דיברתי עם ועד הבית ${Date.now()}`;
  await composer.fill(said);
  await page.getByRole("button", { name: "הוספת הערה" }).click();

  await expect(page.getByText("ההערה נוספה")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(said)).toBeVisible({ timeout: 30_000 });

  // And the composer is empty again, which it must not be until the
  // server has the words: a textarea cleared optimistically is a
  // paragraph somebody has to write twice.
  await expect(composer).toHaveValue("");

  // Written, not just rendered.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText(said)).toBeVisible({ timeout: 30_000 });
});

// Tasks phase 4. On the LIST screen rather than the task's own, but kept
// in this file because it reads the same seeded fixture and a second
// file would mean a second fixture competing for it.
//
// The word searched for is in the fixture's TITLE, which nothing in this
// suite rewrites. Its description is edited by a test above, and its
// thread is written by the one below, so either would make this pass or
// fail by running order - the failure the phase-1 notes in this file
// were written about.
//
// Searching the thread and the details is checked where it can be
// checked against a database in milliseconds, in the integration suite.
// What only a browser can say is that typing into the box and pressing
// Enter narrows the list a person is looking at.
test("the list finds a task by a word, and hides the rest", async ({ page }) => {
  await page.goto(TASKS, { waitUntil: "domcontentloaded" });

  const box = page.getByLabel("חיפוש במשימות");
  await expect(box).toBeVisible({ timeout: 30_000 });

  // Present before the search, so its absence afterwards means the
  // filter worked rather than that it was never there.
  //
  // Sixty seconds, on every assertion in this test that waits for a
  // render of the task list. This is the slowest render in the product;
  // on a loaded CI machine thirty seconds was not enough, and the
  // failure read as a missing row rather than as a page that had not
  // finished.
  //
  // It applies to the filtered renders too, which is the correction. The
  // first version of this reasoned that "everything after the search
  // runs against a list of one or two rows" and left those on
  // Playwright's ten-second default. The number of ROWS was never what
  // took the time.
  const WHOLE_LIST = 60_000;
  const other = page.getByRole("link", { name: /החלפת ספק ניקיון/ });
  await expect(other.first()).toBeVisible({ timeout: WHOLE_LIST });

  await box.fill("ועד הבית");
  await box.press("Enter");

  // The URL first, and not as an afterthought.
  //
  // This assertion used to sit below the two about rows, and that order
  // is what made this test fail on a loaded runner. Searching is a
  // navigation, and until it lands the browser is still showing the
  // UNFILTERED list. The fixture row is visible on both pages, so
  // waiting for it proves nothing about which one is on screen - and
  // then `toHaveCount(0)` was being asked about the old page, and
  // correctly answered 1 for ten seconds.
  //
  // The URL is the one signal that separates the two states. Asserting
  // it first means everything below runs against the filtered list.
  //
  // And on the same sixty seconds as everything else here, which is the
  // correction to the first version of this fix. In the App Router a
  // navigation does not change the address bar when it is asked for, it
  // changes it when the RSC payload arrives - so "the URL still has no
  // q after ten seconds" and "this screen takes more than ten seconds to
  // render" are the same sentence. Giving it Playwright's default while
  // the two assertions below it get sixty was the mistake, not the
  // ordering.
  //
  // If this still fails at sixty seconds then Enter is not navigating at
  // all, and that is a fault in the screen rather than in the waiting.
  // The two readings are what this timeout is for.
  await expect(page).toHaveURL(/[?&]q=/, { timeout: WHOLE_LIST });

  await expect(page.getByRole("link", { name: FIXTURE }).first()).toBeVisible({ timeout: WHOLE_LIST });
  // A filtered list is small, but it is still this screen, and this
  // screen is the slowest render in the product. The number here was
  // Playwright's 10s default, which is shorter than the time the same
  // file already documents as necessary above.
  await expect(other).toHaveCount(0, { timeout: WHOLE_LIST });

  // And clearing it gives the list back.
  //
  // A link rather than a button since the search box became a real form:
  // clearing the search is a navigation to this screen without `q`, and
  // saying so in the markup is what lets it be opened in a new tab and
  // read correctly by a screen reader.
  await page.getByRole("link", { name: "ניקוי החיפוש" }).click();
  await expect(page).not.toHaveURL(/[?&]q=/, { timeout: WHOLE_LIST });
  await expect(other.first()).toBeVisible({ timeout: WHOLE_LIST });
});
