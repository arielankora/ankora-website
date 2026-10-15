import { test, expect } from "./fixtures";

// Org brain, phase 3 (15.10.2026): the client's own rules on the client
// screen, submitted for real, as the seeded admin. Same prose rule as
// flows-admin: modules are named in words here, never by path.
//
// @covers action:(product)/app/(authenticated)/clients/policy-actions

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

async function submit(page: import("@playwright/test").Page, button: string) {
  const dialog = page.getByRole("dialog");
  const written = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
  await dialog.getByRole("button", { name: button }).click();
  await written;
  await page.reload();
}

test.describe("clients/policy-actions", () => {
  test("a proposed permission shows its interim rule, a manager approves it, and it is retired with a reason", async ({ page }) => {
    const title = tag("[E2E] כלל");

    await page.goto(`/app/clients/${CLIENT}?tab=file`);
    const code = await addSource(page);

    await page.getByRole("button", { name: "+ כלל", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('select[name="kind"]').selectOption("THRESHOLD");
    await dialog.locator('input[name="title"]').fill(title);
    await dialog.locator('textarea[name="statement"]').fill("תוכנה עד 3,000$ בשנה מאושרת");
    await dialog.locator('textarea[name="interimStatement"]').fill("כל הוצאה עוברת לאורן");
    await dialog.locator('input[name="sources"]').fill(code);
    await submit(page, "הוספה לתיק");

    const row = () => page.locator("li", { hasText: title }).first();
    await expect(row(), "the rule was not added").toBeVisible({ timeout: 15_000 });
    await expect(row()).toContainText("מוצע");
    await expect(row()).toContainText("עד שיאושר: כל הוצאה עוברת לאורן");

    const approved = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await row().getByRole("button", { name: "אישור הכלל" }).click();
    await approved;
    await page.reload();
    await expect(row()).toContainText("בתוקף", { timeout: 15_000 });
    await expect(row()).toContainText("תוכנה עד 3,000$ בשנה מאושרת");

    await row().getByRole("button", { name: "ביטול", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("dialog").locator('input[name="reason"]').fill("[E2E] בוטל בבדיקה");
    await submit(page, "ביטול הכלל");
    await expect(page.locator("li", { hasText: title }).getByRole("button", { name: "אישור הכלל" })).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText(/כללים שבוטלו/)).toBeVisible();
  });

  test("a disclosure rule is shown above the tabs, and a proposed rule written by mistake is removed", async ({ page }) => {
    const title = tag("[E2E] חשיפה");

    await page.goto(`/app/clients/${CLIENT}?tab=file`);
    const code = await addSource(page);
    await page.getByRole("button", { name: "+ כלל", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator('select[name="kind"]').selectOption("DISCLOSURE");
    await dialog.locator('input[name="title"]').fill(title);
    await dialog.locator('textarea[name="statement"]').fill("לא מספרים לעובדים");
    await dialog.locator('input[name="sources"]').fill(code);
    await submit(page, "הוספה לתיק");

    const banner = page.getByRole("note");
    await expect(banner).toContainText(title, { timeout: 15_000 });
    // On the work tab too: it is the first thing on the screen.
    await page.goto(`/app/clients/${CLIENT}`);
    await expect(page.getByRole("note")).toContainText(title);

    await page.goto(`/app/clients/${CLIENT}?tab=file`);
    // The rule's row in the panel, not its line in the banner above the
    // tabs, which carries the same name.
    const row = page.locator("li", { hasText: title }).filter({ has: page.getByRole("button", { name: "עריכה" }) });
    const removed = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await row.first().getByRole("button", { name: "הסרה" }).click();
    await removed;
    await page.reload();
    await expect(page.locator("li", { hasText: title })).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText(title)).toHaveCount(0);
  });
});

test.describe("clients/policy-actions: what is checked", () => {
  test("a channel rule says what it checks in procedures", async ({ page }) => {
    const title = tag("[E2E] ערוצים");

    await page.goto(`/app/clients/${CLIENT}?tab=file`);
    const code = await addSource(page);
    await page.getByRole("button", { name: "+ כלל", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator('select[name="kind"]').selectOption("COMMUNICATION");
    await dialog.locator('input[name="title"]').fill(title);
    await dialog.locator('textarea[name="statement"]').fill("החלטות מול הלקוח רק במייל");
    await dialog.locator('input[name="channels"][value="EMAIL"]').check();
    await dialog.locator('input[name="sources"]').fill(code);
    await submit(page, "הוספה לתיק");

    const row = () => page.locator("li", { hasText: title }).filter({ has: page.getByRole("button", { name: "עריכה" }) }).first();
    await expect(row(), "the rule was not added").toBeVisible({ timeout: 15_000 });
    await expect(row()).toContainText("נבדק בנהלים: הודעה ללקוח רק במייל");

    // Removed right away: a channel rule binds every procedure of the
    // client, and other specs write procedures on this one.
    const removed = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await row().getByRole("button", { name: "הסרה" }).click();
    await removed;
    await page.reload();
    await expect(page.locator("li", { hasText: title })).toHaveCount(0, { timeout: 15_000 });
  });
});

test.describe("clients/policy-actions: exceptions", () => {
  test("an exception to a rule is requested with an end date and approved by the client's approver", async ({ page }) => {
    const title = tag("[E2E] הפרדה");
    const what = tag("[E2E] לשלוח לאיילה");

    await page.goto(`/app/clients/${CLIENT}?tab=file`);
    const code = await addSource(page);
    await page.getByRole("button", { name: "+ כלל", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator('select[name="kind"]').selectOption("SEPARATION");
    await dialog.locator('input[name="title"]').fill(title);
    await dialog.locator('textarea[name="statement"]').fill("לא שולחים לאיילה שום דבר של Inc");
    await dialog.locator('input[name="sources"]').fill(code);
    await submit(page, "הוספה לתיק");

    const row = () => page.locator("li", { hasText: title }).filter({ has: page.getByRole("button", { name: "עריכה" }) }).first();
    await expect(row(), "the rule was not added").toBeVisible({ timeout: 15_000 });
    await row().getByRole("button", { name: "בקשת חריגה" }).click();
    const ask = page.getByRole("dialog");
    await expect(ask).toBeVisible();
    await ask.locator('textarea[name="what"]').fill(what);
    await ask.locator('input[name="reason"]').fill("שני בחופשה");
    const inTenDays = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await ask.locator('input[name="validUntil"]').fill(inTenDays);
    await submit(page, "שליחת הבקשה");

    await expect(row()).toContainText("בקשה לחריגה", { timeout: 15_000 });
    await expect(row()).toContainText(what);

    // The seeded admin approves exceptions (decision 5), its own included.
    const approved = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await row().getByRole("button", { name: "אישור החריגה" }).click();
    await approved;
    await page.reload();
    await expect(row()).toContainText("חריגה עד", { timeout: 15_000 });
    await expect(row().getByRole("button", { name: "אישור החריגה" })).toHaveCount(0);
  });
});
