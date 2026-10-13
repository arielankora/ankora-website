import { test, expect } from "./fixtures";

// Org brain, phase 2 (14.10.2026): request types and the file's free text
// on the client screen, submitted for real. Same prose rule as
// flows-admin: modules are named in words here, never by path.
//
// @covers action:(product)/app/(authenticated)/clients/file-text-actions

test.describe.configure({ timeout: 90_000 });

const CLIENT = "demo-client-b";

function tag(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

test.describe("clients/file-text-actions", () => {
  test("a request type is added with how it is answered, and removed", async ({ page }) => {
    const title = tag("[E2E] סוג פנייה");
    await page.goto(`/app/clients/${CLIENT}`);
    await page.getByRole("button", { name: "+ סוג פנייה", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('input[name="title"]').fill(title);
    await dialog.locator('input[name="arrivesVia"]').fill("billing-us");
    await dialog.locator('textarea[name="handling"]').fill("לשני ולג'נן, לא לאיילה");
    // A request type cites a source like any item; "missing" needs none.
    await dialog.locator('select[name="knowledgeStatus"]').selectOption("MISSING");
    await dialog.locator('input[name="toResolve"]').fill("לברר עם המנכ״ל");
    let written = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await dialog.getByRole("button", { name: "הוספה לתיק" }).click();
    await written;

    await page.reload();
    const row = page.locator("li", { hasText: title }).first();
    await expect(row, "the request type was not added").toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText("לשני ולג'נן, לא לאיילה");
    await expect(row).toContainText("billing-us");

    written = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await row.getByRole("button", { name: "הסרה" }).click();
    await written;
    await page.reload();
    await expect(page.locator("li", { hasText: title })).toHaveCount(0, { timeout: 15_000 });
  });

  test("the overview saved as a new version shows, and the earlier one stays in the history", async ({ page }) => {
    const first = tag("[E2E] סקירה");
    const second = tag("[E2E] סקירה מעודכנת");
    await page.goto(`/app/clients/${CLIENT}`);

    const overview = page.locator("section", { has: page.getByRole("heading", { name: /סקירת הלקוח/ }) });
    for (const body of [first, second]) {
      await overview.getByRole("button", { name: /^(כתיבה|עריכה)$/ }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await dialog.locator('textarea[name="body"]').fill(body);
      const written = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
      await dialog.getByRole("button", { name: "שמירת גרסה חדשה" }).click();
      await written;
      await page.reload();
    }

    await expect(overview).toContainText(second, { timeout: 15_000 });
    await overview.getByText(/גרסאות קודמות/).click();
    await expect(overview).toContainText(first);
  });
});
