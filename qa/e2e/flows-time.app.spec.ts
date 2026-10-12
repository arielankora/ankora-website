import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { clearRunningTimers, runningTimerNotes } from "./timers";

// Flows that WRITE, for the four Server Actions behind the time-tracking
// screens. Everything else in qa/e2e renders a page and checks it did not
// throw; nothing until now submitted one of these forms, which is why
// qa/lib/discover.mjs deliberately refuses to credit a Server Action for its
// host screen being swept. These specs are what that refusal was waiting for.
//
// @covers action:(product)/app/(authenticated)/timer/actions
// @covers action:(product)/app/(authenticated)/my-time/actions
// @covers action:(product)/app/(authenticated)/tasks/actions
// @covers action:(product)/app/(authenticated)/notifications/actions
//
// Two rules these follow, because the whole suite runs `fullyParallel`
// against ONE database:
//
//   1. Every test creates the row it then acts on, and names it with a
//      per-test unique string. Nothing here mutates a seeded fixture that
//      another spec might be reading at the same moment. (The integration
//      suite learned this the expensive way - see #76.)
//   2. Assertions are on what a user would see afterwards, not on a toast
//      that may have already faded.

/** Unique enough to find again, short enough to read in a failure message. */
function tag(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Today in Asia/Jerusalem, which is the timezone the whole product runs in. */
function todayKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
}

/**
 * A finished window earlier today, as HH:mm - or null if one will not fit.
 *
 * Not "now plus an hour": createManualEntry refuses anything more than five
 * minutes in the future. Not "an hour ago" either - before dawn that lands on
 * yesterday, and the form then demands a backdate reason it does not show for
 * a same-day entry. So the window is walked backwards from the current hour
 * and must fit inside today; in the first hour or so after local midnight it
 * does not, and these two tests skip with that stated rather than inventing a
 * time the product is right to reject.
 *
 * The bands here (roughly the last 20-240 minutes) are this file's alone.
 * flows-admin.app.spec.ts writes further back on purpose: both files file
 * time for the same user against the same client, and two entries for one
 * client at one time is exactly the collision this product refuses - which
 * is what made the first of these look "refused" when the other file had
 * simply got there first.
 */
function windowEarlierToday(lengthMinutes = 30, gapMinutes = 20): { start: string; end: string } | null {
  const [hh, mm] = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date())
    .split(":")
    .map(Number);

  const end = hh * 60 + mm - gapMinutes;
  const start = end - lengthMinutes;
  if (start < 0) return null;
  const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return { start: fmt(start), end: fmt(end) };
}

/** One entry on /app/my-time: the innermost block holding its note and its controls. */
function entryRowNamed(page: Page, note: string) {
  return page
    .locator("div")
    .filter({ has: page.getByText(note, { exact: true }) })
    .filter({ has: page.getByRole("button", { name: "עריכה", exact: true }) })
    .last();
}

/** Deletes an entry from its own row and proves it stays gone. */
async function deleteEntryNamed(page: Page, note: string) {
  await entryRowNamed(page, note).getByRole("button", { name: "מחיקה", exact: true }).click();
  await expect(page.getByText(note, { exact: true }), "the deleted entry is still listed").toHaveCount(0, {
    timeout: 15_000,
  });
  await page.reload();
  await expect(page.getByText(note, { exact: true }), "the deleted entry came back after a reload").toHaveCount(0);
}

// Serial within this file. Every test here writes time entries for the SAME
// signed-in user, and the overlap rule is deliberately sensitive to what that
// user already has on the clock - so running them at once makes each one's
// result depend on another's timing. Files still run in parallel with each
// other; it is only this one's internal ordering that has to be fixed.
test.describe.configure({ mode: "serial", timeout: 90_000 });

