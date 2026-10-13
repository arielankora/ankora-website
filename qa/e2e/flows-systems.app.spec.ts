import { test, expect } from "./fixtures";

// Org brain, phase 2 (13.10.2026): the system map on the client screen,
// submitted for real. Same prose rule as flows-admin: modules are named in
// words here, never by path.
//
// @covers action:(product)/app/(authenticated)/clients/system-actions

test.describe.configure({ timeout: 90_000 });

const CLIENT = "demo-client-b";

function tag(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

async function addSource(page: import("@playwright/test").Page): Promise<string> {
  const title = tag("[E2E] מקור");
  await page.getByRole("button", { name: "+ מקור", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.locator('input[name="title"]').fill(title);
  const written = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
  await dialog.getByRole("button", { name: "הוספה למרשם" }).click();
  await written;
  await page.reload();
  const row = page.locator("li", { hasText: title });
  await expect(row.first(), "the source was not added").toBeVisible({ timeout: 15_000 });
  return (await row.first().locator("span.font-mono").innerText()).trim();
}

test.describe("clients/system-actions", () => {
  test("a system without access shows as a gap with its blocker, can be edited to granted, and removed", async ({ page }) => {
    const name = tag("[E2E] מערכת");

    await page.goto(`/app/clients/${CLIENT}?tab=file`);
    const code = await addSource(page);
    await page.getByRole("button", { name: "+ מערכת", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('input[name="systemName"]').fill(name);
    await dialog.locator('select[name="accessStatus"]').selectOption("NO_ACCESS");
    await dialog.locator('input[name="blocker"]').fill("MFA לטלפון של המנכ״ל");
    await dialog.locator('input[name="billingCost"]').fill("49");
    await dialog.locator('input[name="cardLast4"]').fill("1234");
    await dialog.locator('input[name="sources"]').fill(code);

    const written = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await dialog.getByRole("button", { name: "הוספה למפה" }).click();
    await written;

    await page.reload();
    const row = page.locator("li", { hasText: name });
    await expect(row.first(), "the system was not added").toBeVisible({ timeout: 15_000 });
    await expect(row.first()).toContainText("אין גישה");
    await expect(row.first()).toContainText("MFA לטלפון של המנכ״ל");
    await expect(row.first()).toContainText("****1234");

    await row.first().getByRole("button", { name: "עריכה" }).click();
    const edit = page.getByRole("dialog");
    await expect(edit).toBeVisible();
    await edit.locator('select[name="accessStatus"]').selectOption("HAS_ACCESS");
    const saved = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await edit.getByRole("button", { name: "שמירה" }).click();
    await saved;
    await page.reload();
    await expect(page.locator("li", { hasText: name }).first()).toContainText("יש גישה", { timeout: 15_000 });

    const removed = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await page.locator("li", { hasText: name }).first().getByRole("button", { name: "הסרה" }).click();
    await removed;
    await page.reload();
    await expect(page.locator("li", { hasText: name })).toHaveCount(0, { timeout: 15_000 });
  });
});
