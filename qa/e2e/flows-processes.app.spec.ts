import { test, expect } from "./fixtures";

// Org brain, phase 1 (16.10.2026): a process and its procedure on the
// client screen, submitted for real, as the seeded admin. Same prose rule
// as flows-admin: modules are named in words here, never by path.
//
// @covers action:(product)/app/(authenticated)/clients/process-actions

test.describe.configure({ timeout: 120_000 });

const CLIENT = "demo-client-b";

function tag(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

async function addSource(page: import("@playwright/test").Page): Promise<string> {
  const title = tag("[E2E] מקור");
  await page.getByRole("button", { name: "+ מקור", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.locator('input[name="title"]').fill(title);
  const written = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
  await dialog.getByRole("button", { name: "הוספה למרשם" }).click();
  await written;
  await page.reload();
  const row = page.locator("li", { hasText: title });
  await expect(row.first(), "the source was not added").toBeVisible({ timeout: 15_000 });
  return (await row.first().locator("span.font-mono").innerText()).trim();
}

async function submit(page: import("@playwright/test").Page, button: string) {
  const written = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
  await page.getByRole("dialog").getByRole("button", { name: button }).click();
  await written;
  await page.reload();
}

test.describe("clients/process-actions", () => {
  test("a procedure that automates a payment is held back; fixed, a manager approves it", async ({ page }) => {
    const title = tag("[E2E] תהליך");

    await page.goto(`/app/clients/${CLIENT}?tab=file`);
    const code = await addSource(page);

    await page.getByRole("button", { name: "+ תהליך", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('input[name="title"]').fill(title);
    await dialog.locator('input[name="triggerKinds"][value="EVENT"]').check();
    await dialog.locator('input[name="triggerText"]').fill("בקשת עובד");
    const owner = dialog.locator('select[name="ownerId"] option', { hasText: "מנהל Ankora" }).first();
    await dialog.locator('select[name="ownerId"]').selectOption((await owner.getAttribute("value"))!);
    await dialog.locator('input[name="sources"]').fill(code);
    await submit(page, "הוספה לתיק");

    // The process's card in the panel, not a line elsewhere with the same name.
    const card = () => page.locator("li", { hasText: title }).filter({ has: page.getByRole("button", { name: "עריכה" }) }).first();
    await expect(card(), "the process was not added").toBeVisible({ timeout: 15_000 });
    // 25.10.2026: whether it runs, and why not, apart from the documentation.
    await expect(card().getByTestId("process-readiness")).toHaveText("לא ירוץ: אין נוהל מאושר");
    await expect(card().getByTestId("process-readiness")).toHaveAttribute("data-ready", "false");
    await expect(card().getByTestId("process-documentation")).toContainText("תיעוד");

    await card().getByRole("button", { name: "כתיבת נוהל" }).click();
    const editor = page.getByRole("dialog");
    await expect(editor).toBeVisible();
    await editor.getByLabel("שלב 1: מה עושים").fill("מעבירים תשלום לספק");
    await editor.getByLabel("שלב 1: איך").selectOption("AUTOMATED");
    await editor.getByRole("checkbox", { name: "תשלום" }).check();
    await submit(page, "שמירת טיוטה");

    await expect(card()).toContainText("טיוטה, גרסה 1", { timeout: 15_000 });
    await expect(card()).toContainText("לא נעשה אוטומטית");
    await expect(card().getByRole("button", { name: "אישור הנוהל" })).toHaveCount(0);

    await card().getByRole("button", { name: "עריכת הטיוטה" }).click();
    const fix = page.getByRole("dialog");
    await expect(fix).toBeVisible();
    await fix.getByLabel("שלב 1: איך").selectOption("MANUAL");
    await submit(page, "שמירת טיוטה");
    await expect(card()).toContainText("טיוטה, גרסה 2", { timeout: 15_000 });

    const approved = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await card().getByRole("button", { name: "אישור הנוהל" }).click();
    await approved;
    await page.reload();
    await expect(card()).toContainText("נוהל, גרסה 2", { timeout: 15_000 });
    await expect(card()).not.toContainText("אין נוהל מאושר");
    await expect(card().getByTestId("process-readiness")).toHaveText("רץ");
    await expect(card().getByTestId("process-readiness")).toHaveAttribute("data-ready", "true");

    // An event happened: a run opens as a task, and the card links to it.
    await card().getByRole("button", { name: "פתיחת ריצה" }).click();
    const start = page.getByRole("dialog");
    await expect(start).toBeVisible();
    const today = new Date().toISOString().slice(0, 10);
    await start.locator('input[name="day"]').fill(today);
    await submit(page, "פתיחת הריצה");
    await expect(card()).toContainText("ריצות:", { timeout: 15_000 });
    // 22.10.2026: the runs are under "פרטים", closed once nothing waits.
    await card().getByTestId("process-details").locator("summary").click();
    await card().getByTestId("process-details").getByRole("link").first().click();
    await expect(page).toHaveURL(/\/app\/tasks\//, { timeout: 15_000 });
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("מעבירים תשלום לספק").first()).toBeVisible();
  });

  test("an approved process that runs by a date, with none ahead, says no run will open", async ({ page }) => {
    const title = tag("[E2E] תשלומי ספקים");

    await page.goto(`/app/clients/${CLIENT}?tab=file`);
    const code = await addSource(page);
    await page.getByRole("button", { name: "+ תהליך", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('input[name="title"]').fill(title);
    await dialog.locator('input[name="triggerKinds"][value="SCHEDULED"]').check();
    await dialog.locator('input[name="triggerText"]').fill("ב-10 וב-25 לחודש");
    await dialog.locator('input[name="sources"]').fill(code);
    await submit(page, "הוספה לתיק");

    const card = () => page.locator("li", { hasText: title }).filter({ has: page.getByRole("button", { name: "עריכה" }) }).first();
    await expect(card(), "the process was not added").toBeVisible({ timeout: 15_000 });
    // A draft does not run anyway: its dates are asked for, but no run is
    // said to be stopped yet.
    await expect(card().getByTestId("process-next-step")).not.toContainText("בלי מועד");

    await card().getByRole("button", { name: "כתיבת נוהל" }).click();
    const editor = page.getByRole("dialog");
    await expect(editor).toBeVisible();
    await editor.getByLabel("שלב 1: מה עושים").fill("מכינים את קובץ התשלומים");
    await submit(page, "שמירת טיוטה");
    const approved = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await card().getByRole("button", { name: "אישור הנוהל" }).click();
    await approved;
    await page.reload();

    // 22.10.2026: it is the step that stops work, so it is "הצעד הבא".
    await expect(card().getByTestId("process-next-step")).toHaveAttribute("data-step", "no_next_date", { timeout: 15_000 });
    await expect(card().getByTestId("process-next-step")).toContainText("לא ירוץ: תהליך לפי מועד בלי מועד");
    // The control line counts it among the processes that will not run.
    await expect(page.getByText(/לא ירוצ?ו?/).first()).toBeVisible();
  });

  test("an ongoing process is in its owner's routine; a check that finds an issue opens a task", async ({ page }) => {
    const title = tag("[E2E] שוטף");

    await page.goto(`/app/clients/${CLIENT}?tab=file`);
    const code = await addSource(page);

    await page.getByRole("button", { name: "+ תהליך", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('input[name="title"]').fill(title);
    await dialog.locator('input[name="triggerKinds"][value="CONTINUOUS"]').check();
    // The seeded admin owns it, so it lands in this session's routine.
    const owner = dialog.locator('select[name="ownerId"] option', { hasText: "מנהל Ankora" }).first();
    await dialog.locator('select[name="ownerId"]').selectOption((await owner.getAttribute("value"))!);
    await dialog.locator('input[name="checkEveryDays"]').fill("7");
    await dialog.locator('input[name="checkText"]').fill("שאין חשבוניות תקועות");
    await dialog.locator('input[name="sources"]').fill(code);
    await submit(page, "הוספה לתיק");

    const card = () => page.locator("li", { hasText: title }).filter({ has: page.getByRole("button", { name: "עריכה" }) }).first();
    await expect(card(), "the process was not added").toBeVisible({ timeout: 15_000 });
    await expect(card()).toContainText("בדיקה פעם בשבוע: שאין חשבוניות תקועות");
    await expect(card()).toContainText("היום");
    await expect(card().getByRole("button", { name: "פתיחת ריצה" })).toHaveCount(0);

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

    await page.goto(`/app/clients/${CLIENT}?tab=file`);
    await expect(card()).toContainText("נמצאה בעיה. חשבונית של Notion לא הגיעה", { timeout: 15_000 });
    await card().getByTestId("process-details").locator("summary").click();
    await card().getByTestId("process-details").getByRole("link", { name: "המשימה" }).click();
    await expect(page).toHaveURL(/\/app\/tasks\//, { timeout: 15_000 });
    await expect(page.getByText("חשבונית של Notion לא הגיעה").first()).toBeVisible({ timeout: 15_000 });
  });

  test("a documentation field marked not relevant leaves the count, and the mark can be taken off", async ({ page }) => {
    const title = tag("[E2E] לא רלוונטי");

    await page.goto(`/app/clients/${CLIENT}?tab=file`);
    const code = await addSource(page);
    await page.getByRole("button", { name: "+ תהליך", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('input[name="title"]').fill(title);
    await dialog.locator('input[name="triggerKinds"][value="EVENT"]').check();
    await dialog.locator('input[name="triggerText"]').fill("עובד חדש");
    await dialog.locator('input[name="sources"]').fill(code);
    await submit(page, "הוספה לתיק");

    const card = () => page.locator("li", { hasText: title }).filter({ has: page.getByRole("button", { name: "עריכה" }) }).first();
    await expect(card(), "the process was not added").toBeVisible({ timeout: 15_000 });
    await expect(card().getByTestId("process-documentation")).toHaveText("תיעוד 0 מתוך 6");

    const external = card().getByTestId("process-checklist").locator('li[data-step="doc_field"]', { hasText: "גורם חיצוני" });
    const marked = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await external.getByTestId("mark-not-applicable").click();
    await marked;
    await page.reload();
    await expect(card().getByTestId("process-not-applicable")).toContainText("גורם חיצוני", { timeout: 15_000 });
    await expect(card().getByTestId("process-documentation")).toHaveText("תיעוד 0 מתוך 5");
    await expect(card().getByTestId("process-checklist")).not.toContainText("תיעוד: חסר גורם חיצוני");

    const restored = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400);
    await card().getByTestId("process-not-applicable").getByRole("button", { name: "(ביטול)" }).click();
    await restored;
    await page.reload();
    await expect(card().getByTestId("process-documentation")).toHaveText("תיעוד 0 מתוך 6", { timeout: 15_000 });
  });
});
