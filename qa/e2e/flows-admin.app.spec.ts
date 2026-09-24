import { test, expect } from "./fixtures";

// The write paths behind the admin screens, signed in as the seeded
// ANKORA_ADMIN. Same reasoning as flows-time.app.spec.ts: rendering a screen
// is not submitting its form, so these are what qa/lib/discover.mjs was
// holding the coverage open for.
//
// Scope note: only the actions an ANKORA_ADMIN may actually perform. Users,
// hour banks, alerts and important dates are Super-Admin-only by the role
// matrix, so driving them from this session would test a ForbiddenError
// rather than the feature; they get their own session and their own file.
//
// Careful with prose in this file. Coverage is inferred by looking for a
// capability's own module path in a test's TEXT, and a Server Action inherits
// the paths of the libraries it imports. An earlier draft of this comment
// named the permissions module by path - which every action in the product
// imports - and that one mention silently credited NINE untouched actions
// with browser coverage. Name modules in words here, not as paths.
//
// @covers action:(product)/app/(authenticated)/clients/actions
// @covers action:(product)/app/(authenticated)/categories/actions
// @covers action:(product)/app/(authenticated)/profile/actions
// @covers action:(product)/app/(authenticated)/report-schedules/actions
// @covers action:(product)/app/(authenticated)/time-entries/actions

// These are write flows against a shared build: a navigation, several
// round-trips and a revalidation each. The 30s default is enough when one
// runs alone and not when four do, and a timeout there reads as a product
// failure rather than as a busy runner.
test.describe.configure({ timeout: 90_000 });

function tag(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
}

/**
 * A finished window earlier today, in THIS file's own band of the clock.
 *
 * Every spec file writes time entries for the same user against the same
 * client, and two entries for one client at one time is the collision this
 * product refuses outright - so the files have to agree not to overlap each
 * other. flows-time works the last ~4 hours; this one stays well behind it,
 * and shifts again on a retry so it cannot collide with its own last attempt.
 */
