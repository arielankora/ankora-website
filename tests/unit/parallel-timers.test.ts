import { describe, expect, it } from "vitest";
import {
  decideTimerReopen,
  decideTimerStart,
  MAX_PARALLEL_TIMERS,
  parallelSeconds,
} from "@/lib/app-domain/parallel-timers";

// Parallel timers (Ariel, 5.10.2026). The rule every start path asks:
// at most MAX_PARALLEL_TIMERS, never two on one client, the second only
// after an explicit yes.

const A = { id: "t1", clientId: "client-a" };
const B = { id: "t2", clientId: "client-b" };

describe("decideTimerStart()", () => {
  it("is two, as decided", () => {
    expect(MAX_PARALLEL_TIMERS).toBe(2);
  });

  it("starts freely when nothing is running", () => {
    expect(decideTimerStart({ running: [], clientId: "client-a", confirmParallel: false })).toEqual({
      allowed: true,
      parallel: false,
    });
  });

  it("asks before a second timer on another client", () => {
    expect(decideTimerStart({ running: [A], clientId: "client-b", confirmParallel: false })).toEqual({
      allowed: false,
      reason: "needs_confirmation",
    });
  });

  it("starts the second timer once confirmed, and says it runs in parallel", () => {
    expect(decideTimerStart({ running: [A], clientId: "client-b", confirmParallel: true })).toEqual({
      allowed: true,
      parallel: true,
    });
  });

  it("never allows a second timer on the same client, confirmed or not", () => {
    for (const confirmParallel of [false, true]) {
      expect(decideTimerStart({ running: [A], clientId: "client-a", confirmParallel })).toEqual({
        allowed: false,
        reason: "same_client",
      });
    }
  });

  it("refuses a third timer even when confirmed", () => {
    expect(decideTimerStart({ running: [A, B], clientId: "client-c", confirmParallel: true })).toEqual({
      allowed: false,
      reason: "limit",
    });
  });

  it("reports the same-client collision before the limit", () => {
    // "Stop one of the two" would not help: this client already has one.
    expect(decideTimerStart({ running: [A, B], clientId: "client-a", confirmParallel: true }).allowed).toBe(false);
    expect(decideTimerStart({ running: [A, B], clientId: "client-a", confirmParallel: true })).toMatchObject({
      reason: "same_client",
    });
  });

  it("does not ask for confirmation of something the limit refuses anyway", () => {
    expect(decideTimerStart({ running: [A, B], clientId: "client-c", confirmParallel: false })).toMatchObject({
      reason: "limit",
    });
  });
});

describe("decideTimerReopen()", () => {
  it("reopens next to another client's timer without asking again", () => {
    expect(decideTimerReopen({ running: [B], clientId: "client-a" })).toEqual({ allowed: true, parallel: true });
  });

  it("keeps the two hard rules", () => {
    expect(decideTimerReopen({ running: [A], clientId: "client-a" })).toMatchObject({ reason: "same_client" });
    expect(decideTimerReopen({ running: [A, B], clientId: "client-c" })).toMatchObject({ reason: "limit" });
  });
});

describe("parallelSeconds()", () => {
  const at = (hhmm: string) => new Date(`2026-10-05T${hhmm}:00Z`);

  it("is zero for entries that follow each other", () => {
    const r = parallelSeconds([
      { startAt: at("09:00"), endAt: at("10:00") },
      { startAt: at("10:00"), endAt: at("11:00") },
    ]);
    expect(r).toEqual({ reportedSeconds: 7200, wallClockSeconds: 7200, parallelSeconds: 0 });
  });

  it("counts the hour two clients shared once on the clock and twice in the report", () => {
    const r = parallelSeconds([
      { startAt: at("10:00"), endAt: at("11:00") },
      { startAt: at("10:00"), endAt: at("11:00") },
    ]);
    expect(r).toEqual({ reportedSeconds: 7200, wallClockSeconds: 3600, parallelSeconds: 3600 });
  });

  it("handles a partial overlap and an unsorted input", () => {
    const r = parallelSeconds([
      { startAt: at("10:30"), endAt: at("12:00") },
      { startAt: at("09:00"), endAt: at("11:00") },
    ]);
    // 09:00-12:00 on the clock, 2h + 1.5h reported, 10:30-11:00 shared.
    expect(r).toEqual({ reportedSeconds: 12600, wallClockSeconds: 10800, parallelSeconds: 1800 });
  });

  it("accepts ISO strings, as the timer screen passes them", () => {
    const r = parallelSeconds([
      { startAt: "2026-10-05T10:00:00Z", endAt: "2026-10-05T10:30:00Z" },
      { startAt: "2026-10-05T10:10:00Z", endAt: "2026-10-05T10:20:00Z" },
    ]);
    expect(r.parallelSeconds).toBe(600);
  });

  it("is zero for nothing", () => {
    expect(parallelSeconds([])).toEqual({ reportedSeconds: 0, wallClockSeconds: 0, parallelSeconds: 0 });
  });
});
