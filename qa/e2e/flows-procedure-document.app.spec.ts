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
  const written = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400, { timeout: 30_000 });
  await page.getByRole("dialog").getByRole("button", { name: button }).click({ timeout: 15_000 });
  await written;
  await page.reload();
}

/// The same as flows-processes: a source, and its code.
async function addSource(page: import("@playwright/test").Page): Promise<string> {
  const title = tag("[E2E] מקור");
  await page.getByRole("button", { name: "+ מקור", exact: true }).click({ timeout: 15_000 });
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.locator('input[name="title"]').fill(title, { timeout: 15_000 });
  await submit(page, "הוספה למרשם");
  const row = page.locator("li", { hasText: title });
  await expect(row.first(), "the source was not added").toBeVisible({ timeout: 15_000 });
  return (await row.first().locator("span.font-mono").innerText({ timeout: 15_000 })).trim();
}

test("an approved procedure reads as a document and downloads as PDF and Word", async ({ page }) => {
  const title = tag("[E2E] נוהל");

  await page.goto(`/app/clients/${CLIENT}?tab=file`);
  const code = await test.step("a source", () => addSource(page));

  await page.getByRole("button", { name: "+ תהליך", exact: true }).click({ timeout: 15_000 });
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.locator('input[name="title"]').fill(title);
  await dialog.locator('input[name="purpose"]').fill("לפתוח ולסגור משתמשים עם תיעוד");
  await dialog.locator('input[name="triggerKinds"][value="EVENT"]').check();
  await dialog.locator('input[name="sources"]').fill(code);
  await dialog.getByText("למסמך הנוהל (תחולה, הגדרות, בקרות)").click({ timeout: 15_000 });
  await dialog.locator('textarea[name="scope"]').fill("כל העובדים בישראל");
  await dialog.locator('input[name="controlRefs"]').fill("CC6.2, CC6.3");
  await submit(page, "הוספה לתיק");

  const card = () => page.locator("li", { hasText: title }).filter({ has: page.getByRole("button", { name: "עריכה" }) }).first();
  await expect(card(), "the process was not added").toBeVisible({ timeout: 15_000 });
  await test.step("write and approve the procedure", async () => {
    await card().getByRole("button", { name: "כתיבת נוהל" }).click({ timeout: 15_000 });
    const editor = page.getByRole("dialog");
    await expect(editor).toBeVisible();
    await editor.getByLabel("שלב 1: מה עושים").fill("אוספים את פרטי הבקשה", { timeout: 15_000 });
    await submit(page, "שמירת טיוטה");
    await expect(card()).toContainText("טיוטה, גרסה 1", { timeout: 15_000 });
    const approved = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400, { timeout: 30_000 });
    await card().getByRole("button", { name: "אישור הנוהל" }).first().click({ timeout: 15_000 });
    await approved;
    await page.reload();
    await expect(card()).toContainText("נוהל, גרסה 1", { timeout: 15_000 });
  });

  await card().getByTestId("procedure-document-link").click({ timeout: 15_000 });
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
    const href = await page.getByTestId(testId).getAttribute("href", { timeout: 15_000 });
    const res = await page.request.get(href!);
    expect(res.status(), `${testId} failed`).toBe(200);
    expect(res.headers()["content-type"]).toContain(type);
    expect((await res.body()).length).toBeGreaterThan(1000);
  }
  // English without an approved translation is refused, not half translated.
  const en = await page.request.get((await page.getByTestId("export-pdf").getAttribute("href", { timeout: 15_000 }))!.replace("lang=he", "lang=en"));
  expect(en.status()).toBe(404);

  // The processes panel is on the client file's tab.
  await page.goto(`/app/clients/${CLIENT}?tab=file`);
  await page.getByTestId("procedures-index-link").click({ timeout: 15_000 });
  await expect(page.getByTestId("procedure-row").filter({ hasText: title })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("procedures-pack")).toBeVisible();
});
