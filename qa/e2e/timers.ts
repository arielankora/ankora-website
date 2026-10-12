import { expect, type Page } from "@playwright/test";

/// Leave no timer running for the signed-in person, from any earlier spec
/// or from this spec's own failed attempt.
///
/// One helper for the three files that need it (flows-time,
/// flows-task-screen, flows-adoption). Each used to carry its own copy of
/// the same loop, and all three copies had the same two faults, which made
/// flows-time fail on four pull requests that never touched the timer
/// (#172, #182, #184, #185; claude/timer-e2e-flake-2026-10-12.md):
///
///   1. `isVisible()` straight after a `domcontentloaded` goto. isVisible
///      does not wait, and /app streams its screens behind loading.tsx, so
///      at that moment the page is often still the skeleton. No stop
///      button yet, the loop never ran, and the check after it timed out
///      with a timer still going.
///   2. Success was read off the count of "עצירה ושמירה" buttons. A stop in
///      flight relabels its own button "עוצר...", so that count drops the
///      moment the click lands, not when the server agrees. With two
///      timers the next round filled the note of the card that was still
///      stopping and clicked the other card's stop with its note empty,
///      which the screen rightly refuses.
///
/// So: discard instead of stop (a leftover is not work anyone did, so it
/// should not become an entry, and discarding has no note rule to satisfy),
/// one card at a time, and the whole round retried. A click that lands
/// before hydration does nothing; the retry simply makes it again.
export async function clearRunningTimers(page: Page) {
  await page.goto("/app/timer");
  const idle = page.getByText("אין טיימר פעיל");
  const discard = page.getByRole("button", { name: "מחיקה ללא שמירה" });
  await expect(async () => {
    if (await idle.isVisible()) return;
    await discard.first().click({ timeout: 2_000 });
    await expect(idle).toBeVisible({ timeout: 3_000 });
  }, "a timer left running by an earlier spec or attempt could not be cleared").toPass({ timeout: 30_000 });
}

/// The running timers on /app/timer, one per card.
///
/// Counted by each card's note field rather than by its stop button: the
/// button is relabelled "עוצר..." while its stop is in flight, so counting
/// buttons says a timer is gone before it is. The field leaves the DOM only
/// when the card does, which is after the server confirmed the stop.
export function runningTimerNotes(page: Page) {
  return page.getByPlaceholder("על מה עובדים עכשיו?", { exact: true });
}
