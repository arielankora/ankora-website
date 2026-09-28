import { test, expect } from "./fixtures";

// Ariel's list of 26.9.2026, the Super-Admin screens: the audit search
// and the integrations screen without ClickUp.
//
// Prose warning, same as the other flow files here: coverage is inferred
// from the TEXT of these files, so modules are referred to in words.

test.describe.configure({ timeout: 90_000 });

test("the audit search finds actions by their Hebrew name", async ({ page }) => {
  // Anything the seed and the suite have done is in the log; a sign-in
  // always is, because every session in this suite starts with one.
  await page.goto(`/app/audit-log?q=${encodeURIComponent("התחברות")}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("cell", { name: /התחברות/ }).first()).toBeVisible({ timeout: 30_000 });

  // The English key still works for anyone who knows it.
  await page.goto("/app/audit-log?q=login", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("cell", { name: /התחברות/ }).first()).toBeVisible({ timeout: 30_000 });
});

test("the integrations screen no longer offers ClickUp", async ({ page }) => {
  await page.goto("/app/integrations", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "אינטגרציות" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("ClickUp")).toHaveCount(0);
  await expect(page.getByText("בפיתוח", { exact: true })).toHaveCount(0);
});
