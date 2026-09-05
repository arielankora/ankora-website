import { describe, expect, it } from "vitest";
import {
  currentValueForThreshold,
  isThresholdBreached,
  decideAlertAction,
} from "@/lib/app-domain/alerts";

// Phase 4 - spec 9.1's four threshold types and the ADR 11.3 dedupe/
// retrigger algorithm. Pure-function tests only, no database (same
// approach as Phase 3's hour-banks.test.ts).

const snapshot = {
  totalMinutes: 1000,
  consumedMinutes: 800,
  remainingMinutes: 200,
  utilizationPct: 80,
};

describe("currentValueForThreshold() - spec 9.1", () => {
  it("reads utilizationPct for UTILIZATION_PCT", () => {
    expect(currentValueForThreshold("UTILIZATION_PCT", snapshot)).toBe(80);
  });

  it("reads remainingMinutes for REMAINING_MINUTES", () => {
    expect(currentValueForThreshold("REMAINING_MINUTES", snapshot)).toBe(200);
  });

  it("reads consumedMinutes for CONSUMED_MINUTES", () => {
    expect(currentValueForThreshold("CONSUMED_MINUTES", snapshot)).toBe(800);
  });

  it("computes overage as consumed - total, floored at zero, for OVERAGE", () => {
    expect(currentValueForThreshold("OVERAGE", snapshot)).toBe(0);
    const overrun = { totalMinutes: 1000, consumedMinutes: 1200, remainingMinutes: -200, utilizationPct: 120 };
    expect(currentValueForThreshold("OVERAGE", overrun)).toBe(200);
  });
});

describe("isThresholdBreached() - spec 9.1", () => {
  it("fires UTILIZATION_PCT/CONSUMED_MINUTES/OVERAGE when the value rises to or above the threshold", () => {
    expect(isThresholdBreached("UTILIZATION_PCT", 80, 80)).toBe(true);
    expect(isThresholdBreached("UTILIZATION_PCT", 80, 79)).toBe(false);
    expect(isThresholdBreached("CONSUMED_MINUTES", 500, 500)).toBe(true);
    expect(isThresholdBreached("OVERAGE", 0, 1)).toBe(true);
  });

  it("fires REMAINING_MINUTES when the value drops to or below the threshold (inverted)", () => {
    expect(isThresholdBreached("REMAINING_MINUTES", 60, 60)).toBe(true);
    expect(isThresholdBreached("REMAINING_MINUTES", 60, 61)).toBe(false);
    expect(isThresholdBreached("REMAINING_MINUTES", 60, 0)).toBe(true);
  });
});

describe("decideAlertAction() - ADR 11.3 dedupe/retrigger", () => {
  it("fires on the first breach for a (rule, hourBank) pair that has never fired before", () => {
    expect(decideAlertAction(true, false, false, false)).toBe("fire");
  });

  it("does nothing while already breached with an open unresolved event (no duplicate emails)", () => {
    expect(decideAlertAction(true, false, true, true)).toBe("none");
    expect(decideAlertAction(true, true, true, true)).toBe("none");
  });

  it("does not refire after resolution when allowRetrigger is false", () => {
    expect(decideAlertAction(true, false, true, false)).toBe("none");
  });

  it("refires after resolution when allowRetrigger is true", () => {
    expect(decideAlertAction(true, true, true, false)).toBe("fire");
  });

  it("resolves an open event once the value drops back below threshold", () => {
    expect(decideAlertAction(false, false, true, true)).toBe("resolve");
  });

  it("does nothing when not breached and there is no open event", () => {
    expect(decideAlertAction(false, false, false, false)).toBe("none");
    expect(decideAlertAction(false, true, true, false)).toBe("none");
  });
});
