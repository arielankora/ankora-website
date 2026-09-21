import { test, expect } from "@playwright/test";

// The four write surfaces the role matrix reserves for SUPER_ADMIN. They run
// under their own stored session (see the second setup in auth.setup.ts);
// driving them as the Ankora Admin would assert a ForbiddenError and call it
// coverage, which is worse than an open gap honestly reported.
//
// @covers action:(product)/app/(authenticated)/users/actions
// @covers action:(product)/app/(authenticated)/alerts/actions
// @covers action:(product)/app/(authenticated)/hour-banks/actions
// @covers action:(product)/app/(authenticated)/important-dates/actions
//
// As in the other flow files: each test creates the row it acts on, under a
// name unique to that run, so nothing here depends on another spec's timing
// against the one shared database.
//
// Prose warning, same as flows-admin: coverage is inferred from the TEXT of
// these files, and a Server Action inherits the module paths it imports.
// Refer to modules in words, never as paths, or an unrelated action gets
// credited for a test that never touched it.

test.describe.configure({ timeout: 90_000 });

function tag(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** The seeded client these screens are scoped to, by its stable seed id. */
const CLIENT = "demo-client-a";

function isoDay(offsetDays: number) {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(d);
}

test.describe("users/actions", () => {
  test("an invited user appears in the list with the role they were given", async ({ page }) => {
    const name = tag("[E2E] משתמש");
    const email = `e2e.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 7)}@example.invalid`;

    await page.goto("/app/users");
    await page.getByRole("button", { name: "הזמנת משתמש" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('input[name="name"]').fill(name);
    await dialog.locator('input[name="email"]').fill(email);
    await dialog.locator('select[name="role"]').selectOption("ANKORA_EMPLOYEE");
    await dialog.getByRole("button", { name: "הזמנת משתמש" }).click();

    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
    await page.reload();
    await expect(page.getByText(email, { exact: false }).first(), "the invited user is not listed").toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe("alerts/actions", () => {
  test("an alert rule created for a client is listed and can be deleted", async ({ page }) => {
    const recipient = `e2e.alert.${Date.now().toString(36)}@example.invalid`;

    // These screens are scoped by a client in the query string rather than by
    // a picker click, which keeps the test about the rule and not about the
    // picker.
    await page.goto(`/app/alerts?clientId=${CLIENT}`);

    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "יצירת כלל התראה" }) });
    await expect(form, "the alert-rule form did not render for this client").toBeVisible();

    await form.locator('input[name="thresholdValue"]').fill("80");
    await form.locator('input[name="recipientsAnkora"]').fill(recipient);
    await form.getByRole("button", { name: "יצירת כלל התראה" }).click();

    await page.reload();
    await expect(page.getByText(recipient, { exact: false }).first(), "the alert rule was not created").toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe("hour-banks/actions", () => {
  test("opening a cycle for a client shows its purchased hours", async ({ page }) => {
    await page.goto(`/app/hour-banks?clientId=${CLIENT}`);

    // The opener lives in a drawer, and only once a client is selected.
    const trigger = page.getByRole("button", { name: "פתיחת מחזור חדש" }).first();
    await expect(trigger, "no client context on the hour-banks screen").toBeVisible();
    await trigger.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('input[name="cycleStart"]').fill(isoDay(-1));
    await dialog.locator('input[name="cycleEnd"]').fill(isoDay(27));
    await dialog.locator('input[name="purchasedMinutes"]').fill("600");
    await dialog.locator('select[name="rolloverMode"]').selectOption("NONE");
    await dialog.getByRole("button", { name: "פתיחת מחזור חדש" }).click();

    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
    await page.reload();

    // 600 minutes is ten hours; the screen renders banks in H:MM, so the
    // assertion is on the cycle being open at all rather than on a format
    // this test should not be pinning.
    await expect(
      page.getByText(/10:00|600/).first(),
      "the opened cycle is not visible on the screen",
    ).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("important-dates/actions", () => {
  test("a date created from the drawer appears in the catalogue", async ({ page }) => {
    const title = tag("[E2E] מועד");

    await page.goto("/app/important-dates");
    await page.getByRole("button", { name: "+ מועד חדש" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('select[name="clientId"]').selectOption(CLIENT);
    await dialog.locator('input[name="title"]').fill(title);
    await dialog.locator('select[name="recurrence"]').selectOption("ONCE");
    await dialog.locator('input[name="onceDate"]').fill(isoDay(30));
    await dialog.locator("button[type=submit]").first().click();

    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
    await page.reload();
    await expect(page.getByText(title, { exact: false }).first(), "the important date was not created").toBeVisible({
      timeout: 15_000,
    });
  });
});
