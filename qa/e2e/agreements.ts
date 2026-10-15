import { expect, type Page } from "@playwright/test";

/// Every staff account meets the confidentiality gate on its first visit
/// to /app (employee agreements, 15.10.2026), and the seeded demo accounts
/// are no exception. Each session that signs in as staff passes through
/// here once, which is also the end-to-end proof that the gate lets a
/// person through after signing.
///
/// Goes to the sign page directly rather than waiting to be sent there:
/// someone who already signed is redirected straight back to /app, so the
/// helper is safe to call on every run against a database that persists
/// between them.
///
/// `base` is for the one spec that signs in against an explicit origin
/// (flows-passkeys) instead of the configured baseURL.
export async function signConfidentialityIfAsked(page: Page, name: string, base = "") {
  await page.goto(`${base}/app/agreements/confidentiality`);
  await page.waitForLoadState("networkidle");
  if (!new URL(page.url()).pathname.startsWith("/app/agreements/confidentiality")) return;

  await page.getByLabel("קראתי את ההתחייבות ואני מסכים/ה לה").check();
  await page.locator('input[name="signedName"]').fill(name);
  await page.getByRole("button", { name: "אישור וחתימה" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/app/agreements"), { timeout: 30_000 });
  await expect(page).not.toHaveURL(/\/login/);
}
