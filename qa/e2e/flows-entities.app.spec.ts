import { test, expect } from "./fixtures";

// Org brain, phase 2 (14.10.2026): the client's legal entities, submitted
// for real. Same prose rule as flows-admin: modules are named in words
// here, never by path.
//
// @covers action:(product)/app/(authenticated)/clients/entity-actions

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

test.describe("clients/entity-actions", () => {
  test("an entity with a missing registration number says so, until it is filled", async ({ page }) => {
    const name = tag("[E2E] ישות");

    await page.goto(`/app/clients/${CLIENT}`);
    const code = await addSource(page);
    await page.getByRole("button", { name: "+ ישות", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('input[name="name"]').fill(name);
    await dialog.locator('input[name="country"]').fill("il");
    await dialog.locator('input[name="missingFields"][value="registrationNumber"]').check();
    await dialog.locator('input[name="missingToResolve"]').fill("לבקש את תעודת ההתאגדות");
    await dialog.locator('input[name="sources"]').fill(code);
    let written = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await dialog.getByRole("button", { name: "הוספה לתיק" }).click();
    await written;

    await page.reload();
    const row = () => page.locator("li", { hasText: name }).first();
    await expect(row(), "the entity was not added").toBeVisible({ timeout: 15_000 });
    await expect(row()).toContainText("IL");
    await expect(row()).toContainText("חסר: מספר רישום");

    await row().getByRole("button", { name: "עריכה" }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('input[name="missingFields"][value="registrationNumber"]').uncheck();
    await dialog.locator('input[name="registrationNumber"]').fill("515512345");
    written = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await dialog.getByRole("button", { name: "שמירה" }).click();
    await written;

    await page.reload();
    await expect(row()).toContainText("515512345", { timeout: 15_000 });
    await expect(row()).not.toContainText("חסר:");

    const removed = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await row().getByRole("button", { name: "הסרה" }).click();
    await removed;
    await page.reload();
    await expect(page.locator("li", { hasText: name })).toHaveCount(0, { timeout: 15_000 });
  });
});
