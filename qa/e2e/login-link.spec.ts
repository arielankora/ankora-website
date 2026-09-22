import { test, expect } from "@playwright/test";

// Portal phase 0: the sign-in link, from the browser.
//
// This is the flow the whole phase rests on - a client who cannot get in
// never sees anything else we build - and it is unauthenticated, so the
// same rule as /app/login applies: what it declines to say matters as
// much as what it renders. The request form must answer identically for
// an address that exists and one that does not (spec 20), and a token
// that is absent or wrong must fail closed rather than render a portal.
//
// These specs submit the forms rather than only rendering them, so they
// are declared coverage for the Server Actions behind them. See
// qa/lib/discover.mjs for why declaring is allowed here.
//
// @covers action:(product)/app/login-link/actions

const UNKNOWN = "nobody-here-2026@example.com";

async function requestLink(page: import("@playwright/test").Page, email: string) {
  await page.goto("/app/login-link/request");
  await page.fill('input[name="identifier"]', email);
  await page.click('button[type="submit"]');
  await page.waitForLoadState("networkidle");
  return (await page.locator("body").innerText()).replace(/\s+/g, " ");
}

test.describe("/app/login-link/request", () => {
  test("is reachable without a session and offers one field", async ({ page }) => {
    const res = await page.goto("/app/login-link/request");
    expect(res?.status()).toBe(200);
    await expect(page.locator('input[name="identifier"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test("answers the same way for an address that does not exist", async ({ page }) => {
    const body = await requestLink(page, UNKNOWN);
    expect(body).toContain("אם קיים חשבון פורטל");
    // The negative half of spec 20: nothing on the page may hint that the
    // address is unknown, and nothing may hint that it is known either.
    expect(body).not.toMatch(/לא נמצא|אינו קיים|not found/i);
  });

  test("offers the password screen as the way back", async ({ page }) => {
    await page.goto("/app/login-link/request");
    await expect(page.locator('a[href="/app/login"]')).toBeVisible();
  });
});

test.describe("/app/login-link", () => {
  test("refuses an empty token without rendering a portal", async ({ page }) => {
    const res = await page.goto("/app/login-link");
    expect(res?.status()).toBe(200);
    const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    expect(body).toContain("הקישור אינו תקין");
    expect(page.url()).toContain("/app/login-link");
  });

  test("refuses a forged token and stays out", async ({ page }) => {
    await page.goto("/app/login-link?token=not-a-real-token-2026");
    // The page auto-submits the consume action, so the failure arrives
    // after a round trip rather than on first paint.
    await page.waitForLoadState("networkidle");
    const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    expect(body).toContain("הקישור אינו תקין");
    expect(page.url()).not.toContain("/app/portal");
  });
});

test.describe("/app/login", () => {
  test("offers the link flow beside the password form", async ({ page }) => {
    await page.goto("/app/login");
    await expect(page.locator('a[href="/app/login-link/request"]')).toBeVisible();
  });
});
