import { test, expect } from "./fixtures";
import { fillRhythm, whenSomethingHappens } from "./rhythm";
import { approveDraft, CLIENT, newProcess, tag, writeStep } from "./process-page";

// The procedure as a document (23.10.2026), as the seeded admin: a process
// with a scope and controls, its procedure approved, read as a document,
// listed with the client's procedures, and downloaded as PDF and Word.
//
// Screens: /app/clients/[clientId]/processes/[processId]/document
//          /app/clients/[clientId]/procedures

test.describe.configure({ timeout: 120_000 });

test("an approved procedure reads as a document and downloads as PDF and Word", async ({ page }) => {
  const title = tag("[E2E] נוהל");

  // 13.11.2026 (stage 2): added from the list, then the document's fields in
  // the process page's "מסמך הנוהל" tab.
  await test.step("a process", async () => {
    await newProcess(page, title, { purpose: "לפתוח ולסגור משתמשים עם תיעוד" });
    await fillRhythm(page, whenSomethingHappens("בקשת עובד"));
  });
  await test.step("its document's fields", async () => {
    await page.getByTestId("process-tab-document").click();
    const doc = page.getByTestId("process-document");
    await doc.locator('textarea[name="scope"]').fill("כל העובדים בישראל");
    await doc.locator('input[name="controlRefs"]').fill("CC6.2, CC6.3");
    const saved = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400, { timeout: 30_000 });
    await doc.getByRole("button", { name: "שמירה" }).click();
    await saved;
    await page.reload();
  });
  await test.step("write and approve the procedure", async () => {
    await writeStep(page, "אוספים את פרטי הבקשה");
    await expect(page.getByTestId("process-draft")).toContainText("טיוטה 1 מחכה לאישור", { timeout: 15_000 });
    await approveDraft(page);
    await expect(page.getByTestId("process-page")).toContainText("גרסה 1");
  });

  await page.getByTestId("process-tab-document").click();
  await page.getByTestId("procedure-document-link").click({ timeout: 15_000 });
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

  // The way to the client's procedures is on the processes list.
  await page.goto(`/app/clients/${CLIENT}?tab=file&section=processes`);
  await page.getByTestId("procedures-index-link").click({ timeout: 15_000 });
  await expect(page.getByTestId("procedure-row").filter({ hasText: title })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("procedures-pack")).toBeVisible();
});
