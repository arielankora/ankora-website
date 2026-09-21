import { test, expect } from "@playwright/test";
import { isRealConsoleError } from "./routes";

// The two remaining detail screens, under the Super-Admin session.
//
// Same reasoning as the .app.spec.ts file next door: screens.app.spec.ts
// sweeps every product screen whose route has no dynamic segment, and
// four are excluded because they need a real id. Users and important
// dates are Super-Admin-only by the role matrix, so they belong here
// rather than asserting a refusal from the admin session and calling
// that coverage.
//
// Prose warning, same as the other flow files: coverage is inferred from
// the TEXT of these files, and a Server Action inherits the module paths
// it imports. Refer to modules in words, never as paths.
//
// @covers screen:/app/users/[userId]
// @covers screen:/app/important-dates/[id]
//
// Declared for the same reason as the file next door: these open the
// screens by following the link the list renders, so the bracketed path
// never appears as text and cannot without hardcoding an id.

test.describe.configure({ timeout: 60_000 });

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
  expect(page.url(), "bounced to login - the stored session was not accepted").not.toContain("/app/login");

  const body = await page.locator("body").innerText();
  expect(body, `${result.href} error boundary`).not.toMatch(/Application error|Internal Server Error/);
  expect(body.trim().length, `${result.href} rendered no content`).toBeGreaterThan(80);
  expect(result.errors, `${result.href} console`).toEqual([]);
}

test.describe("user detail", () => {
  test("the first user in the list opens their own page", async ({ page }) => {
    const result = await openFirstDetail(page, "/app/users", "/app/users/");
    test.skip(result.skipped, "no users listed to open");
    await assertDetailRenders(page, result);
  });

  test("a user's page never prints a password hash", async ({ page }) => {
    // This screen renders a whole User row. The hash is on that row, and
    // the distance between "render the record" and "render the record's
    // every field" is one careless spread. Nobody would notice in a
    // browser; a scraper would.
    const result = await openFirstDetail(page, "/app/users", "/app/users/");
    test.skip(result.skipped, "no users listed to open");

    const html = await page.content();
    expect(html, "a bcrypt hash reached the page").not.toMatch(/\$2[aby]\$\d\d\$/);
    expect(html).not.toContain("passwordHash");
  });
});

test.describe("important date detail", () => {
  test("the first important date in the list opens its own page", async ({ page }) => {
    const result = await openFirstDetail(page, "/app/important-dates", "/app/important-dates/");
    // The demo seed creates no important dates, so on a fresh database
    // this legitimately has nothing to open. Skipping with the reason
    // stated is honest; inventing a row here would make this a creation
    // test wearing a rendering test's name, and the creation path is
    // already covered in the flows file.
    test.skip(result.skipped, "no important dates in this database to open");
    await assertDetailRenders(page, result);
  });
});

test.describe("a detail page is not a way around scoping", () => {
  for (const route of [
    "/app/users/clxxxxxxxxxxxxxxxxxxxxxxxx",
    "/app/important-dates/clxxxxxxxxxxxxxxxxxxxxxxxx",
  ]) {
    test(`${route} refuses a fabricated id cleanly`, async ({ page }) => {
      const response = await page.goto(route, { waitUntil: "domcontentloaded" });
      const status = response?.status() ?? 0;

      expect(status, `${route} returned a server error for a bad id`).toBeLessThan(500);
      const body = await page.locator("body").innerText();
      expect(body).not.toMatch(/Application error|Internal Server Error/);

      // Refused, not merely empty.
      //
      // The first version asserted the body contained no "[DEMO]" - the
      // seed's own prefix - reasoning that a leaked record would show a
      // seeded name. It fails on a correctly refused page, because the
      // app shell's command palette lists every client on every screen,
      // 404s included. The shell is not the record.
      //
      // What actually matters is that a fabricated id produces a refusal
      // rather than somebody else's row, so that is what this asserts.
      const refused = status === 404 || /לא נמצא|404|אין לך הרשאה|Not Found/.test(body);
      expect(refused, `${route} rendered something for an id that does not exist`).toBe(true);
    });
  }
});
