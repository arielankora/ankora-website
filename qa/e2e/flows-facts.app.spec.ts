import { test, expect } from "./fixtures";

// Org brain, phase 2 (14.10.2026): the facts of the client file, submitted
// for real. Same prose rule as flows-admin: modules are named in words
// here, never by path.
//
// @covers action:(product)/app/(authenticated)/clients/fact-actions

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
  const dialog = page.getByRole("dialog");
  const written = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
  await dialog.getByRole("button", { name: button }).click();
  await written;
  await page.reload();
}

test.describe("clients/fact-actions", () => {
  test("a preference replaced by a new version keeps the old one in the history", async ({ page }) => {
    const first = tag("[E2E] העדפה");
    const second = tag("[E2E] העדפה חדשה");

    await page.goto(`/app/clients/${CLIENT}`);
    const code = await addSource(page);
    await page.getByRole("button", { name: "+ פריט", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('select[name="kind"]').selectOption("PREFERENCE");
    await dialog.locator('textarea[name="body"]').fill(first);
    await dialog.locator('input[name="sources"]').fill(code);
    await submit(page, "הוספה לתיק");

    const row = page.locator("li", { hasText: first });
    await expect(row.first(), "the preference was not added").toBeVisible({ timeout: 15_000 });

    await row.first().getByRole("button", { name: "החלפה" }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('textarea[name="body"]').fill(second);
    await submit(page, "שמירת הגרסה החדשה");

    await expect(page.locator("li", { hasText: second }).first(), "the new version is not shown").toBeVisible({ timeout: 15_000 });
    // The old words are still in the file, under the history.
    await page.getByText(/היסטוריה: גרסאות שהוחלפו/).click();
    await expect(page.locator("li", { hasText: first }).first()).toBeVisible();
  });

  test("an open question answered with a source shows its answer", async ({ page }) => {
    const question = tag("[E2E] שאלה");

    await page.goto(`/app/clients/${CLIENT}`);
    const code = await addSource(page);
    await page.getByRole("button", { name: "+ פריט", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('select[name="kind"]').selectOption("QUESTION");
    await dialog.locator('textarea[name="body"]').fill(question);
    await submit(page, "הוספה לתיק");

    const row = page.locator("li", { hasText: question });
    await expect(row.first(), "the question was not added").toBeVisible({ timeout: 15_000 });

    await row.first().getByRole("button", { name: "תשובה" }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('textarea[name="answer"]').fill("אורן וגיא, ביחד");
    await dialog.locator('input[name="sources"]').fill(`${code} 33:05`);
    await submit(page, "שמירת התשובה");

    const answered = page.locator("li", { hasText: question }).first();
    await expect(answered).toContainText("אורן וגיא, ביחד", { timeout: 15_000 });
    await expect(answered).toContainText(`${code} 33:05`);

    const removed = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await answered.getByRole("button", { name: "הסרה" }).click();
    await removed;
    await page.reload();
    await expect(page.locator("li", { hasText: question })).toHaveCount(0, { timeout: 15_000 });
  });
});
