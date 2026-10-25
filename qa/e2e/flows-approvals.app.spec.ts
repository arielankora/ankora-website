import { test, expect } from "./fixtures";

// "אישורים" (20.10.2026): every manual approval on one screen, a tab per
// kind. The Preview seed always leaves demo proposals pending on the
// second demo client, so the screen is never empty for the admin this
// project signs in as, and the knowledge tab always has a count. Nothing
// here decides anything: the decisions themselves are the same functions
// the other flows submit, and flows-knowledge submits the knowledge ones
// through this screen.
//
// @covers screen:/app/approvals
// @covers action:(product)/app/(authenticated)/approvals/actions

test.describe.configure({ timeout: 90_000 });

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

/// A process with a draft procedure on the demo client, written on the
/// client's page the way flows-processes does. Its title.
async function draftProcedure(page: import("@playwright/test").Page, step: string): Promise<string> {
  const title = tag("[E2E] נוהל לאישור");
  await page.goto(`/app/clients/${CLIENT}?tab=file`);
  await page.getByRole("button", { name: "+ מקור", exact: true }).click();
  const source = page.getByRole("dialog");
  const sourceTitle = tag("[E2E] מקור");
  await source.locator('input[name="title"]').fill(sourceTitle);
  await submit(page, "הוספה למרשם");
  const code = (await page.locator("li", { hasText: sourceTitle }).first().locator("span.font-mono").innerText()).trim();

  await page.getByRole("button", { name: "+ תהליך", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[name="title"]').fill(title);
  await dialog.locator('input[name="triggerKinds"][value="EVENT"]').check();
  await dialog.locator('input[name="triggerText"]').fill("בקשת עובד");
  // 25.10.2026: with an owner, the only thing between it and running is
  // the procedure waiting for approval.
  const owner = dialog.locator('select[name="ownerId"] option', { hasText: "מנהל Ankora" }).first();
  await dialog.locator('select[name="ownerId"]').selectOption((await owner.getAttribute("value"))!);
  await dialog.locator('input[name="sources"]').fill(code);
  await submit(page, "הוספה לתיק");
  const card = page.locator("li", { hasText: title }).filter({ has: page.getByRole("button", { name: "עריכה" }) }).first();
  await expect(card, "the process was not added").toBeVisible({ timeout: 15_000 });
  await card.getByRole("button", { name: "כתיבת נוהל" }).click();
  await page.getByRole("dialog").getByLabel("שלב 1: מה עושים").fill(step);
  await submit(page, "שמירת טיוטה");
  await expect(card).toContainText("טיוטה, גרסה 1", { timeout: 15_000 });
  return title;
}

test.describe("approvals", () => {
  test("the menu leads to one screen, with all first and a tab for what waits", async ({ page }) => {
    await page.goto("/app");
    const nav = page.getByRole("navigation", { name: "ניווט ראשי" });
    await nav.getByRole("link", { name: /^אישורים/ }).click();
    await expect(page).toHaveURL(/\/app\/approvals$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1, name: "אישורים" })).toBeVisible();

    const tabs = page.getByRole("navigation", { name: "סוגי אישורים" });
    await expect(tabs.getByRole("link", { name: /^הכול/ })).toHaveAttribute("aria-current", "page");
    // The seed's pending proposals: a tab with a count, and rows in "all".
    await expect(tabs.getByRole("link", { name: /^ידע מהחילוץ \(\d+\)$/ })).toBeVisible();
    const rows = page.getByTestId("approval-row");
    await expect(rows.first()).toBeVisible();
    await expect(page.locator('[data-testid="approval-row"][data-kind="knowledge"]').first()).toBeVisible();
  });

  test("a client chip narrows every tab to that client, and the knowledge tab opens the review", async ({ page }) => {
    await page.goto(`/app/approvals?clientId=${CLIENT}`);
    const chips = page.getByTestId("approvals-clients");
    await expect(chips.locator('a[aria-current="true"]')).not.toHaveText("כל הלקוחות");
    const tabs = page.getByRole("navigation", { name: "סוגי אישורים" });
    await tabs.getByRole("link", { name: /^ידע מהחילוץ/ }).click();
    await expect(page).toHaveURL(new RegExp(`tab=knowledge.*clientId=${CLIENT}|clientId=${CLIENT}.*tab=knowledge`), { timeout: 30_000 });
    await expect(page.getByRole("form", { name: "סינון הצעות" })).toBeVisible();
    await expect(page.locator("li", { hasText: "[DEMO] הצעה" }).first()).toBeVisible();
  });

  // 22.10.2026: decisions only, each with a recommendation; what is not
  // yet confirmed is questions for the client, on its owner's card.
  test("all opens on today's few, each row with what is recommended and a button", async ({ page }) => {
    await page.goto("/app/approvals");
    const today = page.getByTestId("approvals-today");
    await expect(today).toBeVisible({ timeout: 30_000 });
    const rows = today.getByTestId("approval-row");
    expect(await rows.count()).toBeLessThanOrEqual(5);
    await expect(rows.first().getByTestId("approval-recommend")).toContainText("מומלץ:");
    // Every row has one thing to press: the decision, or where it is made.
    const first = rows.first();
    await expect(first.getByRole("button").or(first.getByTestId("approval-go")).first()).toBeVisible();
  });

  test("the old address of the things to check opens the questions for the client", async ({ page }) => {
    await page.goto("/app/approvals?tab=review");
    await expect(page.getByRole("navigation", { name: "סוגי אישורים" }).getByRole("link", { name: /^שאלות ללקוח/ })).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("questions")).toBeVisible();
    // A manager may look at everyone's cards.
    await expect(page.getByTestId("questions-scope")).toBeVisible();
  });

  test("an item not yet confirmed becomes a question on the client's card, with a message drafted", async ({ page }) => {
    const title = tag("[E2E] סוג פנייה לשאלה");
    await page.goto(`/app/clients/${CLIENT}?tab=file`);
    await page.getByRole("button", { name: "+ סוג פנייה", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('input[name="title"]').fill(title);
    await dialog.locator('textarea[name="handling"]').fill("עונים במייל");
    await dialog.locator('select[name="knowledgeStatus"]').selectOption("MISSING");
    await dialog.locator('input[name="toResolve"]').fill("לברר עם המנכ״ל מי עונה");
    await submit(page, "הוספה לתיק");

    await page.goto(`/app/approvals?tab=questions&clientId=${CLIENT}&scope=all`);
    const card = page.getByTestId("question-card").filter({ hasText: title }).first();
    await expect(card, "the item is not on a card").toBeVisible({ timeout: 30_000 });
    await expect(card.getByTestId("question-item").filter({ hasText: title })).toContainText("לברר עם המנכ״ל מי עונה");
    await card.getByTestId("question-draft-toggle").click();
    const draft = card.getByTestId("question-draft").locator("textarea");
    await expect(draft).toBeVisible();
    await expect(draft).toHaveValue(/^היי/);
    await expect(draft).toHaveValue(new RegExp("לברר עם המנכ״ל מי עונה"));

    // Clean up: the request type goes, and its question with it.
    await page.goto(`/app/clients/${CLIENT}?tab=file`);
    const row = page.locator("li", { hasText: title }).first();
    const removed = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await row.getByRole("button", { name: "הסרה" }).click();
    await removed;
  });

  test("a process card says its next step, with the details closed once nothing waits on its draft", async ({ page }) => {
    const step = tag("אוספים טופס");
    const title = await draftProcedure(page, step);
    const card = page.locator('[data-testid="process-card"]', { hasText: title }).first();
    // A draft waits: approving it is the next step, and the details are open.
    await expect(card.getByTestId("process-next-step")).toHaveAttribute("data-step", "procedure_draft");
    await expect(card.getByTestId("process-details")).toHaveAttribute("open", "");
    const approved = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await card.getByTestId("process-next-step").getByRole("button", { name: "אישור הנוהל" }).click();
    await approved;
    await page.goto(`/app/clients/${CLIENT}?tab=file`);
    const after = page.locator('[data-testid="process-card"]', { hasText: title }).first();
    await expect(after.getByTestId("process-next-step")).not.toHaveAttribute("data-step", "procedure_draft", { timeout: 15_000 });
    await expect(after.getByTestId("process-details")).not.toHaveAttribute("open", "");
    // The procedure is under "פרטים".
    await after.getByTestId("process-details").locator("summary").click();
    await expect(after.getByTestId("process-details")).toContainText(step);
  });

  test("the client's page leads to its approvals", async ({ page }) => {
    await page.goto(`/app/clients/${CLIENT}`);
    const link = page.getByTestId("client-approvals-link");
    await expect(link).toBeVisible({ timeout: 30_000 });
    await expect(link).toHaveAttribute("href", `/app/approvals?clientId=${CLIENT}`);
  });

  // 22.10.2026, Ariel from a phone: the procedure opened the client's page
  // at the top, its way back was "לקוחות", and there was nothing to read
  // on the row itself.
  test("on a phone, a procedure is read on its row, its link lands on it, the way back returns, and approving stays", async ({ page }) => {
    const step = tag("מכינים קובץ");
    const title = await draftProcedure(page, step);
    await page.setViewportSize({ width: 375, height: 812 });

    await page.goto(`/app/approvals?tab=procedure&clientId=${CLIENT}`);
    const row = page.locator('[data-testid="approval-row"][data-kind="procedure"]', { hasText: title });
    await expect(row).toBeVisible({ timeout: 30_000 });

    // Read before deciding.
    await row.getByTestId("approval-preview-toggle").click();
    await expect(row.getByTestId("approval-preview")).toContainText(step);

    // The link lands on the process, scrolled to it.
    await row.getByRole("link", { name: title }).click();
    await expect(page).toHaveURL(/fromApprovals=.*#item-/, { timeout: 30_000 });
    const target = page.locator(`[id^="item-"]`, { hasText: title }).first();
    await expect(target).toBeInViewport({ timeout: 20_000 });

    // And back to the same tab.
    const back = page.getByRole("link", { name: "אישורים · נהלים" }).first();
    await expect(back).toBeVisible();
    await back.click();
    await expect(page).toHaveURL(new RegExp(`/app/approvals\\?tab=procedure&clientId=${CLIENT}$`), { timeout: 30_000 });

    // Approving keeps the person on the screen.
    const again = page.locator('[data-testid="approval-row"][data-kind="procedure"]', { hasText: title });
    const approved = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await again.getByRole("button", { name: "אישור הנוהל" }).click();
    await approved;
    // "אושר" in place, and once the list refreshes the row is gone: no
    // button to press twice either way.
    await expect(again.getByRole("button", { name: "אישור הנוהל" })).toHaveCount(0, { timeout: 15_000 });
    await expect(page).toHaveURL(/\/app\/approvals\?tab=procedure/);
  });
});
