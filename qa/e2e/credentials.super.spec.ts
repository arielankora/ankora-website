import { test, expect } from "@playwright/test";
import { APP_SCREENS, CREDENTIAL_PATTERNS } from "./routes";

// The credential sweep again, this time as a Super Admin.
//
// The same sweep runs in screens.app.spec.ts under an employee session,
// and that one is not enough on its own: the screens where this fault
// actually lives are the administrative ones, and for an employee most
// of them render a permission notice with no rows on it. A leak needs
// data to leak, so the session that sees the data has to do the looking.
//
// That is not hypothetical. The three leaks this file was written for
// were all on screens an employee cannot open: the user detail page
// handed a full User row to a client component, and both Important Dates
// screens handed it the entire user list. Every screen looked correct.
// The bcrypt hash of every user in the company was sitting in the page
// source, one "view source" away, cacheable, and crackable offline.
//
// Kept as a sweep rather than three assertions because the mistake is
// structural, not local: any future screen that passes a database row to
// a client component reintroduces it, and TypeScript will not object -
// a variable may carry properties its declared prop type never mentions.
// A per-screen list would cover today's screens; this covers next
// month's, on the day it is added to the manifest.

test.describe("credentials never reach the browser (admin session)", () => {
  for (const route of APP_SCREENS) {
    test(`${route} ships no credential material`, async ({ page }) => {
      const response = await page.goto(route, { waitUntil: "domcontentloaded" });
      test.skip(response?.status() !== 200, "screen did not render for this session");

      const html = await page.content();

      for (const { pattern, what } of CREDENTIAL_PATTERNS) {
        expect(html, `${route} served ${what}`).not.toMatch(pattern);
      }
    });
  }
});

test.describe("the user detail screen", () => {
  // The one screen that opens a single user's row on purpose, checked on
  // its own because it is reached by an id and so is not in the sweep
  // above. Its list page is, which is how the id is found here.
  test("opening a user does not ship that user's password hash", async ({ page }) => {
    await page.goto("/app/users", { waitUntil: "domcontentloaded" });

    const link = page.locator('a[href^="/app/users/"]').first();
    const count = await link.count();
    test.skip(count === 0, "no user row links on the list screen to follow");

    // Read the href and navigate, rather than clicking it.
    //
    // The first version clicked, and the URL stayed on the list: the row
    // link is a small text link inside a card, and a click that lands
    // before hydration does nothing at all - which then read as "the
    // detail screen is broken" rather than "the click missed". The id
    // still comes from the page's own markup, which is the part that
    // matters; only the means of getting there is more direct.
    const href = await link.getAttribute("href");
    expect(href, "the user row link has no href").toBeTruthy();

    await page.goto(href!, { waitUntil: "domcontentloaded" });
    expect(page.url(), "did not land on a user detail screen").toContain("/app/users/");

    const html = await page.content();
    for (const { pattern, what } of CREDENTIAL_PATTERNS) {
      expect(html, `the user detail screen served ${what}`).not.toMatch(pattern);
    }
  });
});
