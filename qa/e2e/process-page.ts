import { expect, type Page } from "@playwright/test";

/// 13.11.2026 (processes redesign, stage 2): a process is added from the
/// list in a small window (name, purpose, owner and a source), and opens on
/// its own page with the rhythm editor open. Shared by the specs that need a
/// process of their own on the demo client.

export const CLIENT = "demo-client-b";

export function tag(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/// Submits the open window, waits for the write, and reloads.
export async function submit(page: Page, button: string) {
  const written = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400, { timeout: 30_000 });
  await page.getByRole("dialog").getByRole("button", { name: button }).click({ timeout: 15_000 });
  await written;
  await page.reload();
}

/// A source in the client's file, and its code.
export async function addSource(page: Page): Promise<string> {
  const title = tag("[E2E] מקור");
  await page.getByRole("button", { name: "+ מקור", exact: true }).click({ timeout: 15_000 });
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.locator('input[name="title"]').fill(title);
  await submit(page, "הוספה למרשם");
  const row = page.locator("li", { hasText: title });
  await expect(row.first(), "the source was not added").toBeVisible({ timeout: 15_000 });
  return (await row.first().locator("span.font-mono").innerText({ timeout: 15_000 })).trim();
}

/// Adds a process from the list and lands on its page, the rhythm editor
/// open. Owned by the seeded admin unless `owner` is false. Its address.
export async function newProcess(page: Page, title: string, opts: { owner?: boolean; purpose?: string } = {}): Promise<string> {
  await page.goto(`/app/clients/${CLIENT}?tab=file&section=all`);
  const code = await addSource(page);
  await page.getByTestId("process-list").getByRole("button", { name: "+ תהליך חדש", exact: true }).click({ timeout: 15_000 });
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.locator('input[name="title"]').fill(title);
  if (opts.purpose) await dialog.locator('input[name="purpose"]').fill(opts.purpose);
  if (opts.owner !== false) {
    const owner = dialog.locator('select[name="ownerId"] option', { hasText: "מנהל Ankora" }).first();
    await dialog.locator('select[name="ownerId"]').selectOption((await owner.getAttribute("value"))!);
  }
  await dialog.locator('input[name="sources"]').fill(code);
  await dialog.getByRole("button", { name: "הוספה לתיק" }).click();
  await expect(page).toHaveURL(/\/processes\/[^/?#]+(\?|$)/, { timeout: 30_000 });
  await expect(page.getByTestId("process-page")).toContainText(title, { timeout: 15_000 });
  return new URL(page.url()).pathname;
}

/// Writes one step in the steps editor (stage 3: a page of its own) of the
/// open process page, saves a draft, and is back on the process page.
export async function writeStep(page: Page, step: string) {
  await page.getByTestId("process-edit-steps").click({ timeout: 15_000 });
  await expect(page.getByTestId("steps-editor")).toBeVisible({ timeout: 15_000 });
  if (await page.getByTestId("steps-empty").count()) await page.getByTestId("steps-empty").getByRole("button", { name: "+ שלב" }).click();
  await page.getByLabel("שלב 1: מה עושים").fill(step, { timeout: 15_000 });
  await saveDraft(page);
}

/// "שמירת טיוטה" in the steps editor; back on the process page.
export async function saveDraft(page: Page) {
  const from = page.url();
  await page.getByTestId("steps-save").click();
  await expect(page).not.toHaveURL(from, { timeout: 30_000 });
  await expect(page.getByTestId("process-page")).toBeVisible({ timeout: 15_000 });
}

/// Approves the draft waiting on the open process page. 14.11.2026: the
/// page is let settle first. A refresh still in flight from the move here
/// aborted the approval's write in CI (PR 503: "WHILE NAVIGATING"), and
/// the draft stayed. The success toast says the write landed.
export async function approveDraft(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.getByTestId("process-draft").getByRole("button", { name: "אישור הנוהל" }).click({ timeout: 15_000 });
  await expect(page.getByText("הנוהל אושר").first()).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.getByTestId("process-draft")).toHaveCount(0, { timeout: 15_000 });
}
