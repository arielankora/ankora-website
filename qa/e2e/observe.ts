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

type Call = { method: string; path: string; ms: number; status?: number; failed?: string };

type Observed = {
  done: Call[];
  open: Map<string, { method: string; path: string; startedAt: number }>;
  logs: string[];
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

export function observe(page: Page): void {
  const state: Observed = { done: [], open: new Map(), logs: [] };
  observed.set(page, state);

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
    if (!WATCHED.has(r.resourceType())) return;
    state.open.set(keyOf(r), { method: r.method(), path: shortPath(r.url()), startedAt: Date.now() });
  });
  page.on("requestfinished", async (r) => {
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
    const started = state.open.get(keyOf(r));
    if (!started) return;
    state.open.delete(keyOf(r));
    state.done.push({
      method: started.method,
      path: started.path,
      ms: Date.now() - started.startedAt,
      failed: r.failure()?.errorText,
    });
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
export function trafficSummary(page: Page): string {
  const state = observed.get(page);
  if (!state) return "traffic was not recorded";

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
  ].join(". ");
}
