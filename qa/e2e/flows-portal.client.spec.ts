import { test, expect } from "@playwright/test";

// The one write path that belongs to a client rather than to Ankora.
//
// Spec 13 lets a Client Admin manage who their scheduled reports are
// emailed to. It is the only place in the product where someone outside
// the company changes something, and the thing being changed is a
// distribution list for a document containing that client's hours - so
// the cost of getting it wrong is a monthly report arriving at an
// address nobody meant to add.
//
// It had no browser coverage because it had no fixture. The seed created
// no client-side user at all, so there was nobody to sign in as and no
// schedule to edit; both now exist, and this runs under its own stored
// session (the third setup in auth.setup.ts). Driving it from a staff
// session would assert a refusal and call that coverage - the domain
// checks the client-side role, not the staff one.
//
// Prose warning, same as the other flow files: coverage is inferred from
// the TEXT of these files, and a Server Action inherits the module paths
// it imports. Refer to modules in words, never as paths.
//
// @covers action:(product)/app/(authenticated)/portal/actions

// Serial: these tests edit one seeded schedule rather than creating one
// each, because a Client Admin cannot create a schedule - that is a
// staff capability. Same reasoning as the connections file.
test.describe.configure({ mode: "serial", timeout: 90_000 });

const HISTORY = "/app/portal/history";

// The button's actual label. The first version guessed at
// /שמירה|עדכון|שמור/, which matches none of it - "שמירת" is not
// "שמירה" - so every click waited out the ninety-second test timeout on
// a locator that resolved to nothing.
const SAVE = "שמירת נמענים";

async function recipientsField(page: import("@playwright/test").Page) {
  await page.goto(HISTORY, { waitUntil: "domcontentloaded" });
  const field = page.locator('[name="recipients"]').first();
  return { field, present: (await field.count()) > 0 };
}

test.describe("the portal itself", () => {
  test("a client admin reaches their own portal and not the staff app", async ({ page }) => {
    const response = await page.goto(HISTORY, { waitUntil: "domcontentloaded" });

    expect(response?.status()).toBe(200);
    expect(page.url(), "bounced to login - the client session was not accepted").not.toContain("/app/login");

    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/Application error|Internal Server Error/);
  });

  test("the staff screens stay shut to a client user", async ({ page }) => {
    // The other half of spec 21.2, from the side that matters most: a
    // client-side account reaching a staff screen would see other
    // clients' names. A 200 here is the failure.
    for (const route of ["/app/users", "/app/clients", "/app/reports", "/app/audit-log"]) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      const body = await page.locator("body").innerText();

      const shutOut =
        page.url().includes("/app/login") ||
        page.url().includes("/app/portal") ||
        // The exact string the shared 403 component renders. An
        // approximation of it passed review and failed the run: the
        // component says "אין לך הרשאה", and my paraphrase said
        // "אין הרשאה" - which matched nothing and reported a correctly
        // gated screen as a leak.
        /אין לך הרשאה|Forbidden|404|לא נמצא/.test(body);

      expect(shutOut, `${route} rendered for a client user`).toBe(true);
      expect(body, `${route} leaked another client's name`).not.toContain("[DEMO] קבוצת מרידיאן");
    }
  });
});

test.describe("managing recipients", () => {
  test("an added recipient survives a reload", async ({ page }) => {
    const { field, present } = await recipientsField(page);
    test.skip(!present, "no scheduled report on this client to manage recipients for");

    const before = await field.inputValue();
    const added = "ops+e2e@ankora.co.il";

    await field.fill(before.includes(added) ? before : `${before}, ${added}`);
    await page.getByRole("button", { name: SAVE }).first().click();
    await page.waitForLoadState("networkidle");
    await page.reload();

    const after = await page.locator('[name="recipients"]').first().inputValue();
    expect(after, "the recipient was not saved").toContain(added);

    // Put it back, so a rerun starts where this one did. The database is
    // rebuilt per CI run, but a local run is not.
    await page.locator('[name="recipients"]').first().fill(before);
    await page.getByRole("button", { name: SAVE }).first().click();
    await page.waitForLoadState("networkidle");
  });

  test("refuses to empty the list, rather than silently sending to nobody", async ({ page }) => {
    const { field, present } = await recipientsField(page);
    test.skip(!present, "no scheduled report on this client to manage recipients for");

    const before = await field.inputValue();
    await field.fill("   ");
    await page.getByRole("button", { name: SAVE }).first().click();
    await page.waitForLoadState("networkidle");
    await page.reload();

    // A schedule with no recipients is still enabled and still runs; it
    // just quietly reaches nobody, which looks identical to "the report
    // stopped being generated" from the client's side.
    const after = await page.locator('[name="recipients"]').first().inputValue();
    expect(after.trim().length, "the recipient list was emptied").toBeGreaterThan(0);
    expect(after).toBe(before);
  });
});
