import { test, expect } from "./fixtures";

// Org brain, phase 2 (13.10.2026): the people and organizations panel on the
// client screen, submitted for real. Rendering the client screen does not
// submit these forms, so this file is what holds the action's browser
// coverage. Same prose rule as flows-admin: modules are named in words here,
// never by path.
//
// @covers action:(product)/app/(authenticated)/clients/people-actions

test.describe.configure({ timeout: 90_000 });

const CLIENT = "demo-client-b";

function tag(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/// Every item cites a source (spec 3.2), so each test first adds one to the
/// register and reads back the code it was given.
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
  const code = (await row.first().locator("span.font-mono").innerText()).trim();
  expect(code).toMatch(/^S\d+$/);
  return code;
}

test.describe("clients/people-actions", () => {
  test("a contact added from the panel is in the file after a reload, and can be removed", async ({ page }) => {
    const name = tag("[E2E] איש קשר");
    const email = `${name.replace(/[^a-z0-9]/gi, "").toLowerCase() || "e2e"}@example.com`;
    // Unique per attempt: a person is matched by phone too, and a retry that
    // reused the number would find the first attempt's person.
    const local = `05${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

    await page.goto(`/app/clients/${CLIENT}?tab=file`);
    const code = await addSource(page);
    await page.getByRole("button", { name: "+ איש קשר", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('input[name="name"]').fill(name);
    await dialog.locator('input[name="role"]').fill("VP Finance");
    await dialog.locator('input[name="emails"]').fill(email);
    await dialog.locator('input[name="phones"]').fill(local);
    await dialog.locator('input[name="sources"]').fill(`${code} 08:13`);

    const written = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await dialog.getByRole("button", { name: "הוספה לתיק" }).click();
    await written;

    await page.reload();
    const row = page.locator("li", { hasText: name });
    await expect(row.first(), "the contact was not added").toBeVisible({ timeout: 15_000 });
    // The phone is stored normalized, as the person it identifies.
    await expect(row.first()).toContainText(`+972${local.slice(1)}`);
    await expect(row.first()).toContainText(`${code} 08:13`);

    const removed = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await row.first().getByRole("button", { name: "הסרה" }).click();
    await removed;
    await page.reload();
    await expect(page.locator("li", { hasText: name })).toHaveCount(0, { timeout: 15_000 });
  });

  test("an organization added from the panel shows its role and monthly cost", async ({ page }) => {
    const name = tag("[E2E] ארגון");

    await page.goto(`/app/clients/${CLIENT}?tab=file`);
    const code = await addSource(page);
    await page.getByRole("button", { name: "+ ארגון", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('input[name="name"]').fill(name);
    await dialog.locator('input[name="role"]').fill("הנהלת חשבונות");
    await dialog.locator('input[name="monthlyCost"]').fill("22000");
    await dialog.locator('input[name="sources"]').fill(code);

    const written = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await dialog.getByRole("button", { name: "הוספה לתיק" }).click();
    await written;

    await page.reload();
    const row = page.locator("li", { hasText: name });
    await expect(row.first(), "the organization was not added").toBeVisible({ timeout: 15_000 });
    await expect(row.first()).toContainText("הנהלת חשבונות");
    await expect(row.first()).toContainText("22,000");
  });
});
