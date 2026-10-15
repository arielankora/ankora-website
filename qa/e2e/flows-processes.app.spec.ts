import { test, expect } from "./fixtures";

// Org brain, phase 1 (16.10.2026): a process and its procedure on the
// client screen, submitted for real, as the seeded admin. Same prose rule
// as flows-admin: modules are named in words here, never by path.
//
// @covers action:(product)/app/(authenticated)/clients/process-actions

test.describe.configure({ timeout: 120_000 });

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

async function submit(page: import("@playwright/test").Page, button: string) {
  const written = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
  await page.getByRole("dialog").getByRole("button", { name: button }).click();
  await written;
  await page.reload();
}

test.describe("clients/process-actions", () => {
  test("a procedure that automates a payment is held back; fixed, a manager approves it", async ({ page }) => {
    const title = tag("[E2E] תהליך");

    await page.goto(`/app/clients/${CLIENT}?tab=file`);
    const code = await addSource(page);

    await page.getByRole("button", { name: "+ תהליך", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('input[name="title"]').fill(title);
    await dialog.locator('input[name="triggerKinds"][value="EVENT"]').check();
    await dialog.locator('input[name="triggerText"]').fill("בקשת עובד");
    await dialog.locator('input[name="sources"]').fill(code);
    await submit(page, "הוספה לתיק");

    // The process's card in the panel, not a line elsewhere with the same name.
    const card = () => page.locator("li", { hasText: title }).filter({ has: page.getByRole("button", { name: "עריכה" }) }).first();
    await expect(card(), "the process was not added").toBeVisible({ timeout: 15_000 });
    await expect(card()).toContainText("אין נוהל מאושר");
    await expect(card()).toContainText("מתוך 9");

    await card().getByRole("button", { name: "כתיבת נוהל" }).click();
    const editor = page.getByRole("dialog");
    await expect(editor).toBeVisible();
    await editor.getByLabel("שלב 1: מה עושים").fill("מעבירים תשלום לספק");
    await editor.getByLabel("שלב 1: איך").selectOption("AUTOMATED");
    await editor.getByRole("checkbox", { name: "תשלום" }).check();
    await submit(page, "שמירת טיוטה");

    await expect(card()).toContainText("טיוטה, גרסה 1", { timeout: 15_000 });
    await expect(card()).toContainText("לא נעשה אוטומטית");
    await expect(card().getByRole("button", { name: "אישור הנוהל" })).toHaveCount(0);

    await card().getByRole("button", { name: "עריכת הטיוטה" }).click();
    const fix = page.getByRole("dialog");
    await expect(fix).toBeVisible();
    await fix.getByLabel("שלב 1: איך").selectOption("MANUAL");
    await submit(page, "שמירת טיוטה");
    await expect(card()).toContainText("טיוטה, גרסה 2", { timeout: 15_000 });

    const approved = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await card().getByRole("button", { name: "אישור הנוהל" }).click();
    await approved;
    await page.reload();
    await expect(card()).toContainText("נוהל, גרסה 2", { timeout: 15_000 });
    await expect(card()).not.toContainText("אין נוהל מאושר");

    // An event happened: a run opens as a task, and the card links to it.
    await card().getByRole("button", { name: "פתיחת ריצה" }).click();
    const start = page.getByRole("dialog");
    await expect(start).toBeVisible();
    const today = new Date().toISOString().slice(0, 10);
    await start.locator('input[name="day"]').fill(today);
    await submit(page, "פתיחת הריצה");
    await expect(card()).toContainText("ריצות:", { timeout: 15_000 });
    await card().getByRole("link").first().click();
    await expect(page).toHaveURL(/\/app\/tasks\//, { timeout: 15_000 });
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("מעבירים תשלום לספק").first()).toBeVisible();
  });
});
