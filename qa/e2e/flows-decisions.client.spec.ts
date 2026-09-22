import { test, expect } from "@playwright/test";

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

test("the decision screen shows the question, the options and our recommendation", async ({ page }) => {
  const response = await page.goto(DECISIONS, { waitUntil: "domcontentloaded" });

  expect(response?.status()).toBe(200);
  // Path, not substring: a route whose name merely starts with
  // "/app/login" is not a bounce.
  expect(new URL(page.url()).pathname, "bounced to login - the client session was not accepted").not.toBe("/app/login");

  await expect(page.getByText(QUESTION)).toBeVisible();
  await expect(page.getByText(RECOMMENDED)).toBeVisible();
  await expect(page.getByText("ההמלצה שלנו")).toBeVisible();
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

  const option = page.getByRole("button", { name: new RegExp(RECOMMENDED) });
  await expect(option, "the recommended option is not on the screen").toBeVisible();
  await option.click();

  // The answer moves the decision from the open cards to the record
  // below them, so the assertion is on the record - not on the button
  // disappearing, which would also be true if the page simply errored.
  await expect(page.getByText("החלטות קודמות")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("אושר על ידי")).toBeVisible();
  await expect(page.getByText(RECOMMENDED)).toBeVisible();
});

test("the home screen stops asking once it is answered", async ({ page }) => {
  await page.goto(HOME, { waitUntil: "domcontentloaded" });

  // Wait for the screen to actually be there before asserting something
  // is absent from it: on an unpainted page every absence is true.
  await expect(page.getByText("שלום,").first()).toBeVisible();
  await expect(page.getByText(WAITING_BANNER)).toHaveCount(0);
});
