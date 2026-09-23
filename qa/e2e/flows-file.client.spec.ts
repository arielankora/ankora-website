import { test, expect } from "./fixtures";

// Portal phase 3, the client's own file, driven as the client.
//
// The screen is four lists and one form, and the part worth a browser
// test is the form: it is the second and last thing a client ever writes
// in this product, and what they write changes how Ankora works for them.
// The lists are covered where the rules actually live, in the integration
// tests - a browser cannot prove that a sensitive date was excluded, only
// that it is not on the page, which is also true when the query is broken
// in the opposite direction.
//
// Serial, because both tests act on the same seeded client and the second
// reads what the first wrote.
//
// Prose warning, same as the other flow files: coverage is inferred from
// the TEXT of these files, and a Server Action inherits the module paths
// it imports. Refer to modules in words, never as paths.
//
// @covers action:(product)/app/(authenticated)/portal/file/actions

test.describe.configure({ mode: "serial", timeout: 90_000 });

const FILE = "/app/portal/file";

test("the file shows what was collected while working for this client", async ({ page }) => {
  await page.goto(FILE, { waitUntil: "domcontentloaded" });

  // Retrying locators throughout: domcontentloaded returns before a
  // server component's content is painted, and a one-shot read here
  // reports the app shell as a missing screen.
  await expect(page.getByText("התיק של", { exact: false }).first()).toBeVisible({ timeout: 30_000 });

  await expect(page.getByText("[DEMO] חשמלאי כהן", { exact: false }), "the seeded supplier is not in the file").toBeVisible();
  await expect(page.getByText("[DEMO] חידוש ביטוח המשרד", { exact: false }), "the seeded recurring date is not in the file").toBeVisible();
  await expect(page.getByText("מומלץ", { exact: false }).first()).toBeVisible();
});

test("a client admin rewrites their own preferences", async ({ page }) => {
  await page.goto(FILE, { waitUntil: "domcontentloaded" });

  const contact = page.locator('textarea[name="contact"]');
  await expect(contact, "the preferences form is not on the screen").toBeVisible({ timeout: 30_000 });

  const written = `[E2E] וואטסאפ בלבד ${Date.now().toString(36)}`;
  await contact.fill(written);
  await page.getByRole("button", { name: "שמירה" }).click();

  // The form reports what the server said about the save - it does not
  // wait for the screen behind it to redraw - so this is the signal.
  await expect(page.getByText("נשמר", { exact: false }).first(), "the form never confirmed the save").toBeVisible({
    timeout: 30_000,
  });

  await page.reload();
  await expect(page.locator('textarea[name="contact"]'), "the preference did not survive a reload").toHaveValue(written);
});
