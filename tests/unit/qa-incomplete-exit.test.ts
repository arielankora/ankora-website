import { describe, it, expect } from "vitest";
import { Run } from "../../qa/lib/report.mjs";

// "A skipped check is not a passed check", and the exit code now agrees.
//
// Run.verdict has said "INCOMPLETE - some checks did not run" since
// September, written after a run reported PASS while the integration suite
// and the entire browser suite had quietly skipped themselves on a preflight
// bug. The verdict was fixed; the exit code was left alone. So the words said
// one thing and the green tick said another, and the green tick is what
// people read. It cost a weekly hunt on 20.10, when three sharded jobs
// reported success having run nothing.

type Check = { id: string; label: string; status: string; blocking: boolean; ms: number; findings: unknown[]; reason?: string };

const check = (o: Partial<Check>): Check =>
  ({ id: "x", label: "x", status: "pass", blocking: true, ms: 0, findings: [], ...o }) as Check;

const runWith = (checks: Check[]) => {
  const r = new Run(2);
  r.checks = checks;
  return r;
};

describe("when a run should exit non-zero", () => {
  it("passes a clean run", () => {
    const r = runWith([check({ id: "unit" }), check({ id: "lint", status: "warn" })]);
    expect(r.shouldFail).toBe(false);
    expect(r.verdict).toMatch(/^PASS/);
  });

  it("fails a run with a blocking failure", () => {
    const r = runWith([check({ id: "unit", status: "fail" })]);
    expect(r.shouldFail).toBe(true);
  });

  // The one this is all about.
  it("fails a run where a blocking check never ran", () => {
    const r = runWith([
      check({ id: "lint" }),
      check({ id: "integration", status: "skipped", reason: "no database reachable" }),
    ]);
    expect(r.failed).toBe(false);
    expect(r.incomplete).toBe(true);
    expect(r.verdict).toContain("INCOMPLETE");
    expect(r.shouldFail).toBe(true);
  });

  // The narrowing that makes the rule safe to apply everywhere: the
  // production probe reaches a machine nobody here controls, so it no longer
  // blocks. A runner with no egress must not turn the gate red for weather.
  it("does not fail on a skipped check that is not blocking", () => {
    const r = runWith([
      check({ id: "lint" }),
      check({ id: "production", status: "skipped", blocking: false, reason: "production not reachable from here" }),
    ]);
    expect(r.incomplete).toBe(false);
    expect(r.shouldFail).toBe(false);
    expect(r.verdict).toMatch(/^PASS/);
  });

  it("treats a blocking failure and a blocking skip the same way at the exit", () => {
    const failed = runWith([check({ id: "a", status: "fail" })]);
    const skipped = runWith([check({ id: "a", status: "skipped" })]);
    expect(failed.shouldFail).toBe(skipped.shouldFail);
  });
});
