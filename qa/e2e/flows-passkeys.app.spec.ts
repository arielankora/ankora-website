import { test, expect } from "./fixtures";

// Vault phase 1a: Touch ID for "verify it's you", in a real browser.
// Chromium's virtual authenticator (DevTools protocol, WebAuthn domain)
// stands in for the fingerprint reader: same browser API, same signatures,
// same server verification, no hardware.
//
// Two details that are the whole difficulty of this file:
//
//   * A WebAuthn relying party must be a domain. 127.0.0.1, where the rest
//     of the suite runs, is refused by the browser itself. This test signs
//     in on http://localhost:3100 instead, in a fresh context.
//   * It runs as demo.employee1, not as the admin the other .app specs
//     use, so its identity checks cannot push the admin into the step-up
//     lockout that flows-credentials.app.spec.ts relies on not hitting.
//
// @covers api:/api/passkeys/register/options
// @covers api:/api/passkeys/register/verify
// @covers api:/api/step-up/passkey/options
// @covers api:/api/step-up/passkey/verify

test.describe.configure({ timeout: 120_000 });
test.use({ storageState: { cookies: [], origins: [] } });

const ORIGIN = `http://localhost:${process.env.QA_PORT ?? 3100}`;
const EMPLOYEE = { identifier: "demo.employee1@ankora.co.il", password: "DemoPass!2026" };

function tag(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

test("enrol Touch ID, then reveal a credential with it", async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  // Sign in on localhost. Auth.js redirects to its configured host
  // (AUTH_URL, 127.0.0.1 in CI), where this context has no cookie and
  // lands back on a login screen. The cookie it set is on localhost, which
  // is all that matters, so the test waits for it and goes back there.
  await page.goto(`${ORIGIN}/app/login`);
  await page.fill('input[name="identifier"]', EMPLOYEE.identifier);
  await page.fill('input[name="password"]', EMPLOYEE.password);
  await page.click('button[type="submit"]');
  await expect
    .poll(async () => (await page.context().cookies(ORIGIN)).some((c) => /session-token/.test(c.name)), { timeout: 30_000 })
    .toBe(true);

  // Enrol.
  const deviceName = tag("E2E Mac");
  await page.goto(`${ORIGIN}/app/profile`);
  await expect(page).not.toHaveURL(/\/login/);
  const card = page.locator("#passkeys");
  await card.getByRole("button", { name: "הוספת passkey" }).click();
  await card.locator('input[name="name"]').fill(deviceName);
  await card.locator('input[name="password"]').fill(EMPLOYEE.password);
  await card.getByRole("button", { name: "המשך ל-Touch ID" }).click();
  await expect(card.getByText(deviceName)).toBeVisible({ timeout: 30_000 });

  // A credential on the employee's own client, then a reveal through the
  // passkey and not the password.
  const system = tag("[E2E] passkey");
  const secret = tag("Passkey-Sentinel");
  await page.goto(`${ORIGIN}/app/credentials`);
  await page.getByRole("button", { name: "גישה חדשה", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[name="systemName"]').fill(system);
  await dialog.locator('input[name="password"]').fill(secret);
  await dialog.getByRole("button", { name: "הוספת הגישה" }).click();
  const row = page.locator("[data-credential-row]", { hasText: system });
  await expect(row).toBeVisible({ timeout: 30_000 });

  await row.getByRole("button", { name: "הצגת פרטי גישה" }).click();
  await row.getByRole("button", { name: "אימות עם Touch ID" }).click();
  await expect(row.getByText(secret)).toBeVisible({ timeout: 30_000 });

  // Clean up: the credential, then the passkey.
  await row.getByRole("button", { name: "מחיקה" }).click();
  await row.getByRole("button", { name: "למחוק" }).click();
  await page.goto(`${ORIGIN}/app/profile`);
  await card.locator("li", { hasText: deviceName }).getByRole("button", { name: "הסרה" }).click();
  await expect(card.getByText(deviceName)).toHaveCount(0, { timeout: 30_000 });
});
