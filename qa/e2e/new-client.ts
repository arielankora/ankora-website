import { expect, type Page } from "@playwright/test";

// New-client wizard (26.11.2026): creating a client is four steps and an
// activation now, not one drawer. Specs that need an active client of
// their own go through here, so the wizard is exercised on every run.
//
// Each write waits for its own POST before the next step, for the reason
// the old drawer specs gave: a navigation issued while a Server Action is
// in flight aborts it, and the next screen honestly does not have the row.

async function submit(page: Page, button: ReturnType<Page["getByRole"]>) {
  const written = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
  await button.click();
  await written;
}

/// Step 1 only: a client left in setup. Returns its id.
export async function startClientSetup(page: Page, name: string): Promise<string> {
  await page.goto("/app/clients/new");
  await page.locator("#setup-name").fill(name);
  await page.locator('input[name="aiExcluded"][value="false"]').check();
  await page.getByRole("button", { name: "יצירה והמשך לשיוך" }).click();
  await page.waitForURL(/\/app\/clients\/[^/]+\/setup\?step=2/, { timeout: 30_000 });
  const id = new URL(page.url()).pathname.split("/")[3];
  expect(id, "the setup did not open on a client").toBeTruthy();
  return id;
}

/// The whole wizard, through activation. Returns the client's id.
export async function createActiveClient(page: Page, name: string): Promise<string> {
  const id = await startClientSetup(page, name);
  const slug = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

  // Step 2: a domain and the channel.
  await page.locator("#setup-domain").fill(`e2e-${slug}.co.il`);
  await submit(page, page.getByRole("button", { name: "הוספה", exact: true }));
  await expect(page.getByText(`e2e-${slug}.co.il`)).toBeVisible({ timeout: 15_000 });
  await page.locator('input[name="preferredChannel"][value="EMAIL"]').check();
  await submit(page, page.getByRole("button", { name: "שמירה", exact: true }));

  // Step 3: one contact with an email.
  await page.goto(`/app/clients/${id}/setup?step=3`);
  await page.locator("#contact-new-name").fill("איש קשר לבדיקה");
  await page.locator("#contact-new-email").fill(`contact@e2e-${slug}.co.il`);
  await submit(page, page.getByRole("button", { name: "הוספת איש קשר" }));

  // Step 4: no rules of its own, and a team of two different people.
  await page.goto(`/app/clients/${id}/setup?step=4`);
  await submit(page, page.getByRole("checkbox", { name: "אין ללקוח כללים מיוחדים" }));
  const manager = page.locator("#setup-manager");
  const backup = page.locator("#setup-backup");
  await manager.selectOption({ index: 1 });
  await backup.selectOption({ index: 2 });
  await submit(page, page.getByRole("button", { name: "שמירה", exact: true }));

  // Summary and activation.
  await page.goto(`/app/clients/${id}/setup?step=summary`);
  await page.getByRole("button", { name: "הפעלת הלקוח" }).click();
  await page.waitForURL(new RegExp(`/app/clients/${id}(\\?|$)`), { timeout: 30_000 });
  return id;
}
