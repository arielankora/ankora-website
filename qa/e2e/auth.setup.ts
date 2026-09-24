import { test as setup, expect } from "@playwright/test";
import path from "node:path";

// Signs in once and saves the session for every authenticated spec.
//
// The account is a seeded demo fixture (prisma/seed.ts), living in a
// throwaway database that the CI job creates and destroys around each
// run. Nothing here touches a real account or a real client - the
// fixtures are all prefixed "[DEMO]" precisely so that, if one ever
// surfaced somewhere it should not, it would be unmistakable.

// Named `employee.json` and signed in as the Ankora Admin below. The
// name is the older one and the account is the one every `.app.spec.ts`
// actually runs as, which has misled at least one spec into seeding a
// fixture for `demo.employee1` and then asserting an empty screen. Left
// as it is rather than renamed, because the path is written into
// qa/playwright.config.ts and into the CI job's cache, and a rename that
// misses one of them fails every authenticated spec at once. The comment
// is the cheap half of the fix; anything that seeds a per-user fixture
// should read `DEMO.admin` below and not this constant's name.
const STATE = path.join("qa", "reports", ".auth", "employee.json");
const SUPER_STATE = path.join("qa", "reports", ".auth", "superadmin.json");
const CLIENT_STATE = path.join("qa", "reports", ".auth", "clientadmin.json");

export const DEMO = {
  superAdmin: { identifier: "demo.superadmin@ankora.co.il", password: "DemoPass!2026" },
  admin: { identifier: "demo.admin@ankora.co.il", password: "DemoPass!2026" },
  clientAdmin: { identifier: "demo.clientadmin@ankora.co.il", password: "DemoPass!2026" },
  employee: { identifier: "demo.employee1@ankora.co.il", password: "DemoPass!2026" },
  suspended: { identifier: "demo.suspended@ankora.co.il", password: "DemoPass!2026" },
};

setup("sign in and store the session", async ({ page }) => {
  await page.goto("/app/login");

  await page.fill('input[name="identifier"]', DEMO.admin.identifier);
  await page.fill('input[name="password"]', DEMO.admin.password);
  await page.click('button[type="submit"]');

  // Landing anywhere under /app that is not the login screen is the
  // signal - asserting on a specific dashboard string would make this
  // setup break every time the homepage copy changes, which is the
  // fastest way to make a whole suite look broken for no reason.
  await page.waitForURL((url) => url.pathname.startsWith("/app") && !url.pathname.includes("/login"), {
    timeout: 20_000,
  });
  await expect(page.locator('input[name="password"]')).toHaveCount(0);

  await page.context().storageState({ path: STATE });
});

// A second session, for the four capabilities the role matrix reserves for
// SUPER_ADMIN - users, hour banks, alerts and the important-dates catalog.
// Driving those as the Ankora Admin above would assert a ForbiddenError and
// call it coverage, which is worse than leaving the gap open and saying so.
setup("sign in as super admin and store that session too", async ({ page }) => {
  await page.goto("/app/login");

  await page.fill('input[name="identifier"]', DEMO.superAdmin.identifier);
  await page.fill('input[name="password"]', DEMO.superAdmin.password);
  await page.click('button[type="submit"]');

  await page.waitForURL((url) => url.pathname.startsWith("/app") && !url.pathname.includes("/login"), {
    timeout: 20_000,
  });
  await expect(page.locator('input[name="password"]')).toHaveCount(0);

  await page.context().storageState({ path: SUPER_STATE });
});

// A third session, for the one write capability that belongs to a
// CLIENT_USER rather than to Ankora staff: a Client Admin managing who
// their scheduled reports are emailed to (spec 13). It cannot be driven
// from either session above - both are staff, and the domain checks
// ClientUserRole, not UserRole - so a staff session here would assert a
// refusal and call that coverage.
setup("sign in as the client admin and store that session too", async ({ page }) => {
  await page.goto("/app/login");

  await page.fill('input[name="identifier"]', DEMO.clientAdmin.identifier);
  await page.fill('input[name="password"]', DEMO.clientAdmin.password);
  await page.click('button[type="submit"]');

  await page.waitForURL((url) => url.pathname.startsWith("/app") && !url.pathname.includes("/login"), {
    timeout: 20_000,
  });
  await expect(page.locator('input[name="password"]')).toHaveCount(0);

  await page.context().storageState({ path: CLIENT_STATE });
});
