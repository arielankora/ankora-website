import { test, expect } from "@playwright/test";

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

/**
 * A finished window earlier today, or null if one will not fit.
 *
 * Same constraint the other flow files work around: the domain refuses an
 * entry more than five minutes in the future, and an entry dated
 * yesterday demands a backdate reason. So the window is walked back from
 * the current hour and must land inside today; shortly after local
 * midnight it cannot, and these tests skip saying so rather than
 * inventing a time the product is right to reject.
 *
 * The band here is this file's own - roughly 5 to 7 hours back. The other
 * two flow files write nearer the present, and two entries for the same
 * employee at the same moment is exactly the overlap this product
 * refuses. Files that collide there make each other look broken.
 */
function windowEarlierToday(): { start: string; end: string } | null {
  const [hh, mm] = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date())
    .split(":")
    .map(Number);

  const nowMinutes = hh * 60 + mm;
  const end = nowMinutes - 300;
  const start = end - 45;
  if (start < 0) return null;

  const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return { start: fmt(start), end: fmt(end) };
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
    const window = windowEarlierToday();
    test.skip(window === null, "no finished window fits inside today yet (runs shortly after local midnight)");

    const note = tag("[E2E] דיווח");
    await openCreateForm(page);

    // First option of each select, whatever the fixtures happen to be.
    // Naming a seeded employee or client here would be a fixture
    // dependency in disguise, and the point of this test is the form,
    // not which row it picks.
    await page.locator('select[name="userId"]').selectOption({ index: 1 });
    await page.locator('select[name="clientId"]').selectOption({ index: 1 });
    await page.locator('select[name="categoryId"]').selectOption({ index: 1 });
    await page.locator('input[name="date"]').fill(todayKey());
    await page.locator('input[name="startTime"]').fill(window!.start);
    await page.locator('input[name="endTime"]').fill(window!.end);
    await page.locator('[name="note"]').fill(note);

    await page.getByRole("button", { name: /שמירה|הוספה|דיווח/ }).last().click();
    await page.waitForLoadState("networkidle");
    await page.reload();

    await expect(page.getByText(note, { exact: false }).first(), "the entry was not created").toBeVisible({
      timeout: 15_000,
    });
  });

  test("refuses an end time before the start, without creating anything", async ({ page }) => {
    const window = windowEarlierToday();
    test.skip(window === null, "no finished window fits inside today yet");

    const note = tag("[E2E] הפוך");
    await openCreateForm(page);

    await page.locator('select[name="userId"]').selectOption({ index: 1 });
    await page.locator('select[name="clientId"]').selectOption({ index: 1 });
    await page.locator('select[name="categoryId"]').selectOption({ index: 1 });
    await page.locator('input[name="date"]').fill(todayKey());
    // Inverted on purpose.
    await page.locator('input[name="startTime"]').fill(window!.end);
    await page.locator('input[name="endTime"]').fill(window!.start);
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
