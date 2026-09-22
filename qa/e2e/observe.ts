import os from "node:os";
import type { Page } from "@playwright/test";

// What the browser saw, for a failure the server log cannot explain.
//
// This started as a POST recorder, because the question was "is the
// Server Action slow". It answered that question: 39ms, status 200,
// nothing in flight - and the submit button still read "נוצר..." thirty
// seconds later. Which turned the recorder's own blind spots into the
// next thing worth fixing, since both of them could hide the real cause:
//
//   - it watched POSTs only, so an RSC fetch that hangs after the action
//     returns (Next re-fetches the tree that `revalidatePath` dirtied)
//     was invisible, and "nothing in flight" meant "no POST in flight".
//   - it watched the network only, so an exception thrown while React
//     applied the action's result - which would leave the transition
//     pending forever, exactly the symptom - left no trace at all.
//
// So it now records every document/fetch/xhr call in both directions and
// everything the page logged or threw. A diagnostic that can only see
// one half of the wire will keep confirming whichever half it can see.
//
// And one more thing, added after the round that PASSED.
//
// The next run of the very same commit went green: the drawer closed, and
// six unrelated specs failed their first attempt instead, every one of
// them on "the write is not on the screen yet". The failing run took
// twelve minutes, the passing one seven. That is not the shape of a bug
// in one screen. It is the shape of a machine that is sometimes too busy
// to finish anything - and a browser that cannot get the CPU to complete
// a React transition looks exactly like a button that stays pending,
// while the server it is waiting on reports itself fast, because it was.
//
// So this also measures how starved the two sides are: the page reports
// how far its own timer drifted, and the test process reports the load
// average of the machine both of them share. Neither belongs in a
// product fix. Both decide whether a product fix is what is needed.

type Call = { method: string; path: string; ms: number; status?: number; failed?: string };

type Observed = {
  done: Call[];
  open: Map<string, { method: string; path: string; startedAt: number }>;
  logs: string[];
  navigations: string[];
  /// Navigation requests started and not yet finished. A navigation
  /// cancels everything the old document had in flight, and it commits
  /// AFTER that - so the navigation count alone always reads as "nothing
  /// was navigating", which is exactly backwards.
  navsInFlight: number;
  /// Set the moment the test body returns. Everything after that point is
  /// teardown, and teardown aborts every request still in flight - which
  /// is not a fault, just a page being closed.
  sealed: boolean;
};

const observed = new WeakMap<Page, Observed>();

/// Path only. The host is the same for every call here, and a full URL
/// pushes the part that differs off the end of the failure message.
function shortPath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + (u.search ? (u.search.length > 40 ? u.search.slice(0, 40) + "…" : u.search) : "");
  } catch {
    return url.slice(0, 80);
  }
}

/// Assets are noise here: this is about the app talking to the server,
/// so documents, RSC fetches and XHRs, and nothing else.
const WATCHED = new Set(["document", "fetch", "xhr"]);

/// Runs before anything on the page: a 100ms heartbeat that records how
/// late it actually fired. A tab with the CPU to itself drifts by a few
/// milliseconds. A tab that cannot get scheduled drifts by seconds, and
/// during that time it cannot finish a transition, clear a pending form
/// or render a row that already exists in the database.
const DRIFT_PROBE = `(() => {
  const period = 100;
  const w = window;
  w.__qaDrift = { max: 0, ticks: 0 };
  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    const late = now - last - period;
    last = now;
    w.__qaDrift.ticks++;
    if (late > w.__qaDrift.max) w.__qaDrift.max = Math.round(late);
  }, period);
})();`;

