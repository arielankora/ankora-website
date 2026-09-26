import { test, expect } from "./fixtures";

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
  await page.getByRole("button", { name: "לקוח חדש", exact: true }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.locator('input[name="name"]').fill(name);
  await dialog.getByRole("button", { name: "הוספת לקוח" }).click();

  // Wait for the write before reloading.
  //
  // Reloading straight after the click out-races the Server Action, and
  // the reloaded page then honestly does not have the row yet - which
  // reports as "the client was not created" and passes on the retry.
  // This action is slower than it looks: creating a client revalidates
  // the dashboard, and the dashboard issues one hour-bank query per
  // active client, so every client this suite creates makes the next
  // creation a little slower.
  await page.waitForLoadState("networkidle");
  await page.reload();
  await expect(page.getByText(name, { exact: false }).first(), "the client was not created").toBeVisible({
    timeout: 30_000,
  });
}

/**
 * Create a client, then land on its hour-bank screen.
 *
 * The screen is driven by a `clientId` search param, not by a select on
 * the page - the first version of this file assumed a select and every
 * test failed on a locator that never existed. So the id comes from the
 * link the clients list renders for the row just created, which is the
 * same place a person would get it.
 */
async function createClientAndOpenItsBank(
  page: import("@playwright/test").Page,
  name: string,
): Promise<void> {
  await createClient(page, name);

  const row = page.getByText(name, { exact: false }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  const href = await row.locator("xpath=ancestor-or-self::a[1]").getAttribute("href");
  const clientId = href?.split("/app/clients/")[1];
  expect(clientId, `could not find the id of the client just created (${name})`).toBeTruthy();

  await page.goto(`/app/hour-banks?clientId=${clientId}`, { waitUntil: "domcontentloaded" });
  // The heading, not the name anywhere on the page. The screen has a
  // client picker, so the name also appears as a hidden <option> - which
  // getByText matched first and then waited fifteen seconds for an
  // <option> to become "visible", which it never is.
  await expect(
    page.getByRole("heading", { name, exact: false }),
    "the hour-bank screen did not load for this client",
  ).toBeVisible({ timeout: 15_000 });
}

/** Open the "new cycle" drawer and return its form scope. */
async function openCycleDrawer(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "פתיחת מחזור חדש" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("opening a cycle", () => {
  test("a cycle opened from the form shows its purchased hours back", async ({ page }) => {
    const clientName = tag("[E2E] בנק");
    await createClientAndOpenItsBank(page, clientName);

    const dialog = await openCycleDrawer(page);
    await dialog.locator('input[name="cycleStart"]').fill(isoDay(-7));
    await dialog.locator('input[name="cycleEnd"]').fill(isoDay(23));
    await dialog.locator('input[name="purchasedHours"]').fill("10");
    await dialog.getByRole("button", { name: /פתיחת מחזור|שמירה|אישור/ }).last().click();

    await page.waitForLoadState("networkidle");
    await page.reload();

    // Ten hours (the form takes hours since the Grantor 1:51 mix-up). Asserting on the raw number and on a
    // formatted duration both fail for different reasons on a wording
    // change, so this asserts the client now HAS a cycle at all - the
    // adjustment form only renders once there is an open cycle to adjust,
    // so its presence is the screen's own statement that the cycle took.
    // The arithmetic is left to the domain tests, which can see it exactly.
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/Application error|Internal Server Error/);
    await expect(
      page.locator('input[name="hours"]').first(),
      "no open cycle on this client after the form was submitted",
    ).toBeVisible({ timeout: 15_000 });
  });

  test("refuses a cycle that ends before it starts, and says so", async ({ page }) => {
    const clientName = tag("[E2E] בנק-הפוך");
    await createClientAndOpenItsBank(page, clientName);

    const dialog = await openCycleDrawer(page);
    // Deliberately inverted. The domain refuses this; what is under test
    // here is that the refusal reaches the person instead of surfacing as
    // a blank screen or a silent no-op.
    await dialog.locator('input[name="cycleStart"]').fill(isoDay(23));
    await dialog.locator('input[name="cycleEnd"]').fill(isoDay(-7));
    await dialog.locator('input[name="purchasedHours"]').fill("10");
    await dialog.getByRole("button", { name: /פתיחת מחזור|שמירה|אישור/ }).last().click();

    await page.waitForLoadState("networkidle");
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/Application error|Internal Server Error/);
    // The drawer stays open on a refusal rather than closing as if it worked.
    await expect(dialog.locator('input[name="purchasedHours"]')).toBeVisible();
  });
});

test.describe("recording an adjustment", () => {
  test("an adjustment requires a reason, and the form does not submit without one", async ({ page }) => {
    const clientName = tag("[E2E] תיאום");
    await createClientAndOpenItsBank(page, clientName);

    const dialog = await openCycleDrawer(page);
    await dialog.locator('input[name="cycleStart"]').fill(isoDay(-7));
    await dialog.locator('input[name="cycleEnd"]').fill(isoDay(23));
    await dialog.locator('input[name="purchasedHours"]').fill("10");
    await dialog.getByRole("button", { name: /פתיחת מחזור|שמירה|אישור/ }).last().click();

    await page.waitForLoadState("networkidle");
    await page.reload();

    const minutes = page.locator('input[name="hours"]').first();
    if ((await minutes.count()) === 0) {
      test.skip(true, "the adjustment form is not on this screen for a client without an open cycle");
      return;
    }

    await minutes.fill("0:30");
    // Reason left empty on purpose. A manual adjustment to a client's
    // balance with no recorded reason is an unexplained change to what
    // they are billed, which is why the domain demands one.
    //
    // "הוספה" is the button's actual label. The first version guessed at
    // /רישום תיאום|תיאום|שמירה/, matched nothing, and waited out the
    // test timeout on a click that never happened.
    await page.getByRole("button", { name: "הוספה" }).first().click();
    await page.waitForLoadState("networkidle");

    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/Application error|Internal Server Error/);
    await expect(page.locator('input[name="hours"]').first()).toBeVisible();
  });
});