test.describe("timer/actions - start and stop", () => {
  // 7.10.2026, PR #163: this file had no cleanup of its own and trusted
  // the specs before it to leave nothing running. 12.10.2026: the cleanup
  // it then got could not clear the state it was written for; the shared
  // helper says why.
  test.beforeEach(async ({ page }) => {
    await clearRunningTimers(page);
  });

  test("starting a timer, then stopping it, leaves a finished entry", async ({ page }) => {
    const note = tag("e2e-timer");

    await page.goto("/app/timer");

    // The picker is client-then-category, exactly as the manual form is.
    const clientSelect = page.getByLabel("לקוח");
    await clientSelect.selectOption({ index: 1 });
    await page.getByLabel("קטגוריה").selectOption({ index: 1 });
    await page.getByLabel("משימה / הערה").fill(note);

    await page.getByRole("button", { name: "התחלת טיימר" }).click();

    // A running timer is the one state where the stop control exists at all,
    // so its appearance is the assertion - no toast to race against.
    const stop = page.getByRole("button", { name: "עצירה ושמירה" });
    await expect(stop, "the timer did not start").toBeVisible({ timeout: 15_000 });

    await stop.click();
    await expect(page.getByRole("button", { name: "התחלת טיימר" }), "the timer did not stop").toBeVisible({
      timeout: 15_000,
    });

    // And it became a real entry, not just a UI state change.
    await page.goto("/app/my-time");
    await expect(page.getByText(note, { exact: false }).first()).toBeVisible();
  });

  // Parallel timers (5.10.2026): two at once on two clients, the second
  // only after the person says yes, and stopping one leaves the other.
  test("a second timer on another client asks first, then runs in parallel", async ({ page }) => {
    await page.goto("/app/timer");
    await expect(page.getByText("אין טיימר פעיל"), "a timer from an earlier spec is still running").toBeVisible({
      timeout: 15_000,
    });

    const clientSelect = page.getByLabel("לקוח");
    const clientCount = await clientSelect.locator("option").count();
    test.skip(clientCount < 3, "the seeded employee needs two clients for this flow");

    await clientSelect.selectOption({ index: 1 });
    await page.getByLabel("קטגוריה").selectOption({ index: 1 });
    await page.getByRole("button", { name: "התחלת טיימר" }).click();
    const stops = page.getByRole("button", { name: "עצירה ושמירה" });
    await expect(stops).toHaveCount(1, { timeout: 15_000 });

    // The second start is folded away until asked for, and the client
    // already running is not offered.
    await page.getByRole("button", { name: "הפעלת טיימר נוסף" }).click();
    await page.getByLabel("לקוח").selectOption({ index: 1 });
    await page.getByLabel("קטגוריה").selectOption({ index: 1 });
    await page.getByRole("button", { name: "הפעלה במקביל" }).click();

    // Not started yet: the question comes first.
    await page.getByRole("button", { name: "להפעיל במקביל" }).click();
    await expect(stops, "the parallel timer did not start").toHaveCount(2, { timeout: 15_000 });
    await expect(page.getByText(/רצים 2 טיימרים/)).toBeVisible();

    // Both were started on no task, so each needs a note to stop.
    //
    // Counted by the note fields, one per running card, and NOT by the
    // "עצירה ושמירה" buttons. A stop in flight relabels its own button
    // "עוצר...", so the button count fell to one the instant the first
    // click landed, with both cards still on screen. The next fill then
    // went into the first card's field (still mounted, still stopping),
    // the click went to the second card's button with its own note empty,
    // the screen rightly refused it, and "אין טיימר פעיל" never came.
    // That was #172, #182, #184 and #185. A card's note field leaves the
    // DOM only once the server has said the stop happened.
    const running = runningTimerNotes(page);
    await expect(running).toHaveCount(2);
    await running.first().fill(tag("e2e-parallel-a"));
    await stops.first().click();
    await expect(running, "stopping one should leave the other running").toHaveCount(1, { timeout: 15_000 });
    await expect(stops).toHaveCount(1);

    await running.first().fill(tag("e2e-parallel-b"));
    await stops.first().click();
    await expect(running, "the second timer did not stop").toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText("אין טיימר פעיל")).toBeVisible();
  });
});

