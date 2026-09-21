import { test as setup, expect } from "@playwright/test";
import path from "node:path";

// Signs in once and saves the session for every authenticated spec.
//
// The account is a seeded demo fixture (prisma/seed.ts), living in a
// throwaway database that the CI job creates and destroys around each
// run. Nothing here touches a real account or a real client - the
// fixtures are all prefixed "[DEMO]" precisely so that, if one ever
// surfaced somewhere it should not, it would be unmistakable.

const STATE = path.join("qa", "reports", ".auth", "employee.json");

export const DEMO = {
  admin: { identifier: "demo.admin@ankora.co.il", password: "DemoPass!2026" },
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
