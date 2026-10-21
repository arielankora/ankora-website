import { test, expect } from "./fixtures";

// Org brain, phase 2 (14.10.2026): "ממתין לאישור", submitted for real.
// Since 20.10.2026 it is the tab "ידע מהחילוץ" of "אישורים"; the old
// address redirects there, which these tests go through on purpose.
// The Preview seed puts six demo proposals back to pending on every build
// (see the seed's own comment); this file edits and approves one and
// rejects another, whichever are still pending, so a retry still has two.
// Same prose rule as flows-admin: modules are named in words here, never
// by path.
//
// @covers action:(product)/app/(authenticated)/knowledge/actions
// @covers screen:/app/knowledge
// @covers screen:/app/approvals
// @covers screen:/app/brain-metrics

test.describe.configure({ timeout: 90_000 });

const CLIENT = "demo-client-b";

test.describe("knowledge/actions", () => {
  test("a proposal edited and approved enters the file; a rejected one does not", async ({ page }) => {
    await page.goto(`/app/knowledge?clientId=${CLIENT}`);
    await expect(page.getByRole("heading", { level: 1, name: "אישורים" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "סוגי אישורים" }).getByRole("link", { name: /^ידע מהחילוץ/ })).toHaveAttribute("aria-current", "page");
    const pending = page.locator("li", { hasText: "[DEMO] הצעה" }).filter({ has: page.getByRole("button", { name: "אישור", exact: true }) });
    expect(await pending.count(), "the Preview seed should leave demo proposals pending").toBeGreaterThanOrEqual(2);

    const edited = `[E2E] אושר ${Date.now().toString(36)}`;
    await pending.first().getByRole("button", { name: "עריכה ואישור" }).click();
    let dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('textarea[name="body"]').fill(edited);
    let written = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await dialog.getByRole("button", { name: "אישור עם השינויים" }).click();
    await written;

    await page.reload();
    const target = page.locator("li", { hasText: "[DEMO] הצעה" }).filter({ has: page.getByRole("button", { name: "אישור", exact: true }) }).first();
    const headline = (await target.locator("p").nth(1).innerText()).trim();
    await target.getByRole("button", { name: "דחייה" }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('input[name="reason"]').fill("[E2E] לא רלוונטי");
    written = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await dialog.getByRole("button", { name: "דחייה" }).click();
    await written;

    await page.reload();
    await expect(page.locator("li", { hasText: `נדחה: ${headline}` }).first()).toBeVisible({ timeout: 15_000 });

    // The approved one is in the client's file, with its source.
    await page.goto(`/app/clients/${CLIENT}/client-file`);
    await expect(page.getByText(edited).first(), "the approved proposal did not reach the file").toBeVisible({ timeout: 15_000 });
  });

  // 20.10.2026: the bulk reject drawer opened clipped inside the sticky
  // selection bar (a backdrop filter there trapped its fixed position),
  // so the reason field was out of reach. Opened and dismissed, nothing
  // written, so the seed's pending proposals are left for the test above.
  test("rejecting several at once opens a full drawer with the reason field", async ({ page }) => {
    await page.goto(`/app/knowledge?clientId=${CLIENT}`);
    const batch = page.locator("section", { hasText: "[DEMO] הצעות לדוגמה" }).first();
    const all = batch.getByRole("checkbox", { name: /^הכול/ });
    test.skip((await all.count()) === 0, "fewer than two demo proposals still pending");
    await all.check();
    await batch.getByRole("button", { name: /^דחיית \d+$/ }).click();
    const dialog = page.getByRole("dialog", { name: "דחיית הצעות" });
    const reason = dialog.locator('input[name="reason"]');
    await expect(reason).toBeVisible();
    await expect(reason).toBeInViewport();
    await expect(dialog.getByRole("button", { name: "דחייה", exact: true })).toBeInViewport();
    const box = await dialog.locator("div.absolute.inset-y-0").boundingBox();
    expect(box?.height ?? 0, "the drawer should be as tall as the viewport, not the selection bar").toBeGreaterThan(300);
    await dialog.getByRole("button", { name: "סגירה" }).last().click();
    await expect(dialog).toHaveCount(0);
  });

  // Filters (claude/knowledge-review-filters-spec-2026-10-17.md). The demo
  // proposals are all notes, so a kind chip narrows to them, a narrowing
  // filter hides decided rows, and a select change lands in the URL.
  test("filters live in the URL and narrow to what matches", async ({ page }) => {
    await page.goto(`/app/knowledge?clientId=${CLIENT}&kind=FACT.NOTE`);
    const filters = page.getByRole("form", { name: "סינון הצעות" });
    await expect(filters.getByRole("link", { name: /^הערה/ })).toHaveAttribute("aria-current", "true");
    await expect(page.locator("li", { hasText: "[DEMO] הצעה" }).first()).toBeVisible();
    await expect(page.locator("li", { hasText: /^(אושר|נדחה): / }), "decided rows show only when nothing narrows the items").toHaveCount(0);

    await filters.getByText("עוד סינונים").click();
    await filters.getByRole("combobox", { name: "ממתין" }).selectOption("7");
    await expect(page).toHaveURL(/age=7/, { timeout: 30_000 });
    await expect(page).toHaveURL(/kind=FACT\.NOTE/);

    await filters.getByRole("link", { name: "ניקוי הסינון" }).click();
    await expect(page).toHaveURL(/\/app\/approvals\?tab=knowledge$/, { timeout: 30_000 });
  });

  test("the client's file tab shows what waits for it, with the same actions", async ({ page }) => {
    await page.goto(`/app/clients/${CLIENT}?tab=file`);
    const section = page.getByTestId("client-pending-proposals");
    await expect(section).toBeVisible({ timeout: 30_000 });
    await expect(section.getByRole("heading", { name: "ממתין לאישור" })).toBeVisible();
    const row = section.locator("li", { hasText: "[DEMO] הצעה" }).first();
    await expect(row.getByRole("button", { name: "אישור", exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "למשימה" })).toBeVisible();
  });

  test("turning a proposal into a task asks what to do and fills in by when", async ({ page }) => {
    await page.goto(`/app/clients/${CLIENT}?tab=file`);
    const section = page.getByTestId("client-pending-proposals");
    await expect(section).toBeVisible({ timeout: 30_000 });
    const row = section.locator("li", { hasText: "[DEMO] הצעה" }).first();
    await row.getByRole("button", { name: "למשימה" }).click();
    const form = page.getByTestId("proposal-task-form");
    await expect(form).toBeVisible();
    await expect(form.getByText("מה עושים? כותרת המשימה")).toBeVisible();
    await expect(form.locator('input[name="dueDate"]')).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
    await expect(form.getByText("הקטגוריה נבחרת לפי הכותרת")).toBeVisible();
  });

  test("a manager reads the measures of every client's file", async ({ page }) => {
    await page.goto("/app/brain-metrics");
    await expect(page.getByRole("heading", { level: 1, name: "מדדי התיק" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("metrics-all").getByText("שלמות תהליכים")).toBeVisible();
    await expect(page.getByTestId("metrics-clients")).toBeVisible();
  });
});
