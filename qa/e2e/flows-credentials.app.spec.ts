import { test, expect } from "./fixtures";

// Credentials vault, in a real browser, as the seeded ANKORA_ADMIN
// (the .app session; see auth.setup.ts). The spec this proves is in the
// project: claude/credentials-vault-spec-2026-10-06.md.
//
// The single most important assertion is the second one: after saving, the
// password is nowhere in the page the server sent. The list is built from a
// projection with no secret column in it, and this is what checks that a
// future edit to the screen did not quietly undo that.
//
// @covers screen:/app/credentials
// @covers action:(product)/app/(authenticated)/credentials/actions
// @covers api:/api/credentials/[id]/reveal
// @covers api:/api/step-up

test.describe.configure({ timeout: 90_000 });

const OWN_PASSWORD = "DemoPass!2026";

function tag(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

test("add, stays hidden, reveal after identity check, edit without seeing, delete", async ({ page }) => {
  const system = tag("[E2E] מערכת");
  const secret = tag("Sentinel-Pass");

  await page.goto("/app/credentials");
  await page.getByRole("button", { name: "גישה חדשה", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[name="systemName"]').fill(system);
  await dialog.locator('input[name="url"]').fill("example.com/login");
  await dialog.locator('input[name="username"]').fill("e2e-user");
  await dialog.locator('input[name="password"]').fill(secret);
  await dialog.getByRole("button", { name: "הוספת הגישה" }).click();

  const row = page.locator("[data-credential-row]", { hasText: system });
  await expect(row).toBeVisible({ timeout: 30_000 });

  // Not in the HTML, not in the RSC payload, after a fresh load.
  await page.reload();
  await expect(row).toBeVisible();
  expect(await page.content()).not.toContain(secret);

  // Reveal: asks who you are first.
  await row.getByRole("button", { name: "הצגת פרטי גישה" }).click();
  await row.getByLabel("הסיסמה שלך לאנקורה").fill("definitely-wrong");
  await row.getByRole("button", { name: "אימות" }).click();
  await expect(row.getByText("הסיסמה שגויה.")).toBeVisible();
  await row.getByLabel("הסיסמה שלך לאנקורה").fill(OWN_PASSWORD);
  await row.getByRole("button", { name: "אימות" }).click();
  await expect(row.getByText(secret)).toBeVisible();
  await expect(row.getByText("הצפייה נרשמה.")).toBeVisible();

  // Hide, then reveal again inside the window: no second password prompt.
  await row.getByRole("button", { name: "להסתיר עכשיו" }).click();
  await expect(row.getByText(secret)).toHaveCount(0);
  await row.getByRole("button", { name: "הצגת פרטי גישה" }).click();
  await expect(row.getByText(secret)).toBeVisible();
  await row.getByRole("button", { name: "להסתיר עכשיו" }).click();

  // Edit: the form does not carry the stored values.
  await row.getByRole("button", { name: "עריכה" }).click();
  const edit = page.getByRole("dialog");
  await expect(edit.locator('input[name="password"]')).toHaveValue("");
  expect(await edit.innerHTML()).not.toContain(secret);
  await edit.locator('input[name="systemName"]').fill(`${system} (עודכן)`);
  await edit.getByRole("button", { name: "שמירת השינויים" }).click();
  const renamed = page.locator("[data-credential-row]", { hasText: `${system} (עודכן)` });
  await expect(renamed).toBeVisible({ timeout: 30_000 });

  // Delete: two steps, and the row goes.
  await renamed.getByRole("button", { name: "מחיקה" }).click();
  await renamed.getByRole("button", { name: "למחוק" }).click();
  await expect(page.locator("[data-credential-row]", { hasText: system })).toHaveCount(0, { timeout: 30_000 });
});

test("the reveal route refuses a cross-site style request", async ({ page }) => {
  await page.goto("/app/credentials");
  const status = await page.evaluate(async () => {
    const res = await fetch("/api/credentials/anything/reveal", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "{}",
    });
    return res.status;
  });
  expect(status).toBe(400);
});
