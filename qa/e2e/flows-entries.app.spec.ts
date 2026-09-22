import { test, expect } from "./fixtures";

// The admin time-entries write path.
//
// This is the screen where one person files time on behalf of another,
// which makes it the highest-consequence form in the product: the entry
// it creates carries a different userId from the actor who created it,
// and everything downstream - a client's invoice, an employee's
// timesheet, a scheduled report - takes it at face value. The capability
// scan had this action at critical with no browser coverage.
//
// Prose warning, same as the other flow files: coverage is inferred from
// the TEXT of these files, and a Server Action inherits the module paths
// it imports. Refer to modules in words, never as paths.
//
// @covers action:(product)/app/(authenticated)/time-entries/actions

test.describe.configure({ timeout: 90_000 });

function tag(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
}

/** Yesterday, in the timezone the product reasons in. */
function yesterdayKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(
    new Date(Date.now() - 86_400_000),
  );
}

/**
 * A fixed window on YESTERDAY, shifted by the attempt number.
 *
 * The first version of this file carved out a band of today - roughly 5
 * to 7 hours back - on the theory that the other flow files write nearer
 * the present. They do, except on retry: every one of them shifts its
 * window an hour further back per attempt, and flows-admin's band starts
 * at 5h20m. The two overlapped exactly, for the same employee, which is
 * the one collision this product refuses outright. Both files then
 * reported the other one's entry as their own failure to save.
 *
 * Dividing one day between four files and their retries does not work:
 * every band added pushes the next one deeper, and a band deep enough is
 * a test that skips itself on the nightly run at six in the morning.
 *
 * Yesterday has no other tenants, and dating an entry there means the
 * form demands a reason for it - a required field that no other spec
 * exercises. The conflict is gone and the coverage is wider.
 */
function windowYesterday(attempt = 0): { start: string; end: string } {
  // 09:00 onwards, one hour per attempt. Well clear of midnight at both
  // ends, so no timezone rounding can push it into today or the day
  // before - a window that drifts across a date boundary is a test that
  // fails once a year for a reason nobody will find.
  const startMinutes = 9 * 60 + attempt * 60;
  const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return { start: fmt(startMinutes), end: fmt(startMinutes + 45) };
}

async function openCreateForm(page: import("@playwright/test").Page) {
  await page.goto("/app/time-entries");
  const trigger = page.getByRole("button", { name: "+ דיווח עבור עובד" });
  await expect(trigger, "the admin create-entry trigger is not on this screen").toBeVisible({ timeout: 15_000 });
  await trigger.click();
  await expect(page.locator('select[name="userId"]')).toBeVisible();
}

test.describe("filing time for someone else", () => {
  test("an entry created for an employee appears with its note", async ({ page }) => {
    const window = windowYesterday(test.info().retry);
    const note = tag("[E2E] דיווח");
    await openCreateForm(page);

    // First option of each select, whatever the fixtures happen to be.
    // Naming a seeded employee or client here would be a fixture
    // dependency in disguise, and the point of this test is the form,
    // not which row it picks.
    await page.locator('select[name="userId"]').selectOption({ index: 1 });
    await page.locator('select[name="clientId"]').selectOption({ index: 1 });
    await page.locator('select[name="categoryId"]').selectOption({ index: 1 });
    await page.locator('input[name="date"]').fill(yesterdayKey());
    await page.locator('input[name="startTime"]').fill(window.start);
    await page.locator('input[name="endTime"]').fill(window.end);
    await page.locator('[name="note"]').fill(note);

    // The reason field only renders once the date is not today, so this
    // also proves the form notices the change. Without it the domain
    // refuses the write, which is the rule being exercised here.
    const reason = page.locator('[name="backdateReason"]');
    await expect(reason, "the backdate reason field did not appear for a past date").toBeVisible({
      timeout: 10_000,
    });
    await reason.fill("דיווח מאוחר - בדיקה אוטומטית");

    await page.getByRole("button", { name: /שמירה|הוספה|דיווח/ }).last().click();
    await page.waitForLoadState("networkidle");

    // Say what the form said, if it said no.
    //
    // "the entry was not created" is true and useless: a refused write
    // and a slow one look identical from the row that is missing. The
    // form renders its reason, so a failure here should carry it rather
    // than send the next person to read the server log.
    const refusal = (await page.locator("body").innerText()).match(
      /יש (?:לציין|לבחור|להזין)[^\n]{0,80}|חופף[^\n]{0,80}|לא ניתן[^\n]{0,80}/,
    );

    await page.reload();
    await expect(
      page.getByText(note, { exact: false }).first(),
      `the entry was not created${refusal ? ` - the form said: ${refusal[0]}` : ""}`,
      // 30s, matching the client-creation helper, and for the same
      // reason: the write revalidates the dashboard, and the dashboard
      // issues one hour-bank query per active client. The form said
      // nothing when this flaked, which rules out a refusal and leaves
      // only "not finished yet".
    ).toBeVisible({ timeout: 30_000 });
  });

  test("refuses an end time before the start, without creating anything", async ({ page }) => {
    // Stays on today: this write is meant to be refused, so it creates
    // nothing and can share a band with anyone.
    const window = windowYesterday(0);
    const note = tag("[E2E] הפוך");
    await openCreateForm(page);

    await page.locator('select[name="userId"]').selectOption({ index: 1 });
    await page.locator('select[name="clientId"]').selectOption({ index: 1 });
    await page.locator('select[name="categoryId"]').selectOption({ index: 1 });
    await page.locator('input[name="date"]').fill(todayKey());
    // Inverted on purpose.
    await page.locator('input[name="startTime"]').fill(window.end);
    await page.locator('input[name="endTime"]').fill(window.start);
    await page.locator('[name="note"]').fill(note);

    await page.getByRole("button", { name: /שמירה|הוספה|דיווח/ }).last().click();
    await page.waitForLoadState("networkidle");

    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/Application error|Internal Server Error/);

    // The refusal has to be real, not just unreported: nothing with this
    // note may exist after a reload.
    await page.reload();
    await expect(page.getByText(note, { exact: false })).toHaveCount(0);
  });

  test("refuses a future-dated entry, which is a rule the product enforces deliberately", async ({ page }) => {
    const note = tag("[E2E] עתידי");
    const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(
      new Date(Date.now() + 86_400_000),
    );

    await openCreateForm(page);
    await page.locator('select[name="userId"]').selectOption({ index: 1 });
    await page.locator('select[name="clientId"]').selectOption({ index: 1 });
    await page.locator('select[name="categoryId"]').selectOption({ index: 1 });
    await page.locator('input[name="date"]').fill(tomorrow);
    await page.locator('input[name="startTime"]').fill("09:00");
    await page.locator('input[name="endTime"]').fill("10:00");
    await page.locator('[name="note"]').fill(note);

    await page.getByRole("button", { name: /שמירה|הוספה|דיווח/ }).last().click();
    await page.waitForLoadState("networkidle");
    await page.reload();

    // Three integration tests assert the guard itself. This asserts the
    // form cannot walk around it - the same rule, reached the way a
    // person reaches it.
    await expect(page.getByText(note, { exact: false })).toHaveCount(0);
  });
});
