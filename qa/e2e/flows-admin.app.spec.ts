import { test, expect } from "@playwright/test";

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
// @covers action:(product)/app/(authenticated)/time-entries/actions

function tag(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
}

function windowEarlierToday(lengthMinutes = 25, gapMinutes = 150): { start: string; end: string } | null {
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
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
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

    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
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
  test("an entry created for another user shows up under their name", async ({ page }) => {
    const window = windowEarlierToday();
    test.skip(window === null, "no finished window fits inside today yet (runs just after local midnight)");
    const { start, end } = window!;
    const note = tag("e2e-admin-entry");

    await page.goto("/app/time-entries");

    // userId is the field that makes this different from the employee's own
    // screen: an admin is filing time against somebody else's name, which is
    // the audited case spec 6.3 singles out.
    await page.locator('select[name="userId"]').selectOption({ index: 1 });
    await page.locator('input[name="date"]').fill(todayKey());
    await page.locator('input[name="startTime"]').fill(start);
    await page.locator('input[name="endTime"]').fill(end);
    await page.locator('select[name="clientId"]').selectOption({ index: 1 });
    await page.locator('select[name="categoryId"]').selectOption({ index: 1 });
    await page.locator('input[name="note"]').fill(note);
    // Overlaps are plausible on a shared seeded database with other specs
    // writing at the same time; this test is about the on-behalf-of path, so
    // it does not also assert the overlap rule (flows-time covers that).
    const override = page.locator('input[name="allowOverlapOverride"]');
    if (await override.count()) await override.check();

    await page.getByRole("button", { name: "הוספת דיווח לעובד" }).click();

    await expect(page.getByText(note, { exact: false }).first(), "the admin entry was not created").toBeVisible({
      timeout: 15_000,
    });
  });
});
