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
// Prose warning, same as the other flow files: coverage is inferred from
// the TEXT of these files, and a Server Action inherits the module paths
// it imports. Refer to modules in words, never as paths.
//
// @covers action:(product)/app/(authenticated)/portal/decisions/actions

test.describe.configure({ mode: "serial", timeout: 90_000 });

const DECISIONS = "/app/portal/decisions";
const HOME = "/app/portal";

// The seeded decision, its recommended option, and the ceiling it sits
// above - all three from the demo fixture.
const QUESTION = "באיזה מועד לקבוע את ביקור הטכנאי";
const RECOMMENDED = "יום שלישי בבוקר";

test("the decision screen shows the question, the options and our recommendation", async ({ page }) => {
  const response = await page.goto(DECISIONS, { waitUntil: "domcontentloaded" });

  expect(response?.status()).toBe(200);
  // Path, not substring: a route whose name merely starts with
  // "/app/login" is not a bounce.
  expect(new URL(page.url()).pathname, "bounced to login - the client session was not accepted").not.toBe("/app/login");

  const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  expect(body).toContain(QUESTION);
  expect(body).toContain(RECOMMENDED);
  expect(body).toContain("ההמלצה שלנו");
  // The ceiling sentence is the reason this screen is an approval rather
  // than a poll, so its absence is a real regression.
  expect(body).toContain("גבוה מהתקרה שסוכמה איתך");
});

test("the home screen points at it", async ({ page }) => {
  await page.goto(HOME, { waitUntil: "domcontentloaded" });
  const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  expect(body).toMatch(/החלטה אחת מחכה לך|החלטות מחכות לך/);
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

  const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  expect(body).toContain(`נבחר: `);
  expect(body).toContain(RECOMMENDED);
  expect(body).toContain("אושר על ידי");
});

test("the home screen stops asking once it is answered", async ({ page }) => {
  await page.goto(HOME, { waitUntil: "domcontentloaded" });
  const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  expect(body).not.toMatch(/החלטה אחת מחכה לך|החלטות מחכות לך/);
});
