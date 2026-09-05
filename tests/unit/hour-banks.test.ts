import { describe, expect, it } from "vitest";
import { computeUtilization, computeRolloverInMinutes } from "@/lib/app-domain/hour-banks";

// Phase 3 - spec 8.3's utilization formula and 8.2's rollover modes.
// Pure-function tests only, no database.

describe("computeUtilization() - spec 8.3", () => {
  it("computes total/remaining/utilization% from purchased + rollover + adjustments", () => {
    const u = computeUtilization({ purchasedMinutes: 100, rolloverInMinutes: 20 }, 10, 65);
    expect(u.totalMinutes).toBe(130);
    expect(u.remainingMinutes).toBe(65);
    expect(u.utilizationPct).toBe(50);
  });

  it("guards against divide-by-zero on an empty bank (spec 8.3 explicit requirement)", () => {
    const u = computeUtilization({ purchasedMinutes: 0, rolloverInMinutes: 0 }, 0, 0);
    expect(u.totalMinutes).toBe(0);
    expect(u.utilizationPct).toBe(0);
    expect(Number.isFinite(u.utilizationPct)).toBe(true);
  });

  it("allows utilization over 100% when a client overruns its bank", () => {
    const u = computeUtilization({ purchasedMinutes: 100, rolloverInMinutes: 0 }, 0, 150);
    expect(u.utilizationPct).toBe(150);
    expect(u.remainingMinutes).toBe(-50);
  });

  it("rounds utilization% to one decimal place", () => {
    const u = computeUtilization({ purchasedMinutes: 300, rolloverInMinutes: 0 }, 0, 100);
    expect(u.utilizationPct).toBe(33.3);
  });
});

describe("computeRolloverInMinutes() - spec 8.2's four rollover modes", () => {
  const closedCycle = {
    purchasedMinutes: 100,
    rolloverInMinutes: 0,
    consumedMinutes: 40,
  };

  it("NONE never rolls anything forward, even with unused minutes", () => {
    expect(
      computeRolloverInMinutes({ ...closedCycle, rolloverMode: "NONE" as const, rolloverCapMinutes: null }, 0, undefined)
    ).toBe(0);
  });

  it("FULL rolls forward every unused minute", () => {
    expect(
      computeRolloverInMinutes({ ...closedCycle, rolloverMode: "FULL" as const, rolloverCapMinutes: null }, 0, undefined)
    ).toBe(60); // 100 - 40
  });

  it("FULL never rolls forward a negative remainder when the client overran", () => {
    const overrun = { purchasedMinutes: 100, rolloverInMinutes: 0, consumedMinutes: 150 };
    expect(
      computeRolloverInMinutes({ ...overrun, rolloverMode: "FULL" as const, rolloverCapMinutes: null }, 0, undefined)
    ).toBe(0);
  });

  it("CAPPED rolls forward the lesser of the unused minutes and the cap", () => {
    expect(
      computeRolloverInMinutes({ ...closedCycle, rolloverMode: "CAPPED" as const, rolloverCapMinutes: 30 }, 0, undefined)
    ).toBe(30); // min(60, 30)
    expect(
      computeRolloverInMinutes({ ...closedCycle, rolloverMode: "CAPPED" as const, rolloverCapMinutes: 90 }, 0, undefined)
    ).toBe(60); // min(60, 90)
  });

  it("MANUAL ignores the formula entirely and uses the admin-supplied number", () => {
    expect(
      computeRolloverInMinutes({ ...closedCycle, rolloverMode: "MANUAL" as const, rolloverCapMinutes: null }, 0, 25)
    ).toBe(25);
    // No override supplied defaults to 0 rather than throwing.
    expect(
      computeRolloverInMinutes({ ...closedCycle, rolloverMode: "MANUAL" as const, rolloverCapMinutes: null }, 0, undefined)
    ).toBe(0);
  });

  it("factors manual adjustments into the previous cycle's total before computing the unused remainder", () => {
    // total = 100 purchased + 20 adjustment = 120; consumed 40 => 80 unused.
    expect(
      computeRolloverInMinutes({ ...closedCycle, rolloverMode: "FULL" as const, rolloverCapMinutes: null }, 20, undefined)
    ).toBe(80);
  });
});
