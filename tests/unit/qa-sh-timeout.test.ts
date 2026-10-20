import { describe, it, expect } from "vitest";
import { sh, timedOutFinding } from "../../qa/lib/sh.mjs";

// Does the subprocess budget actually stop the work?
//
// Until 20.10.2026 it did not. `child.kill()` signals the direct child, and
// everything expensive in this suite runs through a wrapper: `npx vitest`,
// `npx next build`, `npx tsc`. Killing npx left the real process running and
// holding the inherited pipes, so `close` fired only when the work finished
// by itself. The budget killed a wrapper and then waited for what it had
// failed to stop.
//
// Nobody noticed because the result still looked fine. Run #514: integration
// took 22.0 minutes against a 15-minute budget, integration-utc 18.4 against
// the same 15, coverage about 26 against 25. Three over budget, three passes.
//
// This test is the measurement, not the argument. A parent whose grandchild
// outlives it is exactly the npx shape.

/** A parent that spawns a grandchild inheriting stdout, then waits forever. */
const PARENT_WITH_GRANDCHILD = `
  node -e 'const{spawn}=require("child_process");
    const c=spawn("node",["-e","setTimeout(()=>{console.log(\\"GRANDCHILD FINISHED\\")},5000)"],{stdio:["ignore","inherit","inherit"]});
    c.unref();
    setInterval(()=>{},1000);'
`;

describe("the subprocess budget", () => {
  it("returns at the budget, not when the grandchild finishes", async () => {
    const started = Date.now();
    const r = await sh("bash", ["-c", PARENT_WITH_GRANDCHILD], { timeoutMs: 1500 });
    const elapsed = Date.now() - started;

    // The old behaviour returned at ~5000ms with the grandchild's line in
    // `all`. Both halves are asserted: a kill that returns promptly but
    // leaves the work running is the same bug wearing a better coat.
    expect(elapsed).toBeLessThan(4000);
    expect(r.all).not.toContain("GRANDCHILD FINISHED");
    expect(r.timedOut).toBe(true);
  }, 20_000);

  it("does not call an ordinary run timed out", async () => {
    const r = await sh("bash", ["-c", "echo hello"], { timeoutMs: 10_000 });
    expect(r.timedOut).toBe(false);
    expect(r.code).toBe(0);
    expect(r.all).toContain("hello");
  }, 20_000);

  it("reports the budget it was given, so a finding can name it", async () => {
    const r = await sh("bash", ["-c", "sleep 5"], { timeoutMs: 1000 });
    expect(r.timedOut).toBe(true);
    expect(r.timeoutMs).toBe(1000);
  }, 20_000);
});

describe("how a stopped run is reported", () => {
  it("is a blocker that says it was stopped, not that it failed", () => {
    const f = timedOutFinding({ timedOut: true, timeoutMs: 15 * 60_000, all: "some output" }, "Integration tests");
    expect(f?.severity).toBe("blocker");
    expect(f?.title).toContain("Integration tests");
    expect(f?.title).toContain("15 minutes");
    // The distinction this suite keeps paying to relearn.
    expect(f?.detail).toContain("Do not read this as a pass");
  });

  it("stays out of the way when nothing was stopped", () => {
    expect(timedOutFinding({ timedOut: false }, "x")).toBeNull();
    expect(timedOutFinding({}, "x")).toBeNull();
    expect(timedOutFinding(null, "x")).toBeNull();
  });
});
