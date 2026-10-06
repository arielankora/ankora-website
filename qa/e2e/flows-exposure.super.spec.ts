import { test, expect } from "./fixtures";

// DPA section 4 (7.10.2026): the report of client logins a person viewed
// in the last 90 days, produced from that person's page under "משתמשים".
// Super-admin only, so it lives in a .super spec.
//
// @covers action:(product)/app/(authenticated)/users/actions

test("a user's page produces the report of client logins they viewed", async ({ page }) => {
  await page.goto("/app/users");
  // The row of the seeded employee: the email sits in the row, the link
  // ("עריכה") at its end.
  const row = page.locator("div", { hasText: "demo.employee1@ankora.co.il" }).filter({ has: page.locator('a[href^="/app/users/"]') }).last();
  await row.locator('a[href^="/app/users/"]').click();
  await expect(page.getByText("demo.employee1@ankora.co.il")).toBeVisible();

  await page.getByRole("button", { name: "הפקת דוח גישות שנצפו" }).click();
  const report = page.locator("[data-exposure-report]");
  await expect(report).toBeVisible({ timeout: 30_000 });
  await expect(report.getByText("הפקת הדוח נרשמה ביומן הפעולות.")).toBeVisible();
});
