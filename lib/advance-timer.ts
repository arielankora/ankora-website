// "קדם עם קלוד והפעל טיימר" (Ariel, 3.11.2026).
//
// The conversation in Claude already opens by looking for a running timer
// and offering one (lib/advance-prompt.ts, timerRules). It still cost about
// a minute of billable time per task: the tools load, Claude reads, and
// only then does the first card reach the screen. A second button next to
// "קדם עם קלוד" closes that gap: the same copy, and a timer on the task
// started by Ankora itself, at the click.
//
// It starts a timer only when that is safe to do without asking:
// - nothing runs, and the task has a category: start, on this task.
// - a timer already runs on this client: nothing new. Claude sees it live
//   and reports it, as it does today.
// - a timer runs on another client (or two run): nothing starts. Running
//   both bills both clients in full, and that is the person's call, so
//   Claude asks, as it does today. No silent parallel timer.
// - the task has no category: nothing starts, as with the timer button
//   on the task. Claude asks, and start_timer picks one there.
//
// The prompt is copied in every case, inside the click, before any of
// this runs: the timer must never cost the copy (see AdvanceWithClaude).

export type AdvanceTimerOutcome =
  | "started"
  | "running_on_client"
  | "other_client"
  | "no_category"
  | "error";

export const ADVANCE_TIMER_LABELS = {
  plan: "קדם עם קלוד והפעל טיימר",
  lessons: "סיכום ולקחים עם קלוד והפעל טיימר",
} as const;

/// The line shown after the click, next to "the prompt was copied".
/// Every outcome says plainly whether a timer runs now, because the
/// person decides from it whether to look at the timer bar.
export function advanceTimerNotice(outcome: AdvanceTimerOutcome, error?: string | null): string {
  switch (outcome) {
    case "started":
      return "הטיימר הופעל על המשימה.";
    case "running_on_client":
      return "כבר רץ טיימר על הלקוח הזה, ולכן לא הופעל טיימר נוסף.";
    case "other_client":
      return "רץ טיימר על לקוח אחר, ולכן לא הופעל טיימר. קלוד ישאל מה לעשות.";
    case "no_category":
      return "למשימה אין קטגוריה, ולכן לא הופעל טיימר. קלוד ישאל על הטיימר.";
    case "error":
      return `הטיימר לא הופעל${error ? `: ${error}` : "."} קלוד ישאל על הטיימר.`;
  }
}
