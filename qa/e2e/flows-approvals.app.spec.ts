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

  test("the things to check have a tab of their own, without approve buttons", async ({ page }) => {
    await page.goto("/app/approvals?tab=review");
    await expect(page.getByRole("navigation", { name: "סוגי אישורים" }).getByRole("link", { name: /^לבדיקה/ })).toHaveAttribute("aria-current", "page");
    const list = page.getByTestId("review-list");
    if ((await list.count()) > 0) await expect(list.getByRole("button")).toHaveCount(0);
    else await expect(page.getByText("אין כרגע פריטים לבדיקה.")).toBeVisible();
  });

  test("the client's page leads to its approvals", async ({ page }) => {
    await page.goto(`/app/clients/${CLIENT}`);
    const link = page.getByTestId("client-approvals-link");
    await expect(link).toBeVisible({ timeout: 30_000 });
    await expect(link).toHaveAttribute("href", `/app/approvals?clientId=${CLIENT}`);
  });
});
