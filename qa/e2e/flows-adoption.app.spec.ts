import type { Locator } from "@playwright/test";
import { test, expect } from "./fixtures";

// Team adoption ("אימוץ בצוות"), from the side of the person who has to
// do it - which is the only side that decides whether it happens.
//
// Two of these tests assert that a screen updates ITSELF after a write,
// with no page.reload() anywhere in the file. That is deliberate and it
// is the point: every other write test in this suite reloads before
// asserting, which is why a refresh that only landed half the time went
// unnoticed through three releases. A mechanism whose whole premise is
// "one tap and the client's picture is current" cannot be tested by a
// test that reloads the page for it.
//
// Prose warning, same as the other flow files: coverage is inferred from
// the TEXT of these files, and a Server Action inherits the module paths
// it imports. Refer to modules in words, never as paths.
//
// @covers action:(product)/app/(authenticated)/timer/actions
// @covers action:(product)/app/(authenticated)/tasks/actions

test.describe.configure({ timeout: 90_000 });

const HOME = "/app";
const TASKS = "/app/tasks";
const TIMER = "/app/timer";

// The seeded promise assigned to the employee this project signs in as.
const MY_PROMISE = "בדיקת שלושה ספקים והשוואה";
const CLIENT = "אורביט";

/// Pick an option by the text a person would read.
///
/// Playwright's own `selectOption({ label })` wants an exact string, and
/// every seeded name here is prefixed with "[DEMO]" - so an exact label
/// would encode the fixture's prefix into every test that touches a
/// dropdown, and break the day the prefix changes.
async function selectByText(select: Locator, text: string) {
  const value = await select.locator("option", { hasText: text }).first().getAttribute("value");
  expect(value, `no option matching "${text}"`).toBeTruthy();
  await select.selectOption(value as string);
}

test("the home screen says what is on this person", async ({ page }) => {
  await page.goto(HOME, { waitUntil: "domcontentloaded" });

  await expect(page.getByText("המשימות שלי")).toBeVisible();
  await expect(page.getByText(MY_PROMISE).first()).toBeVisible();
});

test("the tasks screen can show only this person's work", async ({ page }) => {
  await page.goto(TASKS, { waitUntil: "domcontentloaded" });

  // Everything, including work assigned to nobody.
  await expect(page.getByText(MY_PROMISE).first()).toBeVisible();

  await page.getByRole("link", { name: "שלי", exact: true }).click();
  await expect(page).toHaveURL(/mine=1/);
  await expect(page.getByText(MY_PROMISE).first()).toBeVisible();

  // The filter combines with the status pills rather than replacing
  // them, which is the whole reason it is a separate control.
  await page.getByRole("link", { name: "בטיפול", exact: true }).click();
  await expect(page).toHaveURL(/mine=1/);
  await expect(page).toHaveURL(/status=IN_PROGRESS/);
});

test("a promise the client can see cannot be closed without a sentence for them", async ({ page }) => {
  await page.goto(TASKS, { waitUntil: "domcontentloaded" });

  // Its own task, created through the screen, so this test does not
  // consume a fixture anything else depends on.
  const title = `[E2E] הבטחה-${Date.now().toString(36)}`;
  await page.getByRole("button", { name: "+ משימה" }).click();
  await page.locator('select[name="clientId"]').selectOption({ index: 1 });
  await page.locator('input[name="title"]').fill(title);
  await page.locator('input[name="clientVisible"]').check();
  await page.getByRole("button", { name: "הוספת משימה" }).click();

  const row = page.locator("[data-task]").filter({ hasText: title });
  await expect(row, "the task the drawer just created is not in the list").toBeVisible({ timeout: 20_000 });

  // The close asks before it happens, rather than being refused after.
  await row.getByRole("checkbox").click();
  await expect(page.getByText("מה נגיד ללקוח שקרה?")).toBeVisible();

  const outcome = "בדקנו מול שני ספקים וסגרנו עם הזול מביניהם.";
  await page.getByPlaceholder("משפט אחד, בשפה שלו").fill(outcome);
  await page.getByRole("button", { name: "סיום", exact: true }).click();

  // No reload. The sentence has to appear on the row on its own, because
  // that is what it means for the write to have landed anywhere the
  // client will read it.
  await expect(page.getByText(outcome).first()).toBeVisible({ timeout: 30_000 });
  await expect(row.getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
});

test("stopping the timer asks what stage the promise is at", async ({ page }) => {
  await page.goto(TIMER, { waitUntil: "domcontentloaded" });

  // Leave no timer of a previous spec running: one per person is the
  // rule, and a start refused here would read as a broken mechanism.
  const runningStop = page.getByRole("button", { name: /עצירה ושמירה/ });
  if (await runningStop.isVisible().catch(() => false)) {
    await runningStop.click();
    await expect(page.getByText("אין טיימר פעיל")).toBeVisible({ timeout: 20_000 });
  }

  await selectByText(page.locator("select").first(), CLIENT);
  // Category, then the promise: the third select only exists once a
  // client with open promises is chosen, which is itself the behaviour
  // worth asserting.
  await page.locator("select").nth(1).selectOption({ index: 1 });
  const promiseSelect = page.locator("select").nth(2);
  await expect(promiseSelect, "the promise picker should appear for a client with open promises").toBeVisible();
  await selectByText(promiseSelect, MY_PROMISE);

  await page.getByRole("button", { name: "התחלת טיימר" }).click();
  await expect(page.getByRole("button", { name: /עצירה ושמירה/ })).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: /עצירה ושמירה/ }).click();

  // The question, inside the toast that already confirms the stop.
  await expect(page.getByText("ומה השלב עכשיו?")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "מחכה ללקוח", exact: true }).click();
  await expect(page.getByText("הלקוח מעודכן")).toBeVisible({ timeout: 30_000 });

  // And it reached the promise itself.
  await page.goto(TASKS, { waitUntil: "domcontentloaded" });
  const row = page.locator("[data-task]").filter({ hasText: MY_PROMISE });
  // The waiting state is an icon, and its label is the only text that
  // says which way it is pointing.
  await expect(row.getByRole("button", { name: "הלקוח כבר לא מעכב" })).toBeVisible({ timeout: 20_000 });
});
