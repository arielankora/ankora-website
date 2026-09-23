import { test, expect } from "./fixtures";

// Portal phase 2, from the client's side of the glass.
//
// This is the only write in the product where the person acting is not an
// Ankora employee and the record produced is evidence: the service
// agreement asks for the client's approval in writing above their agreed
// ceiling, and this screen is that approval. So the test drives the real
// gesture - open the screen, read the options, click one - rather than
// asserting that a component renders.
//
// Serial, and it consumes the seeded decision: there is exactly one open
// decision in the fixture, answering it is final by design (a client who
// changes their mind gets a new decision), and a parallel run would have
// two tests racing for the same single answer.
//
// Every assertion below goes through a retrying locator rather than a
// one-shot innerText read. `domcontentloaded` returns before the server
// component's content is painted, and the first version of this file read
// the body at that moment: it saw the app shell, reported that the seeded
// decision was missing, and looked exactly like a product bug. Same
// lesson the detail-screens specs already carry.
//
// Prose warning, same as the other flow files: coverage is inferred from
// the TEXT of these files, and a Server Action inherits the module paths
// it imports. Refer to modules in words, never as paths.
//
// @covers action:(product)/app/(authenticated)/portal/decisions/actions

test.describe.configure({ mode: "serial", timeout: 90_000 });

const DECISIONS = "/app/portal/decisions";
const HOME = "/app/portal";

// The seeded decision and its recommended option, from the demo fixture.
const QUESTION = "באיזה מועד לקבוע את ביקור הטכנאי";
const RECOMMENDED = "יום שלישי בבוקר";
const WAITING_BANNER = /החלטה אחת מחכה לך|החלטות מחכות לך/;

/// Wait for the open card itself, and say what the screen shows instead
/// when it is not there.
///
/// Written after a CI failure that could not be read: the run reported a
/// missing ceiling sentence, which sounds like a rendering regression,
/// while the three assertions before it had passed against text that is
/// not on the card at all - the question and the chosen option also
/// appear in the record of past decisions, and "ההמלצה שלנו" is a
/// substring of the empty state's own sentence. An empty screen was
/// therefore reported as a screen with three quarters of a card on it.
/// A failure that names the wrong thing costs more than no test.
async function openCard(page: import("@playwright/test").Page) {
  const answer = page.getByRole("button", { name: new RegExp(RECOMMENDED) });
  try {
    await answer.waitFor({ state: "visible", timeout: 25_000 });
  } catch {
    const shown = await page
      .locator("main")
      .innerText()
      .catch(() => "(the page has no main element)");
    throw new Error(
      `the open decision is not on the screen. this is what the screen says instead:\n---\n${shown.slice(0, 900)}\n---`
    );
  }
  return answer;
}

test("the decision screen shows the question, the options and our recommendation", async ({ page }) => {
  const response = await page.goto(DECISIONS, { waitUntil: "domcontentloaded" });

  expect(response?.status()).toBe(200);
  // Path, not substring: a route whose name merely starts with
  // "/app/login" is not a bounce.
  expect(new URL(page.url()).pathname, "bounced to login - the client session was not accepted").not.toBe("/app/login");

  await openCard(page);

  await expect(page.getByText(QUESTION).first()).toBeVisible();
  await expect(page.getByText(RECOMMENDED).first()).toBeVisible();
  // `exact`, because the empty state's own sentence ends with the same
  // three words. Without it this assertion passes on a screen that has
  // no decision on it.
  await expect(page.getByText("ההמלצה שלנו", { exact: true })).toBeVisible();
  // The ceiling sentence is the reason this screen is an approval rather
  // than a poll, so its absence is a real regression.
  await expect(page.getByText("גבוה מהתקרה שסוכמה איתך")).toBeVisible();
});

test("the home screen points at it", async ({ page }) => {
  await page.goto(HOME, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(WAITING_BANNER).first()).toBeVisible();
});

test("answering records the choice and closes the decision", async ({ page }) => {
  await page.goto(DECISIONS, { waitUntil: "domcontentloaded" });

  const option = await openCard(page);
  await option.click();

  // Two assertions, in this order, because they fail for different
  // reasons and the difference is the whole diagnosis: the server
  // accepting the answer, and the screens behind the card catching up.
  // A single assertion on the record cannot tell "the write was refused"
  // from "the write landed and the refresh is slow", and the first run
  // that failed here spent a round on exactly that ambiguity.
  await expect(page.getByText("התשובה נקלטה"), "the server did not accept the answer").toBeVisible({
    timeout: 20_000,
  });

  // The answer moves the decision from the open cards to the record
  // below them, so the assertion is on the record - not on the button
  // disappearing, which would also be true if the page simply errored.
  await expect(
    page.getByText("החלטות קודמות"),
    "the answer was accepted but the screen never refreshed to show the record"
    // Thirty seconds was not enough on a loaded runner. The refresh is
    // two revalidated portal trees rendered server-side before the
    // router applies them, and it was measured at twenty seconds on a
    // quiet machine while the slow-writes work was going on. The budget
    // here is generous on purpose so that this test fails for product
    // reasons and not for arithmetic; the twenty seconds themselves are
    // a real cost and belong in their own piece of work.
  ).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText("אושר על ידי")).toBeVisible();
  await expect(page.getByText(RECOMMENDED).first()).toBeVisible();
});

test("the home screen stops asking once it is answered", async ({ page }) => {
  await page.goto(HOME, { waitUntil: "domcontentloaded" });

  // Wait for the screen to actually be there before asserting something
  // is absent from it: on an unpainted page every absence is true.
  await expect(page.getByText("שלום,").first()).toBeVisible();
  await expect(page.getByText(WAITING_BANNER)).toHaveCount(0);
});
