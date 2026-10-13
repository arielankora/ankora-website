import { test, expect } from "./fixtures";

// Org brain, decision 3 (14.10.2026): a version of the extraction
// guidance proposed and decided for real. The suite's user is an admin,
// so it can reject what it proposed; it rejects rather than approves, so
// the Preview's guidance in use is never changed by a test. Same prose
// rule as flows-admin: modules are named in words here, never by path.
//
// @covers action:(product)/app/(authenticated)/extraction-guide/actions
// @covers screen:/app/extraction-guide

test.describe("extraction-guide/actions", () => {
  test("a proposed version waits for approval, and a rejection records why", async ({ page }) => {
    const note = `[E2E] ${Date.now().toString(36)}`;
    await page.goto("/app/extraction-guide");
    await expect(page.getByRole("heading", { level: 1, name: "הנחיות החילוץ" })).toBeVisible();

    await page.getByRole("button", { name: "הצעת גרסה חדשה" }).click();
    let dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('input[name="note"]').fill(note);
    let written = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await dialog.getByRole("button", { name: "שליחה לאישור" }).click();
    await written;

    await page.reload();
    const row = page.locator("li", { hasText: note }).first();
    await expect(row).toContainText("ממתינה לאישור", { timeout: 15_000 });

    await row.getByRole("button", { name: "דחייה" }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('input[name="reason"]').fill("[E2E] בדיקה");
    written = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await dialog.getByRole("button", { name: "דחייה" }).click();
    await written;

    await page.reload();
    await expect(page.locator("li", { hasText: note }).first()).toContainText("נדחתה", { timeout: 15_000 });
  });
});
