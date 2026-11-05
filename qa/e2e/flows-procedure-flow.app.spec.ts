import { test, expect } from "./fixtures";

// 4.11.2026 (task cmvtivumj000pjs08q9qj4t67): the procedure flow editor,
// as the seeded admin. A process gets a flow with a condition whose
// branches meet again, and "שמור והפעל" puts it live at once; an automatic
// mail to the client waits for a second pair of eyes instead.
//
// @covers action:(product)/app/(authenticated)/clients/process-actions
// @covers screen:/app/clients/[clientId]/processes/[processId]/flow

test.describe.configure({ timeout: 180_000 });

const CLIENT = "demo-client-b";

function tag(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

async function submit(page: import("@playwright/test").Page, button: string) {
  const written = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
  await page.getByRole("dialog").getByRole("button", { name: button }).click();
  await written;
  await page.reload();
}

test("a flow with a condition goes live with one click; an automatic mail waits for a second pair of eyes", async ({ page }) => {
  const title = tag("[E2E] זרימה");
  await page.goto(`/app/clients/${CLIENT}?tab=file`);

  // A source, then the process.
  const src = tag("[E2E] מקור");
  await page.getByRole("button", { name: "+ מקור", exact: true }).click();
  await page.getByRole("dialog").locator('input[name="title"]').fill(src);
  await submit(page, "הוספה למרשם");
  const code = (await page.locator("li", { hasText: src }).first().locator("span.font-mono").innerText()).trim();

  await page.getByRole("button", { name: "+ תהליך", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[name="title"]').fill(title);
  await dialog.locator('input[name="triggerKinds"][value="EVENT"]').check();
  await dialog.locator('input[name="triggerText"]').fill("בקשת לקוח");
  await dialog.locator('input[name="sources"]').fill(code);
  await submit(page, "הוספה לתיק");

  const card = page.locator("li", { hasText: title }).filter({ has: page.getByRole("button", { name: "עריכה" }) }).first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.getByTestId("procedure-flow-link").click();
  await expect(page.getByTestId("flow-editor")).toBeVisible({ timeout: 15_000 });

  const side = page.locator("aside");
  const inspector = page.getByTestId("flow-inspector");

  // A first action, then a condition after it.
  await side.getByRole("button", { name: "פעולה", exact: true }).click();
  await page.locator(".react-flow__node").first().click();
  await inspector.getByLabel("מה עושים").fill("לבקש מהלקוח את הדוחות");
  await side.getByRole("button", { name: "תנאי", exact: true }).click();
  await page.locator(".react-flow__node").nth(1).click();
  await inspector.getByLabel("השאלה").fill("האם הדוחות הגיעו?");
  await inspector.getByLabel("ענף 1: שם").fill("הגיעו");

  // Both ways out of the condition meet at one end.
  await side.getByRole("button", { name: "סיום", exact: true }).click();
  await page.locator(".react-flow__node").nth(1).click();
  const nextSelects = inspector.getByLabel("ממשיך ל");
  await nextSelects.nth(0).selectOption({ label: "סיום" });
  await nextSelects.nth(1).selectOption({ label: "סיום" });

  await expect(page.getByTestId("flow-issues")).toHaveCount(0);
  const saved = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
  await page.getByTestId("flow-save").click();
  await saved;
  await expect(page.getByTestId("flow-message")).toContainText("הנוהל פעיל", { timeout: 15_000 });

  // An automatic mail on the else branch: saved, not live.
  await page.locator(".react-flow__node").nth(1).click();
  await side.getByRole("button", { name: "שליחת מייל", exact: true }).click();
  const mail = page.locator(".react-flow__node", { hasText: "שליחת מייל" }).last();
  await mail.click();
  await inspector.getByLabel("נוסח").fill("שלום {{שם איש הקשר}}, עדיין מחכים לדוחות.");
  await inspector.getByLabel("שליחה אוטומטית").check();
  await inspector.getByLabel("ממשיך ל").selectOption({ label: "סיום" });
  await page.locator(".react-flow__node").nth(1).click();
  await inspector.getByLabel("ממשיך ל").nth(1).selectOption({ label: "שליחת מייל" });
  await expect(page.getByTestId("flow-issues")).toHaveCount(0);
  const again = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
  await page.getByTestId("flow-save").click();
  await again;
  await expect(page.getByTestId("flow-message")).toContainText("עין שנייה", { timeout: 15_000 });
});
