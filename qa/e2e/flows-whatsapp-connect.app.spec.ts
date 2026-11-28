import { test, expect } from "./fixtures";

// "חיבור ה-WhatsApp שלי" (24.11.2026), from the side of an employee who
// has not connected a number yet.
//
// The first step sends the person to Unipile's connect screen, with a
// signed cookie the way back must bring. The QA environment has no
// Unipile key on purpose (no test may reach a real WhatsApp account), so
// what this file can drive end to end is the refusal: the button runs the
// Server Action, the link cannot be made, and the screen says so in its
// own words instead of throwing or sending the person somewhere broken.
// It is also what an employee meets when Unipile is down.
//
// The second step ("הפעלת שמירה") needs a connected number, which the
// demo seed does not have and this file cannot make without Unipile, so
// it is not driven here. The connect logic itself (the signed cookie, the
// way back) is in tests/unit/comms-self-connect.test.ts.
//
// The button posts to the connect Server Action, which this file cannot
// name as a path:
// @covers action:(product)/app/(authenticated)/whatsapp-poc/connect/actions

test.describe.configure({ timeout: 60_000 });

const PAGE = "/app/whatsapp-poc/connect";

test("the connect screen offers the first step to someone with no number", async ({ page }) => {
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "חיבור ה-WhatsApp שלי", level: 1 })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "חיבור ה-WhatsApp שלי" })).toBeVisible();
});

test("when the connect link cannot be made, the screen says so and stays here", async ({ page }) => {
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "חיבור ה-WhatsApp שלי" }).click();

  await page.waitForURL(/\/app\/whatsapp-poc\/connect\?result=link-failed$/, { timeout: 30_000 });
  // Next adds its own role="alert" (the route announcer), so the message is
  // found by its text and then checked to be the screen's alert.
  const message = page.getByText("לא הצלחנו לפתוח את מסך החיבור. נסו שוב בעוד דקה.");
  await expect(message).toBeVisible();
  await expect(message).toHaveAttribute("role", "alert");
  // Still offered, so the person can try again.
  await expect(page.getByRole("button", { name: "חיבור ה-WhatsApp שלי" })).toBeVisible();
});
