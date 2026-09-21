import { test, expect } from "@playwright/test";

// Disconnecting Claude from inside the app.
//
// The action behind this button revokes one of the CALLING user's own
// grants and takes no user id - ownership lives in the WHERE clause, not
// in a form field, which is the right shape and is covered by the domain
// tests. What those cannot see is the half this spec is for: whether the
// button on the screen hands that action the right grant, and whether
// the screen then tells the truth about what happened.
//
// That gap matters more here than the wiring usually does. Someone
// presses "disconnect" because they have decided a credential should
// stop working - often right now, often because a laptop is gone. A
// button that appears to succeed while revoking nothing is worse than a
// button that errors, because the person stops worrying.
//
// Prose warning, same as the other flow files: coverage is inferred from
// the TEXT of these files, and a Server Action inherits the module paths
// it imports. Refer to modules in words, never as paths.
//
// @covers action:(product)/app/(authenticated)/mcp-actions

// Serial, and this file genuinely needs it where the others do not.
//
// Everywhere else in this directory each test creates the row it acts
// on, so the suite can run fullyParallel against one database. Here the
// row is seeded rather than created - a grant cannot be made from the
// UI, only revoked through it - which means these tests share one
// consumable fixture. Run in parallel, the test that revokes it makes
// the tests that list it look broken. Serial is the honest fix; making
// each test seed its own grant would mean a Playwright spec writing
// straight to the database, which is a door worth not opening.
test.describe.configure({ mode: "serial", timeout: 90_000 });

// The seed gives the Ankora Admin exactly one connection, labelled
// "[DEMO] MacBook Air". Its token hash hashes nothing, so the grant
// cannot authenticate anything - it exists to be listed and revoked.
const SEEDED_GRANT = "[DEMO] MacBook Air";

test.describe("the connections list", () => {
  test("lists the seeded connection on both screens that render it", async ({ page }) => {
    // The card is shared between Profile and Integrations on purpose, and
    // a card that renders on one and throws on the other is a plausible
    // regression the sweep would not catch: both pages would still be 200.
    for (const route of ["/app/integrations", "/app/profile"]) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      const body = await page.locator("body").innerText();
      expect(body, `${route} error boundary`).not.toMatch(/Application error|Internal Server Error/);
    }

    await page.goto("/app/integrations");
    await expect(page.getByText(SEEDED_GRANT, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  });

  test("never prints the token itself, only its label", async ({ page }) => {
    await page.goto("/app/integrations");
    const html = await page.content();

    // The row holds a hash. Rendering the record is one careless spread
    // away from rendering every field on it, and this screen is the one
    // place a credential row reaches a template at all.
    expect(html, "the stored hash reached the page").not.toContain("demo-grant-not-a-real-token-hash");
    expect(html).not.toContain("tokenHash");
  });
});

test.describe("disconnecting", () => {
  test("asks for confirmation first, and does nothing until it is given", async ({ page }) => {
    await page.goto("/app/integrations");
    const row = page.getByText(SEEDED_GRANT, { exact: false }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "ניתוק" }).first().click();
    await expect(page.getByRole("button", { name: "אישור ניתוק" }).first()).toBeVisible();

    // Backing out must leave the connection alone. A confirm step that
    // has already acted by the time it asks is not a confirm step.
    await page.getByRole("button", { name: "ביטול" }).first().click();
    await page.reload();
    await expect(page.getByText(SEEDED_GRANT, { exact: false }).first()).toBeVisible();
  });

  test("a confirmed disconnect removes the connection and it stays gone", async ({ page }) => {
    await page.goto("/app/integrations");
    await expect(page.getByText(SEEDED_GRANT, { exact: false }).first()).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "ניתוק" }).first().click();
    await page.getByRole("button", { name: "אישור ניתוק" }).first().click();
    await page.waitForLoadState("networkidle");

    // Reload rather than trusting the optimistic update. The question is
    // whether the row was revoked in the database, not whether React
    // stopped drawing it.
    await page.reload();
    await expect(
      page.getByText(SEEDED_GRANT, { exact: false }),
      "the connection came back after a reload - the revoke did not persist",
    ).toHaveCount(0);
  });
});
