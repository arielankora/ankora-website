import { test, expect } from "./fixtures";

// Not imported from auth.setup.ts: importing that file would register its
// setup steps inside this spec. Same values as its DEMO.suspended.
const SUSPENDED = { email: "demo.suspended@ankora.co.il", name: "[DEMO] עובד מושהה" };

// Employee agreements (15.10.2026). The confidentiality gate itself is
// walked by auth.setup.ts for every staff session; this spec covers the
// rest: the sign page sends someone who already signed back to work, and
// a departing employee signs the deletion declaration through a one-time
// link without a session, once.
//
// Super-admin only, because the user's page is.
//
// @covers screen:/app/agreements/confidentiality
// @covers action:(product)/app/agreements/confidentiality/actions
// @covers screen:/agreements/sign/[token]
// @covers action:(product)/agreements/sign/[token]/actions
// @covers screen:/agreements/upload/[token]
// @covers action:(product)/app/(authenticated)/users/actions

test("someone who already signed is sent from the sign page back to work", async ({ page }) => {
  await page.goto("/app/agreements/confidentiality");
  await expect(page).toHaveURL(/\/app\/?$/);
});

test("a suspended employee signs the deletion declaration once through a link", async ({ page, browser }) => {
  // The suspended demo employee's page.
  await page.goto("/app/users");
  const row = page
    .locator("div", { hasText: SUSPENDED.email })
    .filter({ has: page.locator('a[href^="/app/users/"]') })
    .last();
  await row.locator('a[href^="/app/users/"]').click();
  await expect(page.getByText(SUSPENDED.email)).toBeVisible();

  // A private address is required before anything can be sent.
  const section = page.locator("div.rounded-2xl", { has: page.getByRole("heading", { name: "מסמכים חתומים" }) });
  await section.locator('input[name="personalEmail"]').fill("demo.suspended.private@example.com");
  await section.getByRole("button", { name: "שמירה" }).click();
  await expect(section.getByText("נשמר.")).toBeVisible({ timeout: 30_000 });

  // CI has no mail provider, so the screen falls back to showing the link.
  await page.reload();
  await section.getByRole("button", { name: "שליחת הצהרת מחיקה" }).click();
  const linkText = section.locator('p[dir="ltr"]', { hasText: "/agreements/sign/" });
  await expect(linkText).toBeVisible({ timeout: 30_000 });
  const path = new URL((await linkText.innerText()).trim()).pathname;

  // The person has no session.
  const outsider = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const signer = await outsider.newPage();
  try {
    await signer.goto(path);
    await expect(signer.getByRole("heading", { name: "הצהרת מחיקה והחזרת ציוד" })).toBeVisible();

    // A name that is not theirs is refused, in words.
    await signer.getByLabel("קראתי את ההצהרה, היא נכונה, ואני מאשר/ת אותה").check();
    await signer.locator('input[name="signedName"]').fill("מישהו אחר");
    await signer.getByRole("button", { name: "אישור וחתימה" }).click();
    // Next.js mounts its own empty role="alert" route announcer, so match the
    // form error by its text rather than by the role alone.
    await expect(signer.getByRole("alert").filter({ hasText: "אינו תואם" })).toBeVisible({ timeout: 30_000 });

    // Spacing and case are not a different name.
    await signer.locator('input[name="signedName"]').fill(`  ${SUSPENDED.name.replace(" ", "  ")} `);
    await signer.getByRole("button", { name: "אישור וחתימה" }).click();
    await expect(signer.getByText("ההצהרה נחתמה ונשמרה")).toBeVisible({ timeout: 30_000 });

    // Used once, then it says nothing about why it no longer opens.
    await signer.goto(path);
    await expect(signer.getByRole("heading", { name: "הקישור אינו זמין" })).toBeVisible();
  } finally {
    await outsider.close();
  }

  // And the signature is on the user's page.
  await page.reload();
  await expect(section.getByText("הצהרת מחיקה", { exact: false }).first()).toBeVisible();
  await expect(section.locator("li", { hasText: "מחיקה-1.0" }).first()).toBeVisible();
});

// The personal upload page for a signed PDF (16.10.2026). A link is issued
// only through the MCP tool and filing needs Drive, neither of which CI
// has, so the browser covers the page's refusal: an unknown token says
// nothing about why, and offers no form.
test("the upload page refuses an unknown link calmly, with no form", async ({ browser }) => {
  const outsider = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await outsider.newPage();
  try {
    const res = await page.goto("/agreements/upload/not-a-real-token");
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "הקישור אינו זמין" })).toBeVisible();
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
  } finally {
    await outsider.close();
  }
});
