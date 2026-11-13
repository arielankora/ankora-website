import { expect, type Locator, type Page } from "@playwright/test";

/// 13.11.2026 (processes redesign, stage 1): what starts a process is set in
/// the rhythm editor, a window opened from the process, no longer in the
/// process form. Opens it from `from` (a card or a page), lets `choose` fill
/// it, saves, and waits for the window to close.
export async function setRhythm(page: Page, from: Locator, choose: (dialog: Locator) => Promise<void>) {
  await from.getByRole("button", { name: /^(לקבוע מתי הוא רץ|שינוי)$/ }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("rhythm-editor")).toBeVisible({ timeout: 15_000 });
  await choose(dialog);
  await dialog.getByTestId("rhythm-save").click();
  await expect(page.getByTestId("rhythm-editor")).toHaveCount(0, { timeout: 15_000 });
}

export const whenSomethingHappens = (what: string) => async (dialog: Locator) => {
  await dialog.getByTestId("rhythm-kind-EVENT").click();
  await dialog.getByLabel("מה קורה שמתחיל אותו").fill(what);
};

export const ongoing = (days: string, what: string) => async (dialog: Locator) => {
  await dialog.getByTestId("rhythm-kind-CONTINUOUS").click();
  await dialog.getByLabel("בדיקה כל (ימים)").fill(days);
  await dialog.getByLabel("מה בודקים").fill(what);
};

/// A schedule of one day that has passed: "by a date", with no date ahead.
export const onceInThePast = async (dialog: Locator) => {
  await dialog.getByTestId("rhythm-kind-SCHEDULE").click();
  await dialog.getByTestId("rhythm-frequency-ONCE").click();
  await dialog.getByLabel("תאריך").fill("2026-01-01");
};
