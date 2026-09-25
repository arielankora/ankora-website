import { test, expect } from "@playwright/test";
import { isRealConsoleError } from "./routes";

// The detail screens the blind sweep cannot reach.
//
// screens.app.spec.ts walks every product screen whose route has no
// dynamic segment. Four screens are excluded by that rule, because
// /app/clients/[clientId] needs a real id - and being excluded from the
// sweep is not the same as being covered, which is why the scan has had
// them open at high risk since the sweep landed.
//
// These do not hardcode an id. They start from the list, follow the
// first row's own link, and assert the page it lands on. That is both
// closer to what a user does and immune to whichever fixtures happen to
// exist: an id typed into a spec is a fixture dependency in disguise,
// and it goes stale the first time the seed changes.
//
// Two of the four - users and important dates - are Super-Admin-only by
// the role matrix, so they live in the .super.spec.ts file next door
// rather than asserting a ForbiddenError here and calling that coverage.
//
// @covers screen:/app/clients/[clientId]
// @covers screen:/app/categories/[categoryId]
//
// Declared, for the same reason the customer-stories sweep declares:
// these tests really do open those screens, but they reach them by
// following a link the page hands them, so the literal bracketed path
// the scanner searches for appears nowhere - and cannot, without
// hardcoding an id, which is the fixture dependency this file was
// written to avoid.

test.describe.configure({ timeout: 60_000 });

/**
 * Follow the first link into a detail route, and assert what lands.
 *
 * The assertions are deliberately about structure rather than content:
 * these screens exist to display one record, and what makes them break
 * is a server component throwing on a field, not a label changing. A
 * spec that pinned copy here would go red on every wording tweak and
 * teach everyone to re-record it without reading.
 */
async function openFirstDetail(
  page: import("@playwright/test").Page,
  listRoute: string,
  detailPrefix: string,
) {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && isRealConsoleError(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(listRoute, { waitUntil: "domcontentloaded" });

  const link = page.locator(`a[href^="${detailPrefix}"]`).first();
  if ((await link.count()) === 0) return { skipped: true as const, errors };

  const href = await link.getAttribute("href");
  const response = await page.goto(href!, { waitUntil: "domcontentloaded" });

  return { skipped: false as const, errors, response, href: href! };
}

async function assertDetailRenders(
  page: import("@playwright/test").Page,
  result: Awaited<ReturnType<typeof openFirstDetail>>,
) {
  if (result.skipped) return;

  expect(result.response?.status(), `${result.href} HTTP status`).toBe(200);
  // Path, not substring: a route whose name merely starts with
  // "/app/login" (such as the portal sign-in link) is not a bounce.
  expect(new URL(page.url()).pathname, "bounced to login - the stored session was not accepted").not.toBe("/app/login");

  const body = await page.locator("body").innerText();
  expect(body, `${result.href} error boundary`).not.toMatch(/Application error|Internal Server Error/);
  // A detail screen that renders its chrome and nothing else is the
  // failure mode worth catching: the layout survives, the record does
  // not load, and the page looks merely empty rather than broken.
  expect(body.trim().length, `${result.href} rendered no content`).toBeGreaterThan(80);

  expect(result.errors, `${result.href} console`).toEqual([]);
}

test.describe("client detail", () => {
  test("the first client in the list opens its own page", async ({ page }) => {
    const result = await openFirstDetail(page, "/app/clients", "/app/clients/");
    test.skip(result.skipped, "no clients in this database to open");
    await assertDetailRenders(page, result);
  });
});

test.describe("writing to a client from the client's own screen", () => {
  // The composer reached the client screen on 25.9.2026, which is the
  // screen somebody opens when they want to write to a client without a
  // task in mind. The unit tests prove the drafts; this proves the
  // button is actually on the page and opens something a person can
  // read, which is the half that a prop rename breaks silently.
  //
  // Nothing is sent and nothing is recorded here: the drawer is opened
  // and closed. The record path is asserted once, in the task screen
  // spec, because it is the same action.
  test("the button opens a draft somebody can read", async ({ page }) => {
    const result = await openFirstDetail(page, "/app/clients", "/app/clients/");
    test.skip(result.skipped, "no clients in this database to open");

    await page.getByRole("button", { name: "הודעה ללקוח" }).click();
    await page.getByRole("button", { name: "סיימנו" }).click();

    const composer = page.getByLabel("נוסח ההודעה");
    await expect(composer).toBeVisible({ timeout: 30_000 });
    // Written, and about this client rather than about nothing.
    expect((await composer.inputValue()).length).toBeGreaterThan(40);
  });
});

test.describe("category detail", () => {
  test("the first category in the list opens its own page", async ({ page }) => {
    const result = await openFirstDetail(page, "/app/categories", "/app/categories/");
    test.skip(result.skipped, "no categories in this database to open");
    await assertDetailRenders(page, result);
  });
});

test.describe("a detail page is not a way around client scoping", () => {
  // The detail screens take an id straight from the URL, which is the
  // one place in the product where a user can name a record the
  // navigation never offered them. An id that does not belong to this
  // caller must not render - and must not 500 either, because a stack
  // trace is its own kind of answer.
  for (const route of [
    "/app/clients/clxxxxxxxxxxxxxxxxxxxxxxxx",
    "/app/categories/clxxxxxxxxxxxxxxxxxxxxxxxx",
  ]) {
    test(`${route} refuses a fabricated id cleanly`, async ({ page }) => {
      const response = await page.goto(route, { waitUntil: "domcontentloaded" });
      const status = response?.status() ?? 0;

      expect(status, `${route} returned a server error for a bad id`).toBeLessThan(500);

      // A retrying assertion, not a one-shot innerText read.
      //
      // `domcontentloaded` can return before the not-found body is
      // painted, and reading innerText at that instant gets an empty
      // string - so the test failed on the first attempt and passed on
      // the retry, three runs in a row. A test that only passes the
      // second time is worse than one that fails: it teaches everyone to
      // press the button again.
      await expect(page.locator("body")).not.toContainText(/Application error|Internal Server Error/, {
        timeout: 10_000,
      });

      if (status !== 404) {
        // Whatever it shows - a not-found, a redirect, an empty state -
        // it must not be a populated record.
        await expect(
          page.locator("body"),
          `${route} rendered something for an id that does not exist`,
        ).toContainText(/לא נמצא|404|אין לך הרשאה|Not Found/, { timeout: 10_000 });
      }
    });
  }
});
