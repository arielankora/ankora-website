import { test, expect } from "@playwright/test";
import { APP_SCREENS, CREDENTIAL_PATTERNS, isRealConsoleError } from "./routes";

// The product sweep: every screen behind the session, signed in.
//
// A smoke test, and honest about it. It proves each screen renders for a
// real user against a real database without throwing - which is exactly
// the class of breakage a type check and a unit suite cannot see, and
// which is how "the whole app is down" usually starts. It does not prove
// the numbers on the screen are right; that is what the domain tests and
// the flow specs are for.
//
// The screen list comes from qa/manifest.json, so a screen added next
// month is swept next month without editing this file.

test.describe("authenticated screens", () => {
  for (const route of APP_SCREENS) {
    test(`${route} renders for a signed-in user`, async ({ page }) => {
      const errors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error" && isRealConsoleError(msg.text())) errors.push(msg.text());
      });
      page.on("pageerror", (err) => errors.push(String(err)));

      const response = await page.goto(route, { waitUntil: "domcontentloaded" });

      expect(response?.status(), `${route} HTTP status`).toBe(200);
      // Being bounced to the login screen means the stored session was
      // not accepted - a silent failure that would otherwise make every
      // assertion below pass against a login form.
      // Compared as a path, not as a substring: "/app/login-link" contains
      // "/app/login", so the old substring check would report a screen as
      // bounced to login purely because of its name.
      expect(new URL(page.url()).pathname, `${route} did not bounce to login`).not.toBe("/app/login");

      // Next.js renders a thrown server error as a generic error page.
      // Catching it by its text is crude but it is what a user sees.
      const body = await page.locator("body").innerText();
      expect(body, `${route} error boundary`).not.toMatch(/Application error|Internal Server Error|500/);

      expect(errors, `${route} console`).toEqual([]);
    });
  }
});

// Credentials must not appear in what the server sends.
//
// This is a sweep rather than a test of one screen because the fault it
// looks for is invisible: a client component's props are serialised into
// the page HTML, so handing one a database row ships every column on
// that row to the browser - including passwordHash - while the screen
// itself looks completely normal. Three screens were doing exactly that
// when this was written, and nothing on any of them looked wrong.
//
// TypeScript does not catch it. A variable is allowed to carry extra
// properties past a narrower prop type, so the types read as correct.
// The only reliable check is to look at the bytes that left the server.
test.describe("credentials never reach the browser", () => {
  for (const route of APP_SCREENS) {
    test(`${route} ships no credential material`, async ({ page }) => {
      const response = await page.goto(route, { waitUntil: "domcontentloaded" });
      test.skip(response?.status() !== 200, "screen did not render for this session");

      // page.content() is the served document plus the RSC payload
      // embedded in it, which is precisely where a serialised prop lands.
      const html = await page.content();

      for (const { pattern, what } of CREDENTIAL_PATTERNS) {
        expect(html, `${route} served ${what}`).not.toMatch(pattern);
      }
    });
  }
});

test.describe("the session boundary", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const route of ["/app", "/app/timer", "/app/reports", "/app/users", "/app/audit-log"]) {
    test(`${route} is unreachable without a session`, async ({ page }) => {
      await page.goto(route);
      // Either redirected to login, or shown the login form - both are
      // correct. Serving the screen is not.
      const onLogin = page.url().includes("/app/login");
      const hasPasswordField = (await page.locator('input[name="password"]').count()) > 0;
      expect(onLogin || hasPasswordField, `${route} leaked to an anonymous visitor`).toBe(true);
    });
  }

  test("the product asks not to be indexed", async ({ request }) => {
    const res = await request.get("/app/login");
    const html = await res.text();
    const header = res.headers()["x-robots-tag"] ?? "";
    expect(header.includes("noindex") || /noindex/.test(html)).toBe(true);
  });
});