export function observe(page: Page): void {
  const state: Observed = { done: [], open: new Map(), logs: [], navigations: [], navsInFlight: 0, sealed: false };
  observed.set(page, state);

  // Fire and forget: a probe that failed to install must never be the
  // reason a test fails, so its own errors are swallowed and its absence
  // is reported as "not measured" rather than thrown.
  void page.addInitScript(DRIFT_PROBE).catch(() => {});

  // The key has to be unique per request object, not per URL: Next sends
  // several fetches to the same path within one transition, and a key
  // built from the URL made them overwrite each other - which is how a
  // request still in flight got reported as finished.
  const keys = new WeakMap<object, string>();
  let seq = 0;
  const keyOf = (r: object) => {
    let k = keys.get(r);
    if (!k) {
      k = String(++seq);
      keys.set(r, k);
    }
    return k;
  };

  page.on("request", (r) => {
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) state.navsInFlight++;
    if (!WATCHED.has(r.resourceType())) return;
    state.open.set(keyOf(r), { method: r.method(), path: shortPath(r.url()), startedAt: Date.now() });
  });
  page.on("requestfinished", async (r) => {
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) state.navsInFlight--;
    const started = state.open.get(keyOf(r));
    if (!started) return;
    state.open.delete(keyOf(r));
    let status: number | undefined;
    try {
      status = (await r.response())?.status();
    } catch {
      // A response that cannot be read is still a finished request; the
      // duration is the part that matters here.
    }
    state.done.push({ method: started.method, path: started.path, ms: Date.now() - started.startedAt, status });
  });
  page.on("requestfailed", (r) => {
    const navigating = state.navsInFlight > 0;
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) state.navsInFlight--;
    const started = state.open.get(keyOf(r));
    if (!started) return;
    state.open.delete(keyOf(r));
    const ms = Date.now() - started.startedAt;
    const failed = r.failure()?.errorText;
    state.done.push({ method: started.method, path: started.path, ms, failed });

    // Printed, not only stored, because this fault does not always fail a
    // test. Playwright retries once, and a Server Action that was aborted
    // and succeeded on the retry leaves a green run with no trace of the
    // thing worth knowing. The e2e check collects these lines whether the
    // run passed or not, so an intermittent fault stops depending on
    // catching it in the act.
    //
    // But only while the test is still running. The first run with this
    // turned on reported twelve abandoned requests including a write, and
    // no test failed on any of them: closing a page at the end of a test
    // aborts everything still in flight, so an unsealed recorder reports
    // ordinary teardown as if it were the fault under investigation. Once
    // that noise is in the report it is worse than no report, because it
    // is indistinguishable from the real thing.
    if (state.sealed) return;
    console.warn(
      `[abort] ${started.method} ${started.path} ${ms}ms ${failed ?? "(no reason given)"}` +
        ` (${navigating ? "WHILE NAVIGATING" : "page still"},` +
        ` at ${state.navigations.length} navigation(s), last ${state.navigations.at(-1) ?? "none"})`
    );
  });

  // A navigation is the ordinary reason a browser aborts everything it
  // had in flight, and the round that found five aborts in a row - four
  // prefetches and the Server Action itself - cannot tell that apart from
  // a cancellation with no navigation at all.
  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) return;
    state.navigations.push(shortPath(frame.url()));
  });

  // An uncaught exception on the client is the one failure mode that
  // leaves the screen looking merely slow.
  page.on("pageerror", (err) => state.logs.push(`threw: ${err.message.slice(0, 200)}`));
  page.on("console", (msg) => {
    if (msg.type() !== "error" && msg.type() !== "warning") return;
    state.logs.push(`${msg.type()}: ${msg.text().slice(0, 200)}`);
  });
}

/// One line for a failure message: what finished, what did not, and what
/// the page said while it happened.
/// Stop reporting aborts: the test body has returned and what follows is
/// Playwright closing the page, which cancels whatever was in flight.
export function seal(page: Page): void {
  const state = observed.get(page);
  if (state) state.sealed = true;
}

/// How busy the machine running all of this is. One line, read at the
/// moment of failure, from the process that shares the machine with the
/// app server, the database and the browser.
function machineLoad(): string {
  const cpus = os.cpus().length || 1;
  const [oneMinute] = os.loadavg();
  // Load per core is the comparable number: 4 on a two-core runner and 4
  // on an eight-core one are different situations.
  return `machine: ${cpus} cpu(s), load ${oneMinute.toFixed(2)} (${(oneMinute / cpus).toFixed(2)} per cpu)`;
}

/// How late the page's own heartbeat ran. Asynchronous on purpose: it has
/// to read state out of the browser, which the synchronous summary cannot.
export async function pageDrift(page: Page): Promise<string> {
  const drift = await page
    .evaluate(() => (window as unknown as { __qaDrift?: { max: number; ticks: number } }).__qaDrift)
    .catch(() => undefined);
  if (!drift) return "page timer drift: not measured";
  return `page timer drift: worst ${drift.max}ms over ${drift.ticks} ticks`;
}

export function trafficSummary(page: Page): string {
  const state = observed.get(page);
  if (!state) return `traffic was not recorded. ${machineLoad()}`;

  const done = state.done.slice(-5);
  const stillOpen = [...state.open.values()].map((o) => `${o.method} ${o.path} ${Date.now() - o.startedAt}ms and counting`);
  const logs = state.logs.slice(-5);

  return [
    done.length
      ? `last calls: ${done
          .map((c) => `${c.method} ${c.path} ${c.ms}ms${c.status ? ` (${c.status})` : ""}${c.failed ? ` (${c.failed})` : ""}`)
          .join(" | ")}`
      : "no call was ever sent",
    stillOpen.length ? `in flight: ${stillOpen.join(" | ")}` : "nothing in flight",
    logs.length ? `page said: ${logs.join(" | ")}` : "page said nothing",
    `main frame went: ${state.navigations.slice(-4).join(" -> ") || "nowhere"}`,
    machineLoad(),
  ].join(". ");
}
