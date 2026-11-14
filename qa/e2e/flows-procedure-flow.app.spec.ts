import { test, expect } from "./fixtures";
import { fillRhythm, whenSomethingHappens } from "./rhythm";
import { newProcess, tag } from "./process-page";

// 4.11.2026 (task cmvtivumj000pjs08q9qj4t67): the procedure flow editor,
// as the seeded admin. A process gets a flow with a condition whose
// branches meet again, and "שמור והפעל" puts it live at once; an automatic
// mail to the client waits for a second pair of eyes instead.
//
// @covers action:(product)/app/(authenticated)/clients/process-actions
// @covers screen:/app/clients/[clientId]/processes/[processId]/flow
// @covers screen:/app/clients/[clientId]/processes/[processId]/steps

test.describe.configure({ timeout: 180_000 });

test("a flow with a condition goes live with one click; an automatic mail waits for a second pair of eyes", async ({ page }) => {
  const title = tag("[E2E] זרימה");
  // 13.11.2026 (stage 2): the process is added from the list and opens on
  // its page; what starts it is set in the rhythm editor, open on arrival.
  // 14.11.2026 (stage 3): the flow is the steps editor's "תרשים" view.
  const href = await newProcess(page, title, { owner: false });
  await fillRhythm(page, whenSomethingHappens("בקשת לקוח"));
  await page.getByTestId("process-edit-steps").click();
  await expect(page.getByTestId("steps-editor")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("group", { name: "תצוגה" }).getByRole("button", { name: "תרשים" }).click();
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

  await expect(page.getByTestId("steps-passed")).toBeVisible();
  // 14.11.2026 (stage 3): "שמירה ואישור" for whoever approves procedures of
  // the client; live, it goes back to the process.
  await page.getByTestId("steps-save-approve").click();
  await expect(page).toHaveURL(new RegExp(`${href}$`), { timeout: 15_000 });
  await expect(page.getByTestId("process-page")).toContainText("גרסה 1", { timeout: 15_000 });
  await expect(page.getByTestId("process-draft")).toHaveCount(0);

  // An automatic mail on the else branch: saved, not live.
  await page.getByTestId("process-edit-steps").click();
  await expect(page.getByTestId("flow-editor")).toBeVisible({ timeout: 15_000 });
  await page.locator(".react-flow__node").nth(1).click();
  await side.getByRole("button", { name: "שליחת מייל", exact: true }).click();
  const mail = page.locator(".react-flow__node", { hasText: "שליחת מייל" }).last();
  await mail.click();
  await inspector.getByLabel("נוסח").fill("שלום {{שם איש הקשר}}, עדיין מחכים לדוחות.");
  await inspector.getByLabel("שליחה אוטומטית").check();
  await inspector.getByLabel("ממשיך ל").selectOption({ label: "סיום" });
  await page.locator(".react-flow__node").nth(1).click();
  await inspector.getByLabel("ממשיך ל").nth(1).selectOption({ label: "שליחת מייל" });
  await expect(page.getByTestId("steps-passed")).toBeVisible();
  await page.getByTestId("steps-save-approve").click();
  await expect(page.getByTestId("steps-message")).toContainText("עין שנייה", { timeout: 15_000 });
});
