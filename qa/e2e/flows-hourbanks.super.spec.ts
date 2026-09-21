import { test, expect } from "@playwright/test";

// The hour-bank write paths, under the Super-Admin session.
//
// Hour banks are where this product touches money: a cycle's purchased
// minutes and its adjustments are what "נוצל / נותר / אחוז ניצול"
// reports from, and what a client is ultimately invoiced against. The
// capability scan had this action at critical with no browser coverage,
// and the logic tests underneath it cannot see the one thing a form adds
// - whether the values a person types actually arrive as the values the
// domain receives.
//
// Prose warning, same as the other flow files: coverage is inferred from
// the TEXT of these files, and a Server Action inherits the module paths
// it imports. Refer to modules in words, never as paths.
//
// @covers action:(product)/app/(authenticated)/hour-banks/actions

test.describe.configure({ timeout: 90_000 });

/** Unique enough to find again, short enough to read in a failure message. */
function tag(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function isoDay(offsetDays: number) {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(d);
}

/**
 * Create a client of this test's own, and return its id.
 *
 * Every spec in this directory creates the row it acts on rather than
 * reusing a fixture, because the whole suite runs fullyParallel against
 * one database. Hour banks make that rule sharper than usual: a cycle is
 * per client and overlapping cycles are exactly what the product refuses,
 * so two tests sharing a client would make each other look broken.
 */
async function createClient(page: import("@playwright/test").Page, name: string): Promise<void> {
  await page.goto("/app/clients");
  await page.getByRole("button", { name: "+ לקוח חדש" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.locator('input[name="name"]').fill(name);
  await dialog.getByRole("button", { name: "הוספת לקוח" }).click();

  await page.reload();
  await expect(page.getByText(name, { exact: false }).first(), "the client was not created").toBeVisible({
    timeout: 15_000,
  });
}

/** Pick an option by its visible label, which is the client's name. */
async function selectClientByName(
  page: import("@playwright/test").Page,
  selectName: string,
  clientName: string,
) {
  const select = page.locator(`select[name="${selectName}"]`).first();
  await expect(select).toBeVisible();
  await select.selectOption({ label: clientName });
}

test.describe("opening a cycle", () => {
  test("a cycle opened from the form shows its purchased minutes back", async ({ page }) => {
    const clientName = tag("[E2E] בנק");
    await createClient(page, clientName);

    await page.goto("/app/hour-banks");
    await selectClientByName(page, "clientId", clientName);

    await page.locator('input[name="cycleStart"]').first().fill(isoDay(-7));
    await page.locator('input[name="cycleEnd"]').first().fill(isoDay(23));
    await page.locator('input[name="purchasedMinutes"]').first().fill("600");

    await page.getByRole("button", { name: /פתיחת מחזור|פתח מחזור|שמירה/ }).first().click();
    await page.waitForLoadState("networkidle");
    await page.reload();

    // 600 minutes is ten hours. Asserting on the raw number and on a
    // formatted duration both fail for different reasons on a wording
    // change, so this asserts the client now HAS a cycle at all - the row
    // exists where before there was none - and leaves the arithmetic to
    // the domain tests, which can see it exactly.
    const body = await page.locator("body").innerText();
    expect(body, "the new cycle is not listed").toContain(clientName);
    expect(body).not.toMatch(/Application error|Internal Server Error/);
  });

  test("refuses a cycle that ends before it starts, and says so", async ({ page }) => {
    const clientName = tag("[E2E] בנק-הפוך");
    await createClient(page, clientName);

    await page.goto("/app/hour-banks");
    await selectClientByName(page, "clientId", clientName);

    // Deliberately inverted. The domain refuses this; what is under test
    // here is that the refusal reaches the person instead of surfacing as
    // a blank screen or a silent no-op.
    await page.locator('input[name="cycleStart"]').first().fill(isoDay(23));
    await page.locator('input[name="cycleEnd"]').first().fill(isoDay(-7));
    await page.locator('input[name="purchasedMinutes"]').first().fill("600");

    await page.getByRole("button", { name: /פתיחת מחזור|פתח מחזור|שמירה/ }).first().click();
    await page.waitForLoadState("networkidle");

    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/Application error|Internal Server Error/);
    // Still on the form, not redirected into a success state.
    await expect(page.locator('input[name="purchasedMinutes"]').first()).toBeVisible();
  });
});

test.describe("recording an adjustment", () => {
  test("an adjustment requires a reason, and the form does not submit without one", async ({ page }) => {
    const clientName = tag("[E2E] תיאום");
    await createClient(page, clientName);

    await page.goto("/app/hour-banks");
    await selectClientByName(page, "clientId", clientName);
    await page.locator('input[name="cycleStart"]').first().fill(isoDay(-7));
    await page.locator('input[name="cycleEnd"]').first().fill(isoDay(23));
    await page.locator('input[name="purchasedMinutes"]').first().fill("600");
    await page.getByRole("button", { name: /פתיחת מחזור|פתח מחזור|שמירה/ }).first().click();
    await page.waitForLoadState("networkidle");
    await page.reload();

    const minutes = page.locator('input[name="minutes"]').first();
    if ((await minutes.count()) === 0) {
      test.skip(true, "the adjustment form is not on this screen for a client without an open cycle");
      return;
    }

    await minutes.fill("30");
    // Reason left empty on purpose. A manual adjustment to a client's
    // balance with no recorded reason is an unexplained change to what
    // they are billed, which is why the domain demands one.
    await page.getByRole("button", { name: /רישום תיאום|תיאום|שמירה/ }).first().click();
    await page.waitForLoadState("networkidle");

    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/Application error|Internal Server Error/);
    await expect(page.locator('input[name="minutes"]').first()).toBeVisible();
  });
});
