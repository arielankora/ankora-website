import { test, expect } from "./fixtures";
import { fillRhythm, onceInThePast, ongoing, whenSomethingHappens } from "./rhythm";
import { approveDraft, CLIENT, newProcess, saveDraft, submit, tag, writeStep } from "./process-page";

// Org brain, phase 1 (16.10.2026): a process and its procedure on the
// client screen, submitted for real, as the seeded admin. Same prose rule
// as flows-admin: modules are named in words here, never by path.
//
// @covers action:(product)/app/(authenticated)/clients/process-actions
// @covers screen:/app/clients/[clientId]/processes/[processId]

test.describe.configure({ timeout: 120_000 });

test.describe("clients/process-actions", () => {
  // 31.10.2026: the file shows one part at a time, and the part last
  // opened comes back; "הכול" is the long view as it was.
  test("the client file opens one part at a time and remembers it", async ({ page }) => {
    await page.goto(`/app/clients/${CLIENT}?tab=file`);
    await expect(page.getByTestId("file-part")).toHaveAttribute("data-part", "all");
    const nav = page.getByTestId("file-parts-nav");
    await nav.getByRole("link", { name: /תהליכים ונהלים/ }).click();
    await expect(page).toHaveURL(/section=processes/, { timeout: 15_000 });
    await expect(page.locator("#processes")).toBeVisible();
    await expect(page.locator("#rules")).toHaveCount(0);

    await page.goto(`/app/clients/${CLIENT}?tab=file`);
    await expect(page.getByTestId("file-part")).toHaveAttribute("data-part", "processes");

    await page.getByTestId("file-parts-nav").getByRole("link", { name: "הכול", exact: true }).click();
    await expect(page.getByTestId("file-part")).toHaveAttribute("data-part", "all", { timeout: 15_000 });
    await expect(page.locator("#rules")).toBeVisible();
  });

  test("a procedure that automates a payment is held back; fixed, a manager approves it", async ({ page }) => {
    const title = tag("[E2E] תהליך");
    const href = await newProcess(page, title);
    // 13.11.2026: what starts it is set in the rhythm editor, open on arrival.
    await fillRhythm(page, whenSomethingHappens("בקשת עובד"));
    await expect(page.getByTestId("process-when")).toContainText("כשמשהו קורה: בקשת עובד");
    // Only what stops a run is said on top, in one line.
    await expect(page.getByTestId("process-blocker")).toHaveText("לא ירוץ: אין נוהל מאושר");

    // 14.11.2026 (stage 3): the steps editor is a page of its own.
    await page.getByTestId("process-edit-steps").click();
    await expect(page.getByTestId("steps-editor")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("steps-empty").getByRole("button", { name: "+ שלב" }).click();
    await page.getByLabel("שלב 1: מה עושים").fill("מעבירים תשלום לספק");
    await page.getByRole("radiogroup", { name: "שלב 1: איך" }).getByRole("radio", { name: "אוטומטי" }).click();
    await page.getByRole("group", { name: "סוג הפעולה" }).getByRole("button", { name: "תשלום", exact: true }).click();
    await saveDraft(page);

    const draft = page.getByTestId("process-draft");
    await expect(draft).toContainText("טיוטה 1 מחכה לאישור", { timeout: 15_000 });
    await expect(draft).toContainText("לא נעשה אוטומטית");
    await expect(draft.getByRole("button", { name: "אישור הנוהל" })).toHaveCount(0);

    await page.getByTestId("process-edit-steps").click();
    await expect(page.getByTestId("steps-editor")).toBeVisible({ timeout: 15_000 });
    // 28.10.2026: the editor says what holds the approval, and where.
    await expect(page.getByTestId("procedure-issues")).toContainText("לא נעשה אוטומטית");
    await expect(page.getByTestId("procedure-issues")).toContainText("איך אדם מוודא שזה קרה");
    await expect(page.getByLabel("שלב 1: איך יודעים שבוצע")).toHaveAttribute("aria-invalid", "true");
    await page.getByRole("radiogroup", { name: "שלב 1: איך" }).getByRole("radio", { name: "ידני" }).click();
    await expect(page.getByTestId("procedure-issues")).toHaveCount(0);
    await expect(page.getByTestId("steps-passed")).toBeVisible();
    await saveDraft(page);
    await expect(draft).toContainText("טיוטה 2 מחכה לאישור", { timeout: 15_000 });

    await approveDraft(page);
    await expect(page.getByTestId("process-page")).toContainText("גרסה 2", { timeout: 15_000 });
    await expect(page.getByTestId("process-draft")).toHaveCount(0);
    await expect(page.getByTestId("process-blocker")).toHaveCount(0);
    await expect(page.getByText("מעבירים תשלום לספק").first()).toBeVisible();

    // The list: one row for it, its rhythm in words, and its page from the name.
    await page.goto(`/app/clients/${CLIENT}?tab=file&section=processes`);
    const row = page.getByTestId("process-list").locator("tr", { hasText: title });
    await expect(row).toContainText("כשמשהו קורה: בקשת עובד");
    await expect(row).toContainText("פעיל");
    await row.getByRole("link", { name: title }).click();
    await expect(page).toHaveURL(new RegExp(`${href}$`), { timeout: 15_000 });

    // An event happened: a run opens as a task, and the page links to it.
    await page.getByRole("button", { name: "הרצה עכשיו" }).click();
    const start = page.getByRole("dialog");
    await expect(start).toBeVisible();
    const today = new Date().toISOString().slice(0, 10);
    await start.locator('input[name="day"]').fill(today);
    await submit(page, "פתיחת הריצה");
    await expect(page.getByTestId("process-tab-runs")).toHaveText("ריצות 1", { timeout: 15_000 });
    await page.getByTestId("process-open-run").getByRole("link", { name: "לריצה" }).click();
    await expect(page).toHaveURL(/\/app\/tasks\//, { timeout: 15_000 });
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("מעבירים תשלום לספק").first()).toBeVisible();
  });

  test("an approved process that runs by a date, with none ahead, says no run will open", async ({ page }) => {
    const title = tag("[E2E] תשלומי ספקים");
    await newProcess(page, title);
    // 13.11.2026: by a date that has passed, so nothing is ahead.
    await fillRhythm(page, onceInThePast);
    // A draft does not run anyway: no run is said to be stopped yet.
    await expect(page.getByTestId("process-blocker")).not.toContainText("לא ירוץ: תהליך לפי מועד");

    await writeStep(page, "מכינים את קובץ התשלומים");
    await approveDraft(page);

    // It is what stops work, so it is the one line on top.
    await expect(page.getByTestId("process-blocker")).toHaveText("לא ירוץ: תהליך לפי מועד בלי מועד", { timeout: 15_000 });
    // And the list puts it under "צריך טיפול", with the way to the process.
    await page.goto(`/app/clients/${CLIENT}?tab=file&section=processes`);
    const attention = page.getByTestId("process-attention").locator("div", { hasText: title }).last();
    await expect(attention).toContainText("לא ירוץ: תהליך לפי מועד בלי מועד");
    await expect(attention.getByRole("link", { name: "לתהליך" })).toBeVisible();
  });

  test("an ongoing process is in its owner's routine; a check that finds an issue opens a task", async ({ page }) => {
    const title = tag("[E2E] שוטף");
    // The seeded admin owns it, so it lands in this session's routine.
    await newProcess(page, title);
    // 13.11.2026: ongoing, and how often it is checked, in the rhythm editor.
    await fillRhythm(page, ongoing("7", "שאין חשבוניות תקועות"));
    await expect(page.getByTestId("process-when")).toContainText("שוטף, בדיקה כל שבוע: שאין חשבוניות תקועות");
    await expect(page.getByRole("button", { name: "הרצה עכשיו" })).toHaveCount(0);

    // The routine on the home screen, and the check from there.
    await page.goto("/app");
    const row = () => page.locator("li", { hasText: title }).first();
    await expect(page.getByText("שגרה שוטפת")).toBeVisible({ timeout: 15_000 });
    await expect(row()).toContainText("עוד לא נבדק");
    await row().getByRole("button", { name: "רישום בדיקה" }).click();
    const check = page.getByRole("dialog");
    await expect(check).toBeVisible();
    await check.getByLabel("נמצאה בעיה").check();
    await check.locator('textarea[name="note"]').fill("חשבונית של Notion לא הגיעה");
    await submit(page, "רישום הבדיקה");
    await expect(row()).toContainText("הבאה ב-", { timeout: 15_000 });

    // The board: in the list, its last is the check, and its next the next one.
    await page.goto(`/app/clients/${CLIENT}?tab=file&section=processes`);
    const line = page.getByTestId("process-list").locator("tr", { hasText: title });
    await expect(line).toContainText("נמצאה בעיה", { timeout: 15_000 });
    await expect(line).toContainText("בדיקה ");
    // The issue opened a task, a run of the process.
    await line.getByRole("link", { name: title }).click();
    await expect(page.getByTestId("process-open-run")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("process-open-run").getByRole("link", { name: "לריצה" }).click();
    await expect(page).toHaveURL(/\/app\/tasks\//, { timeout: 15_000 });
    await expect(page.getByText("חשבונית של Notion לא הגיעה").first()).toBeVisible({ timeout: 15_000 });
  });

  // 13.11.2026 (stage 2): "a documentation field marked not relevant" was a
  // card's checklist. The spec (5.2) leaves the documentation score and the
  // fix list off the process page; stage 4 brings them back in the
  // procedure document's tab, for a client with audit requirements.
});
