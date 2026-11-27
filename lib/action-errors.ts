import "server-only";
import { reportIssue } from "@/lib/system-issues";

/// The last line of a screen action's error handling (27.11.2026, silent
/// failures plan, stage 1c).
///
/// Every screen's friendlyError ended with `return err.message`: an error
/// nothing above it recognised went back to the form as it was, and nowhere
/// else. A Prisma or Drive failure showed its raw text to the person (in
/// the portal, to a client) and left no record a person would see.
///
/// A sentence in Hebrew is a refusal written for the person (some domain
/// rules still throw a plain Error with one), so it goes back as it is.
/// Anything else is a fault: it becomes a system issue, and the person gets
/// the screen's own "something went wrong" line instead of its text.
const HEBREW = /[֐-׿]/;

export async function unexpectedActionError(err: unknown, fallback: string, area: string): Promise<string> {
  if (err instanceof Error && HEBREW.test(err.message)) return err.message;
  await reportIssue({
    area: "action",
    key: `${area}:${err instanceof Error ? err.name : typeof err}`,
    title: `פעולה במסך ${area} נכשלה בשגיאה לא צפויה`,
    error: err,
    severity: "WARNING",
  });
  return fallback;
}
