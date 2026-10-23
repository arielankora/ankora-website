import { test, expect } from "./fixtures";

// The procedure as a document (23.10.2026), as the seeded admin: a process
// with a scope and controls, its procedure approved, read as a document,
// listed with the client's procedures, and downloaded as PDF and Word.
//
// Screens: /app/clients/[clientId]/processes/[processId]/document
//          /app/clients/[clientId]/procedures

test.describe.configure({ timeout: 120_000 });

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

test("an approved procedure reads as a document and downloads as PDF and Word", async ({ page }) => {
  const title = tag("[E2E] נוהל");

  await page.goto(`/app/clients/${CLIENT}?tab=file`);
  // A source first: a process is knowledge, and knowledge has one.
  const sourceTitle = tag("[E2E] מקור");
  await page.getByRole("button", { name: "+ מקור", exact: true }).click();
  await page.getByRole("dialog").locator('input[name="title"]').fill(sourceTitle);
  await submit(page, "הוספה למרשם");
  const code = (await page.locator("li", { hasText: sourceTitle }).first().locator("span.font-mono").innerText()).trim();

  await page.getByRole("button", { name: "+ תהליך", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[name="title"]').fill(title);
  await dialog.locator('input[name="purpose"]').fill("לפתוח ולסגור משתמשים עם תיעוד");
  await dialog.locator('input[name="triggerKinds"][value="EVENT"]').check();
  await dialog.locator('input[name="sources"]').fill(code);
  await dialog.getByText("למסמך הנוהל (תחולה, הגדרות, בקרות)").click();
  await dialog.locator('textarea[name="scope"]').fill("כל העובדים בישראל");
  await dialog.locator('input[name="controlRefs"]').fill("CC6.2, CC6.3");
  await submit(page, "הוספה לתיק");

  const card = () => page.locator("li", { hasText: title }).filter({ has: page.getByRole("button", { name: "עריכה" }) }).first();
  await expect(card(), "the process was not added").toBeVisible({ timeout: 15_000 });
  await card().getByRole("button", { name: "כתיבת נוהל" }).click();
  await page.getByRole("dialog").getByLabel("שלב 1: מה עושים").fill("אוספים את פרטי הבקשה");
  await submit(page, "שמירת טיוטה");
  const approved = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
  await card().getByRole("button", { name: "אישור הנוהל" }).click();
  await approved;
  await page.reload();

  await card().getByTestId("procedure-document-link").click();
  await expect(page).toHaveURL(/\/processes\/[^/]+\/document/, { timeout: 15_000 });
  const paper = page.getByTestId("procedure-paper");
  await expect(paper).toContainText(title);
  await expect(paper).toContainText("מטרה");
  await expect(paper).toContainText("כל העובדים בישראל");
  await expect(paper).toContainText("CC6.3");
  await expect(paper).toContainText("אוספים את פרטי הבקשה");
  await expect(paper).toContainText("מאושר ובתוקף");
  // No English yet: the translation is offered, not the download.
  await expect(page.getByTestId("translate-with-claude")).toBeVisible();

  for (const [testId, type] of [
    ["export-pdf", "application/pdf"],
    ["export-docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ] as const) {
    const href = await page.getByTestId(testId).getAttribute("href");
    const res = await page.request.get(href!);
    expect(res.status(), `${testId} failed`).toBe(200);
    expect(res.headers()["content-type"]).toContain(type);
    expect((await res.body()).length).toBeGreaterThan(1000);
  }
  // English without an approved translation is refused, not half translated.
  const en = await page.request.get((await page.getByTestId("export-pdf").getAttribute("href"))!.replace("lang=he", "lang=en"));
  expect(en.status()).toBe(404);

  await page.goto(`/app/clients/${CLIENT}`);
  await page.getByTestId("procedures-index-link").click();
  await expect(page.getByTestId("procedure-row").filter({ hasText: title })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("procedures-pack")).toBeVisible();
});
