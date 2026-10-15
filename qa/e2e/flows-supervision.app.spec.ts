import { test, expect } from "./fixtures";

// Supervision and approval, from the side of the person who has to sign.
//
// The scanner flagged one new screen with nothing behind it. It owes a
// browser test for a reason particular to this feature: the whole point
// of an approval step is that somebody finds out there is something
// waiting for them, and "finds out" is a nav row, a count and a button.
// None of those are visible to a domain test, and all three have to be
// right on the same render or the rule underneath them is decoration.
//
// What is NOT here, deliberately: who may approve, what happens to the
// signature when a task is reopened, and the refusal to close a
// supervised task directly. Those are rules, they have no pixels, and
// they are covered where they can be checked in milliseconds rather than
// in minutes - tests/unit/task-approval and its integration counterpart.
//
// Prose warning, same as the other flow files here: coverage is inferred
// from the TEXT of these files, so a module named in a comment would hand
// itself credit it has not earned. Modules are referred to in words. The
// line below is the declared exception.
//
// @covers screen:/app/supervising
//
// Since 15.10.2026 that screen is a redirect: the list of work waiting on
// this person is the tasks screen under "בפיקוח" and "ממתינות לאישור",
// and the count lives beside "בפיקוח" and beside "משימות" in the nav.

test.describe.configure({ timeout: 90_000 });

const OLD_SUPERVISING = "/app/supervising";
const WAITING = "/app/tasks?mine=supervising&status=PENDING_APPROVAL";

// This file's own task, seeded with a fixed id and supervised by the
// person this project signs in as. Read by nothing else, so its status
// at the start of the run is the status the seed gave it.
const FIXTURE_URL = "/app/tasks/demo-task-supervised-fixture";
const FIXTURE = /החלפת ספק ניקיון/;

// Stages of one decision, in order: send it, find it, sign it.
test.describe.serial("one task, from sending it for approval to signing it", () => {
  test("the task offers the one move that is open to it", async ({ page }) => {
    await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });

    // Wait for the section before deciding anything about what is in it.
    // The previous version asked `isVisible()` the instant the document
    // fired, and that call does not wait: this page streams, so on a slow
    // render it answered "no button" for a button that arrived a moment
    // later, skipped the click, and then reported the untouched status as
    // a broken screen. A whole CI round on a question about timing.
    await expect(page.getByRole("heading", { name: "פיקוח ואישור" })).toBeVisible({ timeout: 30_000 });

    // The forward move is a button, not a value buried in the status
    // dropdown. A rule people have to go looking for is a rule people
    // route around.
    //
    // Conditional because this group is serial and its fixture is
    // mutated: on a retry the task has already been sent and the button
    // is correctly gone. The assertion after it is the same either way,
    // and it is the product's own sentence rather than a form value.
    const send = page.getByRole("button", { name: "שליחה לאישור" });
    if (await send.count()) {
      await send.click();
      await expect(page.getByText("הסטטוס: ממתינה לאישור")).toBeVisible({ timeout: 30_000 });
    }

    await expect(page.getByText("המשימה מחכה לאישור שלך.")).toBeVisible({ timeout: 30_000 });
  });

  test("the nav says something is waiting, and the screen says what", async ({ page }) => {
    // The old address, from a bookmark or an old message, still lands on
    // the work waiting for this person.
    await page.goto(OLD_SUPERVISING, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/app\/tasks\?mine=supervising&status=PENDING_APPROVAL$/, { timeout: 30_000 });

    // If the task is not here at all, the list is showing the wrong
    // person's work or none - which is what happens when the fixture
    // names somebody other than the account this project signs in as -
    // or the send in the previous test did not land.
    await expect(page.getByRole("link", { name: FIXTURE }).first()).toBeVisible({ timeout: 30_000 });

    // The count beside "בפיקוח", which is the number a person reads
    // before deciding whether to open anything.
    await expect(page.getByTestId("supervising-pending")).toHaveText(/^\d+$/);

    // And the row is reachable from here, because a list of things
    // waiting for you that you cannot act on from is a list of chores.
    await page.getByRole("link", { name: FIXTURE }).first().click();
    // From the tasks screen the link carries the list it came from
    // (`?from=`), so only the path is asserted.
    await expect(page).toHaveURL(new RegExp(`${FIXTURE_URL}(\\?|$)`));
  });

  test("the supervisor signs it, and the screen says who and when", async ({ page }) => {
    await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });

    await page.getByRole("button", { name: "אישור וסגירה" }).click();
    await expect(page.getByText("הסטטוס: הושלמה")).toBeVisible({ timeout: 30_000 });

    // The signature, which is the record the audit log keeps and the one
    // thing a person asks about a closed task months later.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText(/אושרה על ידי/)).toBeVisible({ timeout: 30_000 });
  });

  test("and it stops waiting once it is signed", async ({ page }) => {
    // The other half of the count. A number that only goes up is a badge
    // people learn to ignore.
    await page.goto(WAITING, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("mine-scope")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("link", { name: FIXTURE })).toHaveCount(0);
  });
});
