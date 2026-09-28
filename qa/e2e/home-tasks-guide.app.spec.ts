import { test, expect } from "./fixtures";

// Ariel's list of 26.9.2026, the parts a person sees on the home screen,
// the tasks screen and the guide.
//
// Prose warning, same as the other flow files here: coverage is inferred
// from the TEXT of these files, so modules are referred to in words.

test.describe.configure({ timeout: 90_000 });

test("the home screen drops the counts and the subtitle, and today's hours open a breakdown", async ({ page }) => {
  await page.goto("/app", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });

  await expect(page.getByText("סקירה כללית של המערכת")).toHaveCount(0);
  await expect(page.getByText("ספירות", { exact: true })).toHaveCount(0);

  // A link now, to who worked how much for whom, today.
  const today = page.getByRole("link", { name: /שעות דווחו היום/ });
  await expect(today).toBeVisible();
  await expect(today).toHaveAttribute("href", /type=employee_client_matrix&from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/);

  // The bank card speaks in hours and says what was expected, whenever
  // there is a bank to speak about. The demo seed may have none, and a
  // card showing "-" has nothing to explain.
  const bank = page.getByRole("link", { name: /ניצול/ });
  if (/\d+%/.test((await bank.textContent()) ?? "")) {
    await expect(bank).toContainText("מתוך");
    await expect(bank).toContainText("צפי להיום");
  }
});

test("\"משימה חדשה\" in the top bar opens the new task form from any screen", async ({ page }) => {
  await page.goto("/app", { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: "משימה חדשה" }).click();
  await expect(page).toHaveURL(/\/app\/tasks/);
  await expect(page.getByRole("dialog", { name: "משימה חדשה" })).toBeVisible({ timeout: 30_000 });
  // The parameter that opened it is gone, so a reload does not reopen it.
  await expect(page).not.toHaveURL(/new=task/);

  // And on the tasks screen itself it opens in place, with one entry
  // point: the in-page button is for phones only.
  await expect(page.getByRole("button", { name: "משימה", exact: true })).toBeHidden();
});

test("a finished task is not struck through", async ({ page }) => {
  await page.goto("/app/tasks?status=DONE&mine=0&closed=all", { waitUntil: "domcontentloaded" });
  const titles = page.locator('[data-task] [data-cell="title"] a');
  if ((await titles.count()) === 0) test.skip(true, "no finished task in this database");
  const decoration = await titles.first().evaluate((el) => getComputedStyle(el).textDecorationLine);
  expect(decoration).not.toContain("line-through");
});

test("\"הושלמו\" shows the last thirty days and says how to see the rest", async ({ page }) => {
  await page.goto("/app/tasks?status=DONE&mine=0", { waitUntil: "domcontentloaded" });
  const note = page.getByText(/מוצגות משימות שהושלמו ב-30 הימים האחרונים/);
  await expect(note).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: "להצגת כל ההיסטוריה" })).toHaveAttribute("href", /closed=all/);
});

test("the guide can be searched, and says when nothing matches", async ({ page }) => {
  await page.goto("/app/guide", { waitUntil: "domcontentloaded" });
  const box = page.getByRole("searchbox", { name: "חיפוש במדריך" });
  await expect(box).toBeVisible({ timeout: 30_000 });

  const before = await page.locator("article").count();
  await box.fill("מפקח");
  await expect(page.getByText(/נמצא(ו)? /)).toBeVisible();
  const after = await page.locator("article").count();
  expect(after).toBeGreaterThan(0);
  expect(after).toBeLessThan(before);
  await expect(page.locator("article mark").first()).toBeVisible();

  await box.fill("מילה-שלא-קיימת-בשום-מקום");
  await expect(page.getByText("לא נמצאו סעיפים", { exact: false })).toBeVisible();
  await expect(page.locator("article")).toHaveCount(0);
});
