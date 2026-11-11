import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

// The UI round of 19.10.2026 as a client sees the portal: six rows and no
// second tab bar (20.10), hours, the week by days and the monthly report on
// one screen, the month surviving its links, and
// contrast on the screens a client reads.
//
// Prose warning: coverage is inferred from the text of this file, so
// modules are named in words, never as paths.

test.describe.configure({ timeout: 90_000 });

const SIDEBAR = 'aside nav[aria-label="ניווט ראשי"]';

test("the portal menu is six rows and the only navigation", async ({ page }) => {
  await page.goto("/app/portal", { waitUntil: "domcontentloaded" });
  const links = page.locator(SIDEBAR).getByRole("link");
  await expect(links).toHaveText(["בית", "החלטות", "פעילות", "שעות ודוחות", "היסטוריה", "התיק שלי"]);
  // The portal's own tab bar is gone: "פעילות" is a link once, in the menu.
  await expect(page.locator("main").getByRole("link", { name: "פעילות", exact: true })).toHaveCount(0);
});

test("the monthly report is a section of the hours tab, and the month stays", async ({ page }) => {
  // 11.11.2026 (Hadas's portal review): the "דוח חודשי" tab gave its place to
  // "משימות"; the month's export and summary sit at the bottom of "שעות".
  await page.goto("/app/portal/hours", { waitUntil: "domcontentloaded" });
  const tabs = page.getByRole("navigation", { name: "שעות ודוחות" });
  await expect(tabs.getByRole("link", { name: "שעות" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator("#monthly-report")).toBeVisible();

  // The address in the monthly email still lands on the same month.
  await page.goto("/app/portal/monthly?monthOffset=-1", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/app\/portal\/hours\?monthOffset=-1#monthly-report$/);
  // And the address without a month, and with something it should not carry.
  await page.goto("/app/portal/monthly?next=https://evil.test", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/app\/portal\/hours#monthly-report$/);
  // The old tab's own address too.
  await page.goto("/app/portal/hours?view=monthly&monthOffset=-2", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/app\/portal\/hours\?monthOffset=-2#monthly-report$/);
});

test("the week by days is the second tab, its old address keeps the week, and a day narrows it", async ({ page }) => {
  await page.goto("/app/portal/hours", { waitUntil: "domcontentloaded" });
  const tabs = page.getByRole("navigation", { name: "שעות ודוחות" });
  await expect(tabs.getByRole("link")).toHaveText(["שעות", "לפי ימים", "משימות"]);
  // One row lit in the menu: "בית" (/app/portal) used to match every portal path.
  await expect(page.locator(SIDEBAR).locator('a[aria-current="page"]')).toHaveText(["שעות ודוחות"]);
  await tabs.getByRole("link", { name: "לפי ימים" }).click();
  await expect(page).toHaveURL(/\/app\/portal\/hours\?view=weekly$/);
  await expect(tabs.getByRole("link", { name: "לפי ימים" })).toHaveAttribute("aria-current", "page");
  // No employee column and no minutes column (Hadas's review).
  await expect(page.getByRole("columnheader", { name: "איש צוות" })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "דקות לחיוב" })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "שעות" })).toHaveCount(1);
  await page.goto("/app/portal/weekly?weekOffset=-2&next=https://evil.test", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/app\/portal\/hours\?view=weekly&weekOffset=-2$/);
  // A day in the address narrows the list to it, and "כל השבוע" brings the week back.
  await page.goto("/app/portal/hours?view=weekly&day=1999-01-01", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("link", { name: "כל השבוע" })).toHaveCount(0);
});

test("the tasks tab counts what closed and what is open", async ({ page }) => {
  await page.goto("/app/portal/hours?view=tasks", { waitUntil: "domcontentloaded" });
  const tabs = page.getByRole("navigation", { name: "שעות ודוחות" });
  await expect(tabs.getByRole("link", { name: "משימות" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("משימות פתוחות")).toBeVisible();
  await expect(page.getByText("פתוחות היום")).toBeVisible();
});

for (const route of ["/app/portal", "/app/portal/hours", "/app/portal/hours?view=tasks", "/app/portal/hours?view=weekly", "/app/portal/decisions"]) {
  test(`text on ${route} meets contrast`, async ({ page }) => {
    await page.goto(route, { waitUntil: "networkidle" });
    const result = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
    const failures = result.violations.flatMap((v) =>
      v.nodes.map((n) => `${n.target.join(" ")}: ${n.failureSummary?.split("\n").slice(-1)[0] ?? ""}`),
    );
    expect(failures, `${route} contrast`).toEqual([]);
  });
}