test.describe("my-time/actions - manual entry", () => {
  test("a manual entry is created from the employee's own screen", async ({ page }) => {
    // Shifted by the attempt number. A retry runs against the same database,
    // so a fixed window collides with the entry the previous attempt already
    // wrote - for the SAME client, which is the one collision this product
    // refuses outright. A test that cannot survive its own retry reports as a
    // product bug on the second run.
    const window = windowEarlierToday(30, 20 + 60 * test.info().retry);
    test.skip(window === null, "no finished window fits inside today yet (runs just after local midnight)");
    const { start, end } = window!;
    const note = tag("e2e-manual");

    await page.goto("/app/my-time");

    await page.locator('input[name="date"]').fill(todayKey());
    await page.locator('input[name="startTime"]').fill(start);
    await page.locator('input[name="endTime"]').fill(end);
    await page.locator('select[name="clientId"]').selectOption({ index: 1 });
    await page.locator('select[name="categoryId"]').selectOption({ index: 1 });
    await page.locator('input[name="note"]').fill(note);
    await page.getByRole("button", { name: "הוספת דיווח" }).click();

    // The toast is the action reporting ok, and it is what this test is
    // actually about - that the Server Action ran and accepted the entry.
    // The list below is a second, weaker read through a server render.
    await expect(page.getByText("הדיווח נשמר"), "the manual entry was refused").toBeVisible({ timeout: 20_000 });

    await page.reload();
    const row = page.getByText(note, { exact: false }).first();
    await expect(row, "the saved entry is not on the week's list").toBeVisible({ timeout: 15_000 });

    // 12.10.2026: this test was called "created, edited and deleted" and
    // did neither of the last two. It clicked the note text (which opens
    // nothing), then looked for `form input[name="note"]`, found the ADD
    // form's field at the top of the screen, typed into it, and looked for
    // a "שמירה" button that only an open edit form has. `count()` samples
    // once and does not wait, found none, and the rest was skipped in
    // silence. Editing and deleting now have their own test, below.
  });

  // Split out on 12.10.2026, the first time these steps actually ran, and
  // parked on the same day. Both writes land (the action answers ok, and
  // the re-rendered screen it sends back already has the change), but the
  // browser does not always apply that answer: an edit can stay on
  // "שומר..." and a deleted entry can stay listed until a reload. Measured
  // locally at between one attempt in six and one in three. The stuck edit
  // was reproduced without this suite's own fetch probe as well, so it is
  // the screen and not the rig. Fixing it means changing product code,
  // which waits for a decision:
  // claude/e2e-silent-and-racing-2026-10-12.md.
  test("a manual entry can be edited, then deleted, from the employee's own screen", async ({ page }) => {
    test.fixme(true, "my-time sometimes does not apply a saved edit or delete until reload (12.10.2026), see the project doc");

    const window = windowEarlierToday(30, 110 + 60 * test.info().retry);
    test.skip(window === null, "no finished window fits inside today yet (runs just after local midnight)");
    const { start, end } = window!;
    const note = tag("e2e-edit");
    const edited = `${note}-edited`;

    await page.goto("/app/my-time");
    await page.locator('input[name="date"]').fill(todayKey());
    await page.locator('input[name="startTime"]').fill(start);
    await page.locator('input[name="endTime"]').fill(end);
    await page.locator('select[name="clientId"]').selectOption({ index: 1 });
    await page.locator('select[name="categoryId"]').selectOption({ index: 1 });
    await page.locator('input[name="note"]').fill(note);
    await page.getByRole("button", { name: "הוספת דיווח" }).click();
    await expect(page.getByText("הדיווח נשמר"), "the entry to edit was refused").toBeVisible({ timeout: 20_000 });
    await page.reload();

    await entryRowNamed(page, note).getByRole("button", { name: "עריכה", exact: true }).click();

    // Editing turns the row into its own form. Every row's delete button is
    // a form carrying the entry's id too, so the edit form is told apart by
    // the field only it has: the version it was opened against.
    const editForm = page.locator("form").filter({ has: page.locator('input[name="expectedUpdatedAt"]') });
    await expect(editForm, "the row's edit control did not open its form").toHaveCount(1);
    await editForm.locator('input[name="note"]').fill(edited);
    await editForm.getByRole("button", { name: "שמירה", exact: true }).click();

    // Done when the form has gone and the row reads the new note. Not when
    // the button stops saying "שמירה": while saving it says "שומר...".
    await expect(editForm, "the edit form never closed after saving").toHaveCount(0, { timeout: 15_000 });
    const editedRow = entryRowNamed(page, edited);
    await expect(editedRow, "the edited note is not on the list").toBeVisible({ timeout: 15_000 });
    await expect(editedRow.getByText("נערך", { exact: true }), "an edited entry should say so").toBeVisible();

    await deleteEntryNamed(page, edited);
  });

  test("an entry whose time range collides with another client is offered as confirmable", async ({ page }) => {
    // The rule shipped in #73: a SAME-client collision is a hard error, a
    // cross-client one is a warning with "שמירה בכל זאת". Proving the warning
    // path reaches the browser at all is what the unit and integration tests
    // cannot do.
    const window = windowEarlierToday(40, 200 + 60 * test.info().retry);
    test.skip(window === null, "no finished window fits inside today yet (runs just after local midnight)");
    const { start, end } = window!;
    const first = tag("e2e-overlap-a");

    await page.goto("/app/my-time");
    await page.locator('input[name="date"]').fill(todayKey());
    await page.locator('input[name="startTime"]').fill(start);
    await page.locator('input[name="endTime"]').fill(end);
    await page.locator('select[name="clientId"]').selectOption({ index: 1 });
    await page.locator('select[name="categoryId"]').selectOption({ index: 1 });
    await page.locator('input[name="note"]').fill(first);
    await page.getByRole("button", { name: "הוספת דיווח" }).click();
    // A precondition, not the subject - so it is confirmed by the action's own
    // success signal rather than by reading it back off a re-rendered list.
    await expect(page.getByText("הדיווח נשמר"), "the first entry was refused").toBeVisible({ timeout: 20_000 });

    // Same window again, same client: this one must be refused outright and
    // must NOT offer the confirmation.
    await page.locator('input[name="date"]').fill(todayKey());
    await page.locator('input[name="startTime"]').fill(start);
    await page.locator('input[name="endTime"]').fill(end);
    await page.locator('select[name="clientId"]').selectOption({ index: 1 });
    await page.locator('select[name="categoryId"]').selectOption({ index: 1 });
    await page.locator('input[name="note"]').fill(tag("e2e-overlap-b"));
    await page.getByRole("button", { name: "הוספת דיווח" }).click();

    await expect(page.getByText(/חופף/)).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("button", { name: "שמירה בכל זאת" }),
      "a same-client collision must never be confirmable",
    ).toHaveCount(0);
  });
});

