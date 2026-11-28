import { test, expect } from "./fixtures";

// Agents ("סוכנים"), from the side of a manager writing a new one.
//
// One agent is written from nothing, through the forms a person uses: it
// is created on the list, gets an instructions block, a parameter and a
// change note, is sent for approval, is approved on the versions screen, and its
// installations screen then offers to install it. Each step asserts what
// the screen shows after the write, so a Server Action that fails in
// silence turns this red.
//
// The agent gets a fresh name on every run, so a re-run on a database
// that kept the last one does not trip over its address.
//
// Every write here goes through the agents Server Actions, and the
// screens are reached by following the agent's own address, so neither
// can be named as a path in this file:
// @covers action:(product)/app/(authenticated)/agents/actions
// @covers screen:/app/agents/[slug]
// @covers screen:/app/agents/[slug]/instructions
// @covers screen:/app/agents/[slug]/params
// @covers screen:/app/agents/[slug]/versions
// @covers screen:/app/agents/[slug]/installations
//
// Prose warning, as in the other flow files: coverage is inferred from
// the text of these files, so modules are referred to in words.

test.describe.configure({ timeout: 120_000, mode: "serial" });

const NAME = `סוכן בדיקה ${Date.now().toString(36)}`;
let base = "";

test("a new agent is created on the list and opens on its instructions", async ({ page }) => {
  await page.goto("/app/agents", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "סוכנים", level: 1 })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "סוכן חדש" }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("שם הסוכן").fill(NAME);
  await drawer.getByLabel("מה הוא עושה, בשורה").fill("סוכן שנוצר בבדיקת הדפדפן");
  await drawer.getByLabel("איפה הוא רץ").selectOption("SCHEDULED");
  await drawer.getByRole("button", { name: "ליצור סוכן" }).click();

  await page.waitForURL(/\/app\/agents\/[^/]+\/instructions$/, { timeout: 30_000 });
  base = new URL(page.url()).pathname.replace(/\/instructions$/, "");
  await expect(page.getByText(NAME).first()).toBeVisible({ timeout: 30_000 });
});

test("a block is added to the draft on the instructions tab", async ({ page }) => {
  await page.goto(`${base}/instructions`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "להוסיף קטע" }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("כותרת").fill("מה עושים");
  await drawer.getByLabel("הטקסט").fill("קוראים את המשימות הפתוחות ומסכמים אותן.");
  await drawer.getByRole("button", { name: "לשמור בטיוטה" }).click();
  await expect(drawer).toBeHidden({ timeout: 30_000 });

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("מה עושים").first()).toBeVisible({ timeout: 30_000 });
});

test("a parameter is added to the draft on the parameters tab", async ({ page }) => {
  await page.goto(`${base}/params`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "הפרמטרים" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "פרמטר חדש" }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("שם בהוראות").fill("חתימה");
  await drawer.getByLabel("תיאור").fill("איך חותמים");
  await drawer.getByRole("button", { name: "לשמור בטיוטה" }).click();
  await expect(drawer).toBeHidden({ timeout: 30_000 });

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("איך חותמים").first()).toBeVisible({ timeout: 30_000 });
});

test("a change note is written, the draft is sent from the overview, and approved on the versions tab", async ({ page }) => {
  // A draft is not sent without a line on what changed and why.
  await page.goto(`${base}/instructions`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "הערת שינוי ודרישות" }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("מה השתנה ולמה").fill("גרסה ראשונה, מבדיקת הדפדפן");
  await drawer.getByRole("button", { name: "לשמור בטיוטה" }).click();
  await expect(drawer).toBeHidden({ timeout: 30_000 });

  await page.goto(base, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(NAME).first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "לשלוח לאישור" }).click();
  await expect(page.getByText("נשלח לאישור מנהל")).toBeVisible({ timeout: 30_000 });

  await page.goto(`${base}/versions`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "לאשר גרסה 1" }).click();
  await expect(page.getByText("גרסה 1 אושרה").first()).toBeVisible({ timeout: 30_000 });

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("גרסה 1 מאושרת").first()).toBeVisible({ timeout: 30_000 });
});

test("the installations tab of the approved agent offers to install it", async ({ page }) => {
  await page.goto(`${base}/installations`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("אין עדיין התקנות.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("אפשר להתקין אחרי שגרסה ראשונה מאושרת.")).toHaveCount(0);
});