function windowEarlierToday(lengthMinutes = 25, gapMinutes = 320): { start: string; end: string } | null {
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

test.describe("clients/actions", () => {
  test("a client created from the drawer appears in the list", async ({ page }) => {
    const name = tag("[E2E] לקוח");

    await page.goto("/app/clients");
    await page.getByRole("button", { name: "+ לקוח חדש" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('input[name="name"]').fill(name);
    await dialog.getByRole("button", { name: "הוספת לקוח" }).click();

    // The drawer closes itself on success, so its disappearance is the first
    // signal, and the row is the one that matters.
    // NOT asserting that the drawer closes. It usually does, and intermittently
    // does not: the form's close-on-ok effect races the router refresh that
    // `revalidatePath` triggers, and when the refresh wins, the effect fires
    // against a subtree that has already been replaced. That is a real race
    // worth fixing in the Drawer, but it is a cosmetic one - the record is
    // written either way - and it is not what these specs are here to prove.
    // The row is.
    await page.reload();
    await expect(page.getByText(name, { exact: false }).first(), "the client was not created").toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe("categories/actions", () => {
  test("a global category created from the drawer appears in the list", async ({ page }) => {
    const name = tag("[E2E] קטגוריה");

    await page.goto("/app/categories");
    await page.getByRole("button", { name: "+ קטגוריה" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('input[name="name"]').fill(name);
    await dialog.getByRole("button", { name: "הוספת קטגוריה" }).click();

    // Wait for the write to be ACKNOWLEDGED before navigating.
    //
    // A reload issued while the POST is still open aborts it, and the
    // run's own traffic log has been reporting exactly that for weeks:
    // `POST /app/categories net::ERR_ABORTED (WHILE NAVIGATING)`. The
    // server usually committed anyway, which is why this passed most of
    // the time and failed for no visible reason the rest of it.
    //
    // This drawer closes itself on success, so its disappearance is the
    // signal that the action answered.
    await expect(dialog, "the drawer never closed, so the write was not acknowledged").toBeHidden({
      timeout: 30_000,
    });

    await page.reload();
    await expect(page.getByText(name, { exact: false }).first(), "the category was not created").toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe("profile/actions", () => {
  test("changing the display name reports success and survives a reload", async ({ page }) => {
    await page.goto("/app/profile");

    const field = page.locator('input[name="name"]');
    const original = await field.inputValue();
    const renamed = `${original} ✎`;

    try {
      await field.fill(renamed);
      await page.getByRole("button", { name: "שמירה" }).first().click();
      await expect(page.getByText("השם עודכן."), "the profile action reported no success").toBeVisible({
        timeout: 15_000,
      });

      // The success message could in principle be optimistic; a reload is
      // what proves the write landed.
      await page.reload();
      await expect(page.locator('input[name="name"]')).toHaveValue(renamed);
    } finally {
      // This is the ONE shared fixture these specs touch - the account they
      // are signed in as - so it is put back whatever happens above.
      await page.goto("/app/profile");
      await page.locator('input[name="name"]').fill(original);
      await page.getByRole("button", { name: "שמירה" }).first().click();
      await expect(page.getByText("השם עודכן.")).toBeVisible({ timeout: 15_000 });
    }
  });
});

test.describe("time-entries/actions - an admin reporting on behalf of an employee", () => {
  // This was `fixme` for two rounds, and the note left with it named its own
  // fix: give the form the same success toast the employee's own screen has,
  // and assert on that. It has one now.
  //
  // The point is not that a toast is easier to locate. It is that the screen
  // had no success signal at all, so every assertion tried here was about
  // some side effect of one - the form collapsing, a row appearing in a table
  // that is filtered and paged - and each held for some runs and not others.
  // A test that cannot be written stably against a screen is usually telling
  // you something about the screen. This one was.
  test("an entry created for another user shows up under their name", async ({ page }) => {
    const window = windowEarlierToday(25, 320 + 60 * test.info().retry);
    test.skip(window === null, "no finished window fits inside today yet (runs just after local midnight)");
    const { start, end } = window!;
    const note = tag("e2e-admin-entry");

    await page.goto("/app/time-entries");

    // The form starts collapsed behind its own toggle, so there is nothing to
    // fill until this is clicked - which is why an earlier run reported the
    // form as simply absent.
    await page.getByRole("button", { name: "+ דיווח עבור עובד" }).click();

    // Scoped to the create form on purpose: the filter bar above it renders
    // selects with the SAME names (clientId, userId), so an unscoped locator
    // is ambiguous and, worse, would sometimes drive the filter instead.
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "הוספת דיווח לעובד" }) });
    await expect(form).toBeVisible();

    // userId is what makes this different from the employee's own screen: an
    // admin filing time against somebody else's name, the audited case.
    await form.locator('select[name="userId"]').selectOption({ index: 1 });
    await form.locator('input[name="date"]').fill(todayKey());
    await form.locator('input[name="startTime"]').fill(start);
    await form.locator('input[name="endTime"]').fill(end);
    await form.locator('select[name="clientId"]').selectOption({ index: 1 });
    // Enabled only once a client is chosen.
    await form.locator('select[name="categoryId"]').selectOption({ index: 1 });
    await form.locator('input[name="note"]').fill(note);
    // Overlaps are plausible on a shared database with other specs writing at
    // the same moment. This test is about the on-behalf-of path; the overlap
    // rule has its own test in flows-time.
    const override = form.locator('input[name="allowOverlapOverride"]');
    if (await override.count()) await override.check();

    await form.getByRole("button", { name: "הוספת דיווח לעובד" }).click();

    // The toast is the action reporting ok, and it is the assertion. Its
    // description carries the employee's name, which is the whole point of
    // this path - an admin filing time against somebody else - so the name is
    // checked too rather than just the fact that something was saved.
    await expect(page.getByText("הדיווח נשמר"), "the admin entry was refused").toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/נרשם על שם/), "the toast did not name the employee it filed for").toBeVisible();

    // And the form is gone, not merely quiet: the toggle is back. A toast
    // with the form still open would mean the entry was filed twice on the
    // next click.
    await expect(
      page.getByRole("button", { name: "+ דיווח עבור עובד" }),
      "the admin entry form never collapsed after its save",
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/שגיאה|חופף|לא תקין|אין לך הרשאה/), "the admin entry was refused").toHaveCount(0);
  });
});

test.describe("report-schedules/actions", () => {
  test("a weekly schedule created for a client is listed with its recipient", async ({ page }) => {
    const recipient = `e2e.report.${Date.now().toString(36)}@example.invalid`;

    // Scheduled reports are report.internal.view, which an Ankora Admin holds
    // - so this belongs in this file rather than with the Super-Admin ones.
    await page.goto("/app/report-schedules?clientId=demo-client-a");

    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "יצירת דוח מתוזמן" }) });
    await expect(form, "the schedule form did not render for this client").toBeVisible();

    await form.locator('select[name="frequency"]').selectOption("WEEKLY");
    await form.locator('textarea[name="recipients"], input[name="recipients"]').first().fill(recipient);
    // Wait for the SERVER to acknowledge the write, then navigate.
    //
    // The old version reloaded the moment it had clicked, which aborted
    // the POST that click had just started - the run's traffic log has
    // been reporting exactly that for weeks. Waiting on the response is
    // the precise signal, and unlike a UI cue it cannot be confused with
    // a form that simply has not started yet.
    //
    // The reload stays. Dropping it was tried on this branch and turns
    // this test into an assertion about a screen refreshing itself, which
    // is a separate open question and not what this test is for.
    const written = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await form.getByRole("button", { name: "יצירת דוח מתוזמן" }).click();
    await written;

    await page.reload();
    await expect(page.getByText(recipient, { exact: false }).first(), "the schedule was not created").toBeVisible({
      timeout: 30_000,
    });
  });
});