test.describe("tasks/actions - create and complete", () => {
  test("a task is created from the drawer and can be marked done", async ({ page }) => {
    const title = tag("e2e-task");

    // mine=0: the task this creates has no assignee, and "שלי" is on by
    // default since 26.9.2026.
    await page.goto("/app/tasks?mine=0");
    // On a desk the create-task entry point is the top bar's "משימה
    // חדשה" (26.9.2026); the in-page button is for phones only.
    await page.getByRole("link", { name: "משימה חדשה" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('select[name="clientId"]').selectOption({ index: 1 });
    await dialog.locator('input[name="title"]').fill(title);
    await dialog.getByRole("button", { name: "הוספת משימה" }).click();

    // Same as the other drawers: read the row back off a fresh render rather
    // than trusting the drawer to have closed.
    //
    // The wait is not decoration. Reloading straight after the click can
    // out-race the Server Action's round trip, and the reloaded page then
    // legitimately does not have the row yet - which reports as "the task
    // was not created" on a loaded runner and passes everywhere else.
    await page.waitForLoadState("networkidle");
    await page.reload();
    await expect(page.getByText(title, { exact: true }), "the task was not created").toBeVisible({ timeout: 15_000 });

    // The row's toggle is a `role="checkbox"` button sitting as the immediate
    // sibling of the block holding the title, so it is reached from the title
    // rather than from a class name - the styling here is redesigned often
    // and a test pinned to it would break for cosmetic reasons.
    const toggle = page.locator(
      `xpath=//button[@role="checkbox"][following-sibling::div[.//*[normalize-space(text())=${JSON.stringify(title)}]]]`,
    );
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    const closed = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/app/tasks"), {
      timeout: 30_000,
    });
    await toggle.click();

    // 12.10.2026: ticked, or already gone. This list is the default
    // "פעילות" view, and a DONE task does not belong in it: the row ticks
    // at once, and the action's response re-renders the list without it.
    // Reading the tick after that response had won the race found no row
    // at all, and failed on a screen doing what it should. Where a closed
    // task lives is checked after the write has answered.
    await expect(async () => {
      if ((await toggle.count()) === 0) return;
      await expect(toggle).toHaveAttribute("aria-checked", "true", { timeout: 1_000 });
    }, "the task is still open after marking it done").toPass({ timeout: 15_000 });
    expect((await closed).status(), "marking done was not accepted").toBe(200);

    await page.goto("/app/tasks?status=DONE&mine=0");
    const doneRow = page.locator("[data-task]").filter({ hasText: title });
    await expect(doneRow, "marking the task done did not stick").toBeVisible({ timeout: 15_000 });
    await expect(doneRow.getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
  });
});

test.describe("notifications/actions - marking read", () => {
  test("marking everything read clears the unread controls", async ({ page }) => {
    await page.goto("/app/notifications");

    const markAll = page.getByRole("button", { name: "סימון הכול כנקרא" });
    // The seed ships unread demo rows, but another spec in this same run may
    // have cleared them already - so this is conditional by design rather
    // than a dependency on ordering between parallel files.
    if (await markAll.count()) {
      await markAll.click();
      await expect(markAll, "unread notifications survived 'mark all read'").toHaveCount(0, { timeout: 15_000 });
      await expect(page.getByRole("button", { name: "סימון כנקרא" })).toHaveCount(0);
    } else {
      // Nothing unread: then the per-row control must not be present either.
      await expect(page.getByRole("button", { name: "סימון כנקרא" })).toHaveCount(0);
    }
  });
});
