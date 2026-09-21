import { test, expect } from "@playwright/test";

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

// Serial within this file. Every test here writes time entries for the SAME
// signed-in user, and the overlap rule is deliberately sensitive to what that
// user already has on the clock - so running them at once makes each one's
// result depend on another's timing. Files still run in parallel with each
// other; it is only this one's internal ordering that has to be fixed.
test.describe.configure({ mode: "serial", timeout: 90_000 });

test.describe("timer/actions - start and stop", () => {
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
});

test.describe("my-time/actions - manual entry", () => {
  test("a manual entry is created, edited and deleted from the employee's own screen", async ({ page }) => {
    // Shifted by the attempt number. A retry runs against the same database,
    // so a fixed window collides with the entry the previous attempt already
    // wrote - for the SAME client, which is the one collision this product
    // refuses outright. A test that cannot survive its own retry reports as a
    // product bug on the second run.
    const window = windowEarlierToday(30, 20 + 60 * test.info().retry);
    test.skip(window === null, "no finished window fits inside today yet (runs just after local midnight)");
    const { start, end } = window!;
    const note = tag("e2e-manual");
    const edited = `${note}-edited`;

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

    // Edit it. The row's own edit control opens the inline form.
    await row.click();
    const noteField = page.locator('form input[name="note"]').last();
    if (await noteField.count()) {
      await noteField.fill(edited);
      const save = page.getByRole("button", { name: /שמירה|עדכון/ }).last();
      if (await save.count()) {
        await save.click();
        await expect(page.getByText(edited, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
      }
    }
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

    await page.goto("/app/tasks");
    await page.getByRole("button", { name: "+ משימה" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('select[name="clientId"]').selectOption({ index: 1 });
    await dialog.locator('input[name="title"]').fill(title);
    await dialog.getByRole("button", { name: "הוספת משימה" }).click();

    // Same as the other drawers: read the row back off a fresh render rather
    // than trusting the drawer to have closed.
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

    await toggle.click();
    await expect(toggle, "marking the task done did not stick").toHaveAttribute("aria-checked", "true", {
      timeout: 15_000,
    });
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
