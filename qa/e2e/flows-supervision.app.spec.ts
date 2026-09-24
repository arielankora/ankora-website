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

test.describe.configure({ timeout: 90_000 });

const SUPERVISING = "/app/supervising";

// This file's own task, seeded with a fixed id and supervised by the
// person this project signs in as. Read by nothing else, so its status
// at the start of the run is the status the seed gave it.
const FIXTURE_URL = "/app/tasks/demo-task-supervised-fixture";
const FIXTURE = /החלפת ספק ניקיון/;

// Stages of one decision, in order: send it, find it, sign it.
test.describe.serial("one task, from sending it for approval to signing it", () => {
  test("the task offers the one move that is open to it", async ({ page }) => {
    await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });

    // The forward move is a button, not a value buried in the status
    // dropdown. A rule people have to go looking for is a rule people
    // route around.
    //
    // Guarded rather than clicked outright, because this button exists
    // only while the task has not been sent yet. On a retry of this
    // group the send has already happened, and an unguarded click would
    // wait for an element that is correctly gone until the test timeout
    // fires ninety seconds later - a fixture problem reported as a
    // broken screen. The assertion below is the same either way.
    const send = page.getByRole("button", { name: "שליחה לאישור" });
    if (await send.isVisible().catch(() => false)) {
      await send.click();
      await expect(page.getByText("הסטטוס: ממתינה לאישור")).toBeVisible({ timeout: 30_000 });
    }

    await expect(page.getByLabel("סטטוס")).toHaveValue("PENDING_APPROVAL", { timeout: 30_000 });
  });

  test("the nav says something is waiting, and the screen says what", async ({ page }) => {
    await page.goto(SUPERVISING, { waitUntil: "domcontentloaded" });

    // Asserted in this order on purpose, so a failure says which half
    // broke. If the task is not here at all, the screen is showing the
    // wrong person's work or none - which is what happens when the
    // fixture names somebody other than the account this project signs
    // in as. If it is here but not under the waiting heading, the send
    // in the previous test did not land.
    await expect(page.getByRole("link", { name: FIXTURE }).first()).toBeVisible({ timeout: 30_000 });

    // The heading carries its own count, which is the number a person
    // reads before deciding whether to open anything.
    await expect(page.getByText(/ממתינות לאישור שלכם \(\d+\)/)).toBeVisible();

    // And the row is reachable from here, because a list of things
    // waiting for you that you cannot act on from is a list of chores.
    await page.getByRole("link", { name: FIXTURE }).first().click();
    await expect(page).toHaveURL(new RegExp(`${FIXTURE_URL}$`));
  });

  test("the supervisor signs it, and the screen says who and when", async ({ page }) => {
    await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });

    await expect(page.getByText("המשימה מחכה לאישור שלך.")).toBeVisible();
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
    await page.goto(SUPERVISING, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/ממתינות לאישור שלכם/)).toHaveCount(0);
  });
});
