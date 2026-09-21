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

// Super Admin, not employee. The first version of this file was named
// `.app.spec.ts` and ran under the employee session, where
// /app/integrations renders a permission notice and nothing else:
// integration.manage is Super-Admin-only. The test reported "the seeded
// grant did not reach this screen" - true, and for a reason that had
// nothing to do with the seed. The grant moved to the Super Admin in the
// same change, because the card shows the calling user's own grants.
//
// The seed gives that user one connection, labelled "[DEMO] MacBook
// Air", whose token hash hashes nothing - it exists to be listed and
// revoked, and cannot authenticate anything.
//
// The tests find it by its own disconnect control rather than by that
// label. The first run looked for the label and found nothing, which
// could mean the seed did not take, or the card renders elsewhere, or
// the text is split across elements - three different faults reported
// identically. Locating by the control answers a better question: is
// there a connection on this screen that a person could disconnect?
function revokeTriggers(page: import("@playwright/test").Page) {
  return page.getByRole("button", { name: "ניתוק" });
}

/**
 * How many connections are listed, after giving the list a chance to render.
 *
 * A bare `count()` straight after a navigation answers "how many are on
 * the page right now", which just after a reload is often "none yet".
 * The two tests below both use that number to decide whether to skip,
 * so reading it too early does not fail loudly - it SKIPS, and a
 * disconnect test that silently skipped is a disconnect test nobody is
 * running. Waiting for the first control first turns "not rendered yet"
 * into "rendered, and here is the real number", and leaves a genuine
 * zero as a genuine zero.
 */
async function countRevokeTriggers(page: import("@playwright/test").Page): Promise<number> {
  await revokeTriggers(page)
    .first()
    .waitFor({ state: "visible", timeout: 10_000 })
    .catch(() => {
      // Genuinely none listed. The callers treat that as a skip, which
      // is the honest outcome when there is no fixture to revoke.
    });
  return revokeTriggers(page).count();
}

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
    await expect(
      revokeTriggers(page).first(),
      "no connection is listed - the seeded grant did not reach this screen",
    ).toBeVisible({ timeout: 15_000 });
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
    const before = await countRevokeTriggers(page);
    test.skip(before === 0, "no connection listed to disconnect");

    await revokeTriggers(page).first().click();
    await expect(page.getByRole("button", { name: "אישור ניתוק" }).first()).toBeVisible();

    // Backing out must leave the connection alone. A confirm step that
    // has already acted by the time it asks is not a confirm step.
    await page.getByRole("button", { name: "ביטול" }).first().click();
    await page.reload();

    // expect.poll, not a one-shot count().
    //
    // `await locator.count()` samples the page once, the instant it is
    // called. A reload resolves as soon as the document is ready, which
    // can be before the list has rendered - so the count comes back 0
    // and the test reports "backing out removed the connection anyway",
    // which is the most alarming sentence this file can produce and, in
    // that case, not true. Same class of bug as the fabricated-id and
    // portal specs; this is the third place it has appeared.
    await expect
      .poll(() => revokeTriggers(page).count(), {
        message: "backing out removed the connection anyway",
      })
      .toBe(before);
  });

  test("a confirmed disconnect removes the connection and it stays gone", async ({ page }) => {
    await page.goto("/app/integrations");
    const before = await countRevokeTriggers(page);
    test.skip(before === 0, "no connection listed to disconnect");

    await revokeTriggers(page).first().click();
    await page.getByRole("button", { name: "אישור ניתוק" }).first().click();
    await page.waitForLoadState("networkidle");

    // Reload rather than trusting the optimistic update. The question is
    // whether the row was revoked in the database, not whether React
    // stopped drawing it.
    await page.reload();
    await expect
      .poll(() => revokeTriggers(page).count(), {
        message: "the connection came back after a reload - the revoke did not persist",
      })
      .toBe(before - 1);
  });
});
