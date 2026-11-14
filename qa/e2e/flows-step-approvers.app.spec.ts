import { test, expect } from "./fixtures";
import { fillRhythm, whenSomethingHappens } from "./rhythm";
import { addSource, approveDraft, CLIENT, newProcess, saveDraft, submit, tag } from "./process-page";

// An approver for each step (14.11.2026, processes redesign, stage 3,
// "Run.dc.html"), as the seeded admin, submitted for real. A step a
// contact at the client approves is named on the run, closed only with
// when and how they approved, and a contact who left puts the process
// under "צריך טיפול".
//
// @covers action:(product)/app/(authenticated)/tasks/actions
// @covers screen:/app/clients/[clientId]/processes/[processId]/steps

test.describe.configure({ timeout: 180_000 });

async function addContact(page: import("@playwright/test").Page, name: string) {
  await page.goto(`/app/clients/${CLIENT}?tab=file&section=all`);
  const code = await addSource(page);
  await page.getByRole("button", { name: "+ איש קשר", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.locator('input[name="name"]').fill(name);
  await dialog.locator('input[name="sources"]').fill(code);
  await submit(page, "הוספה לתיק");
}

test("a step approved at the client waits on the run, is written down, and a contact who left needs a new approver", async ({ page }) => {
  const dana = tag("[E2E] דנה");
  await addContact(page, dana);
  const title = tag("[E2E] אישור לקוח");
  const href = await newProcess(page, title);
  await fillRhythm(page, whenSomethingHappens("בקשה"));

  // The steps editor: one step, its approver Dana, at the client.
  await page.getByTestId("process-edit-steps").click();
  await expect(page.getByTestId("steps-editor")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("steps-empty").getByRole("button", { name: "+ שלב" }).click();
  await page.getByLabel("שלב 1: מה עושים").fill("אישור רשימת התשלומים");
  await page.getByLabel("שלב 1: מאשר").selectOption({ label: dana });
  await expect(page.getByTestId("step-panel")).toContainText("מאשר אצל הלקוח לא עוצר את הריצה");
  await expect(page.getByTestId("step-card").first()).toContainText(`מאשר: ${dana}, אצל הלקוח`);
  await saveDraft(page);
  await approveDraft(page);
  await expect(page.getByTestId("process-page")).toContainText("מאשר אצל הלקוח: מתעדים מתי ואיך אושר");

  // A run: the step waits for Dana, and is closed by writing down how.
  await page.getByRole("button", { name: "הרצה עכשיו" }).click();
  const start = page.getByRole("dialog");
  await start.locator('input[name="day"]').fill(new Date().toISOString().slice(0, 10));
  await submit(page, "פתיחת הריצה");
  await page.getByTestId("process-open-run").getByRole("link", { name: "לריצה" }).click();
  await expect(page).toHaveURL(/\/app\/tasks\//, { timeout: 15_000 });
  await expect(page.getByTestId("task-run-of")).toContainText(title);
  const waiting = page.getByTestId("step-awaiting-client");
  await expect(waiting).toContainText(`מחכה לאישור של ${dana}, אצל הלקוח`);
  await waiting.getByRole("button", { name: `${dana} אישר/ה` }).click();
  const dialog = page.getByTestId("client-approval-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("איך").selectOption({ label: "במייל" });
  const written = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
  await dialog.getByRole("button", { name: "שמירה וסימון כבוצע" }).click();
  await written;
  await page.reload();
  await expect(page.getByTestId("step-client-approved")).toContainText(`אושר על ידי ${dana} במייל`, { timeout: 15_000 });
  await expect(page.getByTestId("step-awaiting-client")).toHaveCount(0);

  // Dana leaves: the process needs a new approver.
  await page.goto(`/app/clients/${CLIENT}?tab=file&section=all`);
  const row = page.locator("li", { hasText: dana }).filter({ has: page.getByRole("button", { name: "עריכה" }) }).first();
  await row.getByRole("button", { name: "עריכה" }).click();
  const edit = page.getByRole("dialog");
  await edit.locator('input[name="endedAt"]').fill(new Date().toISOString().slice(0, 10));
  await submit(page, "שמירה");
  await expect(page.locator("li", { hasText: dana }).getByTestId("contact-ended").first()).toBeVisible({ timeout: 15_000 });
  await page.goto(`/app/clients/${CLIENT}?tab=file&section=processes`);
  await expect(page.getByTestId("process-attention")).toContainText(`צריך מאשר חדש לשלב 1: ${dana} עזב`, { timeout: 15_000 });
  await page.goto(href);
  await expect(page.getByTestId("process-approver-left")).toContainText(dana);
});
