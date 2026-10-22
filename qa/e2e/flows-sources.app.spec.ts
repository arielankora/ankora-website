import { test, expect } from "./fixtures";

// Org brain, phase 2 (13.10.2026): the source register and the domains on
// the client screen, submitted for real. Same prose rule as flows-admin:
// modules are named in words here, never by path.
//
// @covers action:(product)/app/(authenticated)/clients/source-actions

test.describe.configure({ timeout: 90_000 });

const CLIENT = "demo-client-b";

function tag(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

test.describe("clients/source-actions", () => {
  test("a source added to the register gets the next code, and an unused one can be removed", async ({ page }) => {
    const title = tag("[E2E] פגישה");

    await page.goto(`/app/clients/${CLIENT}?tab=file`);
    await page.getByRole("button", { name: "+ מקור", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('select[name="kind"]').selectOption("ANKORA_DOCUMENT");
    await dialog.locator('input[name="title"]').fill(title);
    await dialog.locator('input[name="participants"]').fill("אורן, הדס");

    const written = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await dialog.getByRole("button", { name: "הוספה למרשם" }).click();
    await written;

    await page.reload();
    const row = page.locator("li", { hasText: title });
    await expect(row.first(), "the source was not added").toBeVisible({ timeout: 15_000 });
    await expect(row.first().locator("span.font-mono")).toHaveText(/^S\d+$/);
    // An Ankora document is secondary by default.
    await expect(row.first()).toContainText("משני");
    await expect(row.first()).toContainText("אורן, הדס");

    const removed = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await row.first().getByRole("button", { name: "הסרה" }).click();
    await removed;
    await page.reload();
    await expect(page.locator("li", { hasText: title })).toHaveCount(0, { timeout: 15_000 });
  });

  test("items uncertain only because Ankora wrote them are confirmed with the client in one step", async ({ page }) => {
    const title = tag("[E2E] סיכום היכרות");
    const body = tag("[E2E] אוכל כשר בלבד");

    await page.goto(`/app/clients/${CLIENT}?tab=file`);
    await page.getByRole("button", { name: "+ מקור", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('select[name="kind"]').selectOption("ANKORA_DOCUMENT");
    await dialog.locator('input[name="title"]').fill(title);
    let written = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await dialog.getByRole("button", { name: "הוספה למרשם" }).click();
    await written;
    await page.reload();
    const source = () => page.locator("li", { hasText: title }).first();
    await expect(source(), "the source was not added").toBeVisible({ timeout: 15_000 });
    const code = (await source().locator("span.font-mono").innerText()).trim();

    // A fact from it alone is lowered to "uncertain" (R14).
    await page.getByRole("button", { name: "+ פריט", exact: true }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('select[name="kind"]').selectOption("PREFERENCE");
    await dialog.locator('textarea[name="body"]').fill(body);
    await dialog.locator('input[name="sources"]').fill(code);
    written = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await dialog.getByRole("button", { name: "הוספה לתיק" }).click();
    await written;
    await page.reload();

    await expect(source().getByTestId("source-lowered")).toContainText("פריט אחד לא ודאי", { timeout: 15_000 });
    await source().getByRole("button", { name: "אושר מול הלקוח" }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('input[name="note"]').fill("[E2E] אושר בשיחה");
    written = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await dialog.getByRole("button", { name: "אושר מול הלקוח" }).click();
    await written;
    await page.reload();

    await expect(source()).toContainText("סיכום שיחה עם הלקוח", { timeout: 15_000 });
    await expect(source().getByTestId("source-lowered")).toHaveCount(0);
    await expect(source()).not.toContainText("משני");
  });

  test("an Ankora document can be registered as a summary of a conversation with the client", async ({ page }) => {
    const title = tag("[E2E] סיכום שיחה");
    await page.goto(`/app/clients/${CLIENT}?tab=file`);
    await page.getByRole("button", { name: "+ מקור", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('select[name="kind"]').selectOption("ANKORA_DOCUMENT");
    await dialog.locator('select[name="weight"]').selectOption("PRIMARY");
    await expect(dialog.locator('select[name="weight"] option[value="PRIMARY"]')).toContainText("סיכום שיחה עם הלקוח");
    await dialog.locator('input[name="title"]').fill(title);
    const written = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await dialog.getByRole("button", { name: "הוספה למרשם" }).click();
    await written;
    await page.reload();
    const row = page.locator("li", { hasText: title }).first();
    await expect(row).toContainText("סיכום שיחה עם הלקוח", { timeout: 15_000 });
    await expect(row).not.toContainText("משני");
  });

  test("a client domain is stored normalized, and can be removed", async ({ page }) => {
    const domain = `${tag("e2e").toLowerCase()}.example`;

    await page.goto(`/app/clients/${CLIENT}?tab=file`);
    await page.getByRole("button", { name: "+ דומיין", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('input[name="domain"]').fill(`https://www.${domain.toUpperCase()}/`);

    const written = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await dialog.getByRole("button", { name: "הוספה", exact: true }).click();
    await written;

    await page.reload();
    const row = page.locator("li", { hasText: domain });
    await expect(row.first(), "the domain was not added").toBeVisible({ timeout: 15_000 });
    await expect(row.first()).toContainText("של הלקוח");

    const removed = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await row.first().getByRole("button", { name: "הסרה" }).click();
    await removed;
    await page.reload();
    await expect(page.locator("li", { hasText: domain })).toHaveCount(0, { timeout: 15_000 });
  });
});
