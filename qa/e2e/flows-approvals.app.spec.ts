import { test, expect } from "./fixtures";
import { fillRhythm, whenSomethingHappens } from "./rhythm";
import { approveDraft, newProcess, writeStep } from "./process-page";

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
// @covers action:(product)/app/(authenticated)/clients/question-actions

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

/// A process with a draft procedure on the demo client, added from the
/// processes list the way flows-processes does. Its title.
async function draftProcedure(page: import("@playwright/test").Page, step: string): Promise<string> {
  const title = tag("[E2E] נוהל לאישור");
  // 25.10.2026: with an owner, the only thing between it and running is
  // the procedure waiting for approval.
  await newProcess(page, title);
  // 13.11.2026: what starts it is set in the rhythm editor, open on arrival.
  await fillRhythm(page, whenSomethingHappens("בקשת עובד"));
  await writeStep(page, step);
  await expect(page.getByTestId("process-draft")).toContainText("טיוטה 1 מחכה לאישור", { timeout: 15_000 });
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

  // 22.10.2026: decisions only, each with a recommendation. 1.11.2026: the
  // questions for a client left this screen for the client's page.
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

  test("the old addresses of the questions lead to the client's page, and the tab is gone", async ({ page }) => {
    await page.goto("/app/approvals?tab=review");
    await expect(page).toHaveURL(/\/app\/approvals$/, { timeout: 30_000 });
    await expect(page.getByRole("navigation", { name: "סוגי אישורים" }).getByRole("link", { name: /^שאלות ללקוח/ })).toHaveCount(0);
    await page.goto(`/app/approvals?tab=questions&clientId=${CLIENT}&scope=all`);
    await expect(page).toHaveURL(new RegExp(`/app/clients/${CLIENT}\\?tab=file#client-questions`), { timeout: 30_000 });
  });

  test("an uncertain item is a question only once asked about, and a line can be put off", async ({ page }) => {
    const title = tag("[E2E] סוג פנייה לשאלה");
    await page.goto(`/app/clients/${CLIENT}?tab=file&section=all`);
    await page.getByRole("button", { name: "+ סוג פנייה", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('input[name="title"]').fill(title);
    await dialog.locator('textarea[name="handling"]').fill("עונים במייל");
    await dialog.locator('select[name="knowledgeStatus"]').selectOption("MISSING");
    await dialog.locator('input[name="toResolve"]').fill("לברר עם המנכ״ל מי עונה");
    await submit(page, "הוספה לתיק");

    // Not on a card by itself: in the list of uncertain items, one press away.
    const section = page.getByTestId("client-questions");
    await expect(section.getByTestId("question-item").filter({ hasText: title })).toHaveCount(0);
    const list = section.getByTestId("uncertain-items");
    await list.locator("summary").click();
    const uncertain = list.getByTestId("uncertain-item").filter({ hasText: title });
    const asked = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await uncertain.getByRole("button", { name: "לשאול את הלקוח" }).click();
    await asked;
    await page.reload();

    const card = page.getByTestId("question-card").filter({ hasText: title }).first();
    await expect(card, "the item is not on a card").toBeVisible({ timeout: 30_000 });
    const line = card.getByTestId("question-item").filter({ hasText: title });
    await expect(line).toContainText("לברר עם המנכ״ל מי עונה");
    await card.getByTestId("question-draft-toggle").click();
    const draft = card.getByTestId("question-draft").locator("textarea");
    await expect(draft).toHaveValue(/^היי/);
    await expect(draft).toHaveValue(new RegExp("לברר עם המנכ״ל מי עונה"));

    // "לדחות עד": off the card until the date, and said so under it.
    await line.getByRole("button", { name: "לדחות עד..." }).click();
    const ahead = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    await line.getByTestId("question-snooze").locator('input[type="date"]').fill(ahead);
    const snoozed = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await line.getByRole("button", { name: "דחייה" }).click();
    await snoozed;
    await page.reload();
    await expect(page.getByTestId("question-item").filter({ hasText: title })).toHaveCount(0);
    await expect(page.getByTestId("question-snoozed").filter({ hasText: title.slice(0, 40) }).first()).toBeVisible();

    // Clean up: the request type goes, and its question with it.
    await page.goto(`/app/clients/${CLIENT}?tab=file`);
    const row = page.locator("li", { hasText: title }).first();
    const removed = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await row.getByRole("button", { name: "הסרה" }).click();
    await removed;
  });

  // 13.11.2026 (stage 2): the card's "next step" became the list's "צריך
  // טיפול" and the draft's box on the process page.
  test("a draft waiting for approval is on the list's attention band, and approved on the process page", async ({ page }) => {
    const step = tag("אוספים טופס");
    const title = await draftProcedure(page, step);
    const href = new URL(page.url()).pathname;
    await page.goto(`/app/clients/${CLIENT}?tab=file&section=processes`);
    const line = page.getByTestId("process-attention").locator("div", { hasText: title }).last();
    await expect(line).toContainText("טיוטה 1 של הנוהל מחכה לאישור", { timeout: 15_000 });
    await line.getByRole("link", { name: "לאישור" }).click();
    await expect(page).toHaveURL(new RegExp(`${href}$`), { timeout: 15_000 });
    await approveDraft(page);
    await expect(page.getByText(step).first()).toBeVisible();
    await page.goto(`/app/clients/${CLIENT}?tab=file&section=processes`);
    await expect(page.getByTestId("process-list")).toContainText(title);
    await expect(page.locator('[data-testid="process-attention"]', { hasText: title })).toHaveCount(0);
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

    // The link lands on the process's own page (13.11.2026, stage 2).
    await row.getByRole("link", { name: title }).click();
    await expect(page).toHaveURL(/\/processes\/[^/?]+\?fromApprovals=/, { timeout: 30_000 });
    await expect(page.getByTestId("process-page")).toContainText(title, { timeout: 20_000 });

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
