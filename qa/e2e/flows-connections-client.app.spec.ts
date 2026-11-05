import { test, expect } from "./fixtures";

// 4.11.2026 (task cmvtivumj000pjs08q9qj4t67, ADR 0001 section 24): a
// client's connections screen, as the seeded admin. A mailbox connected by
// app password shows up with who handed it over, and a disconnect removes
// it. The Google round trip needs a real OAuth client and is not run here.
//
// @covers action:(product)/app/(authenticated)/clients/[clientId]/connections/actions
// @covers screen:/app/clients/[clientId]/connections

test.describe.configure({ timeout: 120_000 });

const CLIENT = "demo-client-b";

test("a mailbox connected by app password appears, and a disconnect removes it", async ({ page }) => {
  const account = `e2e-${Date.now().toString(36)}@example.com`;
  await page.goto(`/app/clients/${CLIENT}/connections`);
  await expect(page.getByTestId("connections-screen")).toBeVisible();

  await page.getByText("שם משתמש וסיסמת אפליקציה").click();
  await page.getByLabel("כתובת המייל").fill(account);
  await page.getByLabel("סיסמת אפליקציה").fill("abcd efgh ijkl mnop");
  await page.getByLabel("מי אצל הלקוח מסר את הגישה, ומתי").fill("[E2E] איש קשר, 4.11.2026");
  await page.getByRole("button", { name: "שמירת החיבור" }).click();
  await expect(page.getByText("החיבור נשמר. הסיסמה בכספת.")).toBeVisible({ timeout: 15_000 });

  await page.reload();
  const card = page.getByTestId("connection-card").filter({ hasText: account });
  await expect(card).toBeVisible();
  await expect(card).toContainText("[E2E] איש קשר");
  await expect(card).not.toContainText("abcd");

  await card.getByRole("button", { name: "ניתוק", exact: true }).click();
  await card.getByTestId("disconnect-confirm").getByRole("button", { name: "כן, לנתק" }).click();
  await expect(page.getByText("החיבור נותק")).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(page.getByTestId("connection-card").filter({ hasText: account })).toHaveCount(0);
});
