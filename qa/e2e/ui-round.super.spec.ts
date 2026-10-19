import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

// The UI round of 19.10.2026 as a super admin sees it: all four groups,
// the merged reports screen, the way back from a client, the filters that
// navigate as documents, and contrast on the management screens.
//
// Prose warning: coverage is inferred from the text of this file, so
// modules are named in words, never as paths.

test.describe.configure({ timeout: 90_000 });

const SIDEBAR = 'aside nav[aria-label="ניווט ראשי"]';

test("four groups, and the alert rules are called what they are", async ({ page }) => {
  await page.goto("/app", { waitUntil: "domcontentloaded" });
  const nav = page.locator(SIDEBAR);
  for (const group of ["עבודה", "לקוחות", "בקרה", "הגדרות"]) {
    await expect(nav.getByText(group, { exact: true })).toBeVisible();
  }
  await expect(nav.getByRole("link", { name: "כללי התראה", exact: true })).toBeVisible();
  for (const gone of ["התראות", "דוחות מתוזמנים", "הזמן שלי"]) {
    await expect(nav.getByRole("link", { name: gone, exact: true })).toHaveCount(0);
  }
});

test("scheduled reports are a tab of the reports, and the client picker stays on it", async ({ page }) => {
  await page.goto("/app/reports", { waitUntil: "domcontentloaded" });
  await page.getByRole("navigation", { name: "דוחות" }).getByRole("link", { name: "מתוזמנים" }).click();
  await expect(page).toHaveURL(/\/app\/reports\?tab=schedules$/);
  await expect(page.getByRole("heading", { name: "דוחות מתוזמנים" })).toBeVisible();
  await page.locator("select").first().selectOption("demo-client-a");
  await expect(page).toHaveURL(/\/app\/reports\?tab=schedules&clientId=demo-client-a$/);
});

test("a client opened from a search returns to the same search", async ({ page }) => {
  await page.goto("/app/clients", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("חיפוש לקוח").fill("אורביט");
  await expect(page).toHaveURL(/\/app\/clients\?q=/);
  await page.getByRole("link", { name: /חברת אורביט/ }).first().click();
  const back = page.getByRole("link", { name: 'חזרה: לקוחות · "אורביט"' }).first();
  await expect(back).toBeVisible({ timeout: 30_000 });
  await back.click();
  await expect(page).toHaveURL(/\/app\/clients\?q=/);
  await expect(page.getByPlaceholder("חיפוש לקוח")).toHaveValue("אורביט");
});

test("the time-entries filter applies as a page load", async ({ page }) => {
  await page.goto("/app/time-entries", { waitUntil: "domcontentloaded" });
  await page.locator("select").first().selectOption("demo-client-a");
  await Promise.all([
    page.waitForEvent("load"),
    page.getByRole("button", { name: "סינון" }).click(),
  ]);
  await expect(page).toHaveURL(/\/app\/time-entries\?clientId=demo-client-a/);
  await expect(page.locator("select").first()).toHaveValue("demo-client-a");
});

for (const route of ["/app/clients", "/app/reports", "/app/reports?tab=schedules", "/app/time-entries", "/app/users"]) {
  test(`text on ${route} meets contrast`, async ({ page }) => {
    await page.goto(route, { waitUntil: "networkidle" });
    const result = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
    const failures = result.violations.flatMap((v) =>
      v.nodes.map((n) => `${n.target.join(" ")}: ${n.failureSummary?.split("\n").slice(-1)[0] ?? ""}`),
    );
    expect(failures, `${route} contrast`).toEqual([]);
  });
}
