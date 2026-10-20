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

test("hours and the monthly report are one screen, and the month stays", async ({ page }) => {
  await page.goto("/app/portal/hours", { waitUntil: "domcontentloaded" });
  const tabs = page.getByRole("navigation", { name: "שעות ודוחות" });
  await expect(tabs.getByRole("link", { name: "שעות" })).toHaveAttribute("aria-current", "page");
  await tabs.getByRole("link", { name: "דוח חודשי" }).click();
  await expect(page).toHaveURL(/\/app\/portal\/hours\?view=monthly$/);
  await expect(tabs.getByRole("link", { name: "דוח חודשי" })).toHaveAttribute("aria-current", "page");
  // The portal's own tab bar no longer carries a separate monthly tab.
  await expect(page.getByRole("link", { name: "דוח חודשי", exact: true })).toHaveCount(1);

  // The address in the monthly email still lands on the same month.
  await page.goto("/app/portal/monthly?monthOffset=-1", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/app\/portal\/hours\?view=monthly&monthOffset=-1$/);
  // And the address without a month, and with something it should not carry.
  await page.goto("/app/portal/monthly?next=https://evil.test", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/app\/portal\/hours\?view=monthly$/);
});

test("the week by days is the third tab, and its old address keeps the week", async ({ page }) => {
  await page.goto("/app/portal/hours", { waitUntil: "domcontentloaded" });
  const tabs = page.getByRole("navigation", { name: "שעות ודוחות" });
  await expect(tabs.getByRole("link")).toHaveText(["שעות", "לפי ימים", "דוח חודשי"]);
  await tabs.getByRole("link", { name: "לפי ימים" }).click();
  await expect(page).toHaveURL(/\/app\/portal\/hours\?view=weekly$/);
  await expect(tabs.getByRole("link", { name: "לפי ימים" })).toHaveAttribute("aria-current", "page");
  await page.goto("/app/portal/weekly?weekOffset=-2&next=https://evil.test", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/app\/portal\/hours\?view=weekly&weekOffset=-2$/);
});

for (const route of ["/app/portal", "/app/portal/hours", "/app/portal/hours?view=monthly", "/app/portal/hours?view=weekly", "/app/portal/decisions"]) {
  test(`text on ${route} meets contrast`, async ({ page }) => {
    await page.goto(route, { waitUntil: "networkidle" });
    const result = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
    const failures = result.violations.flatMap((v) =>
      v.nodes.map((n) => `${n.target.join(" ")}: ${n.failureSummary?.split("\n").slice(-1)[0] ?? ""}`),
    );
    expect(failures, `${route} contrast`).toEqual([]);
  });
}
