import "server-only";

// Measurement before fixing.
//
// Writes in this app have gone slow twice (docs: the dashboard's
// per-client hour-bank queries, and alert evaluation running inside every
// mutation), and both times the first three guesses were wrong and each
// one cost a CI round trip. What settled it both times was a diagnostic
// that said what was actually happening rather than one that counted
// something easy to count.
//
// This is that diagnostic, kept in the product rather than in the test
// suite: a write that takes longer than a person would wait logs one line
// naming itself and its duration. The QA harness surfaces those lines, so
// a flaky browser run stops being "the button stayed disabled" and starts
// being "createManualEntry.overlap took 21_400ms".
//
// It costs one Date.now() per call and prints nothing on a healthy path.

/// A person clicking "save" tolerates this much before the screen feels
/// broken. Below it there is nothing to say; above it, the line is the
/// whole point.
const SLOW_MS = 750;

/// Prefix the QA harness greps for. Kept distinct from "error" so a slow
/// write is never mistaken for a failure - it is a fact about timing.
const TAG = "[slow]";

export async function timed<T>(label: string, work: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  let threw = false;
  try {
    return await work();
  } catch (err) {
    threw = true;
    throw err;
  } finally {
    // One line per call, in the finally so the success and failure paths
    // cannot drift apart. A failure that took twenty seconds and one that
    // took twenty milliseconds are different problems, so the duration is
    // reported either way - and the error itself is rethrown untouched.
    const elapsed = Date.now() - startedAt;
    if (elapsed >= SLOW_MS) console.warn(`${TAG} ${label} ${elapsed}ms${threw ? " (threw)" : ""}`);
  }
}

/// Off unless the browser suite turns it on.
///
/// The suite's own diagnostic can say that a Server Action's POST was
/// aborted after fifty milliseconds and that the row never appeared. It
/// cannot say which side let go: a request that never reached the server
/// and one the server began and never finished look identical from the
/// browser, and they have nothing in common as problems.
///
/// So the action says, in the server log, that it started and that it
/// returned. Two lines, only while qa/playwright.config.ts sets the flag,
/// which means never in production and never in a dev session.
const TRACING = process.env.QA_TRACE === "1";

export function trace(label: string): void {
  // console.warn, not log: the browser suite pipes the app's stderr and
  // discards its stdout, so a line on stdout is a line nobody reads.
  if (TRACING) console.warn(`[trace] ${label}`);
}
