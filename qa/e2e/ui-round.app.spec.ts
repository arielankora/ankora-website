import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

// The UI round of 19.10.2026 (canvas "Ankora App UI Round", task
// cmvddvqqv000plc08l6qzt2ho), as an operations employee sees it: the menu,
// the account menu, the merged timer screen, the way back from a task, and
// the palette's contrast on the screens this role opens every day.
//
// Prose warning, as in the other flow files: coverage is inferred from the
// text of this file, so modules are named in words, never as paths.

test.describe.configure({ timeout: 90_000 });

const SIDEBAR = 'aside nav[aria-label="ניווט ראשי"]';

test("the menu has the new groups, and the account lives under the name", async ({ page }) => {
  await page.goto("/app", { waitUntil: "domcontentloaded" });
  const nav = page.locator(SIDEBAR);
  await expect(nav.locator("p", { hasText: /^עבודה$/ })).toBeVisible();
  for (const label of ["בית", "טיימר", "משימות", "יומן"]) {
    await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  // Gone from the list: a tab of the timer now, and the account items.
  for (const label of ["הזמן שלי", "התראות שלי", "הפרופיל שלי", "מדריך שימוש"]) {
    await expect(nav.getByRole("link", { name: label, exact: true })).toHaveCount(0);
  }
  // The old group names are gone with them.
  for (const group of ["העבודה שלי", "ניהול", "דיווח ובקרה", "חשבון"]) {
    await expect(nav.locator("p", { hasText: new RegExp(`^${group}$`) })).toHaveCount(0);
  }

  const account = page.locator("aside details");
  await account.locator("summary").click();
  for (const label of ["התראות שלי", "הפרופיל שלי", "מדריך שימוש"]) {
    await expect(account.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  await expect(account.getByRole("button")).toBeVisible();
});

test("the timer and the week are one screen, and the week stays on its tab", async ({ page }) => {
  await page.goto("/app/timer", { waitUntil: "domcontentloaded" });
  const tabs = page.getByRole("navigation", { name: "טיימר והזמן שלי" });
  await expect(tabs.getByRole("link", { name: "טיימר" })).toHaveAttribute("aria-current", "page");
  await tabs.getByRole("link", { name: "הזמן שלי" }).click();
  await expect(page).toHaveURL(/\/app\/timer\?tab=mine$/);
  await expect(page.getByRole("heading", { name: "הזמן שלי" })).toBeVisible();
  await expect(page.getByRole("link", { name: "שבוע קודם" })).toHaveAttribute("href", /^\/app\/timer\?tab=mine&week=\d{4}-\d{2}-\d{2}$/);
});

test("a task opened from a narrowed list says which list it returns to", async ({ page }) => {
  const list = "/app/tasks?mine=0&q=%D7%95%D7%A2%D7%93";
  await page.goto(list, { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: /תיאום מול ועד הבית/ }).first().click();
  const back = page.getByTestId("task-back");
  // In the top bar, naming the list: everyone's tasks, the search in quotes.
  await expect(back).toHaveText('משימות · כולם · "ועד"', { timeout: 30_000 });
  await expect(back).toHaveAttribute("aria-label", 'חזרה: משימות · כולם · "ועד"');
  await back.click();
  await expect(page).toHaveURL(/\/app\/tasks\?(?=.*mine=0)(?=.*q=)/);
});

test("an id the person cannot reach never puts a name on the way back", async ({ page }) => {
  const from = encodeURIComponent("mine=0&clientId=no-such-client&categoryId=no-such-category");
  await page.goto(`/app/tasks/demo-task-screen-fixture?from=${from}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("task-back")).toHaveText("משימות · כולם", { timeout: 30_000 });
});

// The palette's promise is 4.5:1 for every text level. A table of hex values
// cannot keep it; only the rendered screen can, with real fonts, real
// backgrounds and whatever a component layered on top.
for (const route of ["/app", "/app/timer", "/app/timer?tab=mine", "/app/tasks?mine=0", "/app/calendar"]) {
  test(`text on ${route} meets contrast`, async ({ page }) => {
    await page.goto(route, { waitUntil: "networkidle" });
    const result = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
    const failures = result.violations.flatMap((v) =>
      v.nodes.map((n) => `${n.target.join(" ")}: ${n.failureSummary?.split("\n").slice(-1)[0] ?? ""}`),
    );
    expect(failures, `${route} contrast`).toEqual([]);
  });
}
