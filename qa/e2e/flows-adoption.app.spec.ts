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

  // `exact`, because the block's own "לכל המשימות שלי" link contains the
  // heading as a substring and a loose match resolves to both.
  await expect(page.getByText("המשימות שלי", { exact: true })).toBeVisible();
  await expect(page.getByText(MY_PROMISE).first()).toBeVisible();
});

test("the tasks screen can show only this person's work", async ({ page }) => {
  await page.goto(TASKS, { waitUntil: "domcontentloaded" });

  // Everything, including work assigned to nobody.
  await expect(page.getByText(MY_PROMISE).first()).toBeVisible();

  // Asserted on where the controls POINT rather than by clicking through
  // them. The first version clicked, and spent a round failing on a URL
  // that had not changed - which says nothing about whether the filter
  // works and everything about when a client-side navigation settles.
  // Where a link points is the behaviour; the router getting there is
  // Next's job and is exercised by every other navigation in this suite.
  const mineToggle = page.getByRole("link", { name: "שלי", exact: true });
  await expect(mineToggle).toHaveAttribute("href", "/app/tasks?mine=1");

  await page.goto("/app/tasks?mine=1", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(MY_PROMISE).first()).toBeVisible();

  // The filter combines with the status pills rather than replacing
  // them, which is the whole reason it is a separate control: from the
  // filtered screen, every pill keeps it on.
  await expect(page.getByRole("link", { name: "בטיפול", exact: true })).toHaveAttribute(
    "href",
    "/app/tasks?status=IN_PROGRESS&mine=1"
  );
  // And the toggle now points back out, keeping nothing behind it.
  await expect(page.getByRole("link", { name: "שלי", exact: true })).toHaveAttribute("href", "/app/tasks");
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

  // This test is the only one in the suite that asserts a screen
  // refreshing ITSELF after a write, which is why it never reloads and
  // why it must not start doing so to go green.
  //
  // It has also been failing and passing on retry for weeks while saying
  // only "the row is not there", which is the symptom and not the half
  // that broke. There are exactly two halves - the write did not land, or
  // it landed and the screen never showed it - and the answer is in the
  // action's own response. So the test reads it, the way the decisions
  // spec has done since the same race was chased through that screen.
  const wrote = page
    .waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/app/tasks"), { timeout: 30_000 })
    .catch(() => null);

  await page.getByRole("button", { name: "הוספת משימה" }).click();

  const response = await wrote;
  const body = response ? await response.text().catch(() => null) : null;
  const carried =
    response === null
      ? "the write never even produced a response - the click did not submit, or it was aborted"
      : body === null
        ? `the write answered ${response.status()} and its body could not be read`
        : body.includes(title)
          ? `the server DID send back a screen carrying this task (${body.length} bytes) - the browser did not apply it`
          : // How many task rows came back matters more than that this one
            // did not. A response with no rows at all is a response with no
            // re-rendered list in it, and the row can only arrive by the
            // explicit refresh. A response carrying the rows that existed
            // BEFORE this write is something else entirely: a list that was
            // re-rendered and did not see the row, which is not a refresh
            // problem and would send the next person to the wrong place.
            `the write answered ${response.status()} (${body.length} bytes) and the task is NOT in what came back, though ${
              (body.match(/data-task/g) ?? []).length
            } task row(s) are - so the list WAS re-rendered and did not include this row`;

  // Two stages, because "the row is not there" has two very different
  // causes and this test has been unable to tell them apart for weeks.
  //
  // Stage one is the property under test: the screen brings the row in by
  // itself. Forty-five seconds, matching the decisions spec, and for its
  // reason - a refresh on this app was measured at twenty seconds on a
  // QUIET machine while the slow-writes work was going on. That cost is
  // real and belongs in its own piece of work; it must not be mistaken
  // here for a refresh that never happened.
  //
  // Stage two runs only when stage one has already failed, and it exists
  // to name which half broke. If a reload shows the row, the write landed
  // and the screen never told anyone - a product fault in the refresh. If
  // a reload does not show it either, the row is not in this list at all,
  // which is a different fault entirely and would send the next person
  // somewhere else.
  const row = page.locator("[data-task]").filter({ hasText: title });
  const appeared = await row
    .waitFor({ state: "visible", timeout: 45_000 })
    .then(() => true)
    .catch(() => false);

  if (!appeared) {
    await page.reload({ waitUntil: "domcontentloaded" });
    const afterReload = await row
      .waitFor({ state: "visible", timeout: 20_000 })
      .then(() => true)
      .catch(() => false);

    throw new Error(
      afterReload
        ? `the screen never refreshed itself: the task IS in the list after a reload, so the write landed and nothing told the page. ${carried}`
        : `the task is not in the list even after a reload, so this is not a refresh problem at all. ${carried}`
    );
  }

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
