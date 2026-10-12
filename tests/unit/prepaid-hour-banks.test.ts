import { describe, expect, it } from "vitest";
import {
  computeUtilization,
  prepaidUtilizationPct,
  prepaidCarryInMinutes,
  projectDepletion,
  defaultPackageExpiry,
  BURN_MIN_ENTRIES,
} from "@/lib/app-domain/hour-banks";
import { isFullPackageRule, prepaidClientAlertLines, isThresholdBreached } from "@/lib/app-domain/alerts";
import { packageFigures } from "@/lib/hours-format";
import { describeForecast, forecastCell } from "@/lib/prepaid-format";
import { localDateKey } from "@/lib/timezone";

// 12.10.2026 (RIMED): prepaid hour packages. Pure functions only.

describe("prepaid utilization: a percentage of the package loaded (Ariel, 12.10.2026)", () => {
  it("80% of a 30-hour package is 24 hours used", () => {
    const u = computeUtilization({ kind: "PREPAID", purchasedMinutes: 1800, rolloverInMinutes: 0 }, 0, 1440);
    expect(u.utilizationPct).toBe(80);
    expect(u.remainingMinutes).toBe(360);
  });

  it("an overrun carried in counts as already used: 30 hours with -2.10 carried, 21.90 used is 80%", () => {
    const u = computeUtilization({ kind: "PREPAID", purchasedMinutes: 1800, rolloverInMinutes: -126 }, 0, 1314);
    expect(u.totalMinutes).toBe(1674);
    expect(u.utilizationPct).toBe(80);
  });

  it("is not the cycle formula: the same figures on a cycle read 78.5%", () => {
    const u = computeUtilization({ kind: "CYCLE", purchasedMinutes: 1800, rolloverInMinutes: -126 }, 0, 1314);
    expect(u.utilizationPct).toBe(78.5);
  });

  it("a balance carried in is used first and never shows below 0%", () => {
    expect(prepaidUtilizationPct(1800, 1800 + 300)).toBe(0);
    const u = computeUtilization({ kind: "PREPAID", purchasedMinutes: 1800, rolloverInMinutes: 300 }, 0, 300);
    expect(u.utilizationPct).toBe(0);
  });

  it("100% is the moment nothing is left, and an overrun goes past it", () => {
    expect(prepaidUtilizationPct(1800, 0)).toBe(100);
    expect(prepaidUtilizationPct(1800, -180)).toBe(110);
  });

  it("a package with no hours bought is 0% until it is overdrawn", () => {
    expect(prepaidUtilizationPct(0, 0)).toBe(0);
    expect(prepaidUtilizationPct(0, -10)).toBe(100);
  });

  it("the default rules fire at 80% and 100% of the package", () => {
    const at = (consumed: number) =>
      computeUtilization({ kind: "PREPAID", purchasedMinutes: 1800, rolloverInMinutes: -126 }, 0, consumed).utilizationPct;
    expect(isThresholdBreached("UTILIZATION_PCT", 80, at(1313))).toBe(false);
    expect(isThresholdBreached("UTILIZATION_PCT", 80, at(1314))).toBe(true);
    expect(isThresholdBreached("UTILIZATION_PCT", 100, at(1673))).toBe(false);
    expect(isThresholdBreached("UTILIZATION_PCT", 100, at(1674))).toBe(true);
  });
});

describe("packageFigures: the tiles agree with the percentage", () => {
  it("size 30.00, used 24.00, left 6.00", () => {
    expect(packageFigures(1800, 360)).toMatchObject({ total: "30.00", consumed: "24.00", remaining: "6.00", overdrawn: false });
  });
  it("an overrun reads as overdrawn", () => {
    expect(packageFigures(1800, -60)).toMatchObject({ consumed: "31.00", overdrawn: true });
  });
});

describe("prepaidCarryInMinutes: what moves to the next package", () => {
  it("the whole balance while the previous one is still valid", () => {
    expect(prepaidCarryInMinutes(300, true)).toBe(300);
    expect(prepaidCarryInMinutes(-126, true)).toBe(-126);
  });
  it("after expiry only an overrun moves", () => {
    expect(prepaidCarryInMinutes(300, false)).toBe(0);
    expect(prepaidCarryInMinutes(-126, false)).toBe(-126);
  });
});

describe("projectDepletion: when the hours run out", () => {
  const now = new Date("2026-10-12T09:00:00Z");

  it("at 10 hours a week, 20 hours left last two weeks", () => {
    const f = projectDepletion({ remainingMinutes: 1200, consumedInWindowMinutes: 2400, entriesInWindow: 12, now });
    expect(f.status).toBe("projected");
    if (f.status !== "projected") return;
    expect(f.weeklyMinutes).toBe(600);
    expect(f.daysLeft).toBe(14);
    expect(f.depletionDate.toISOString()).toBe("2026-10-26T09:00:00.000Z");
  });

  it(`fewer than ${BURN_MIN_ENTRIES} entries is not a pace`, () => {
    expect(projectDepletion({ remainingMinutes: 600, consumedInWindowMinutes: 300, entriesInWindow: 3, now }).status).toBe(
      "insufficient_data"
    );
  });

  it("no hours in four weeks is not a pace either", () => {
    expect(projectDepletion({ remainingMinutes: 600, consumedInWindowMinutes: 0, entriesInWindow: 6, now }).status).toBe(
      "insufficient_data"
    );
  });

  it("nothing left is depleted, whatever the pace", () => {
    expect(projectDepletion({ remainingMinutes: 0, consumedInWindowMinutes: 2400, entriesInWindow: 12, now }).status).toBe(
      "depleted"
    );
    expect(projectDepletion({ remainingMinutes: -30, consumedInWindowMinutes: 0, entriesInWindow: 0, now }).status).toBe(
      "depleted"
    );
  });
});

describe("defaultPackageExpiry: one year, Israel midnight", () => {
  it("11.10.2026 expires 11.10.2027", () => {
    const start = new Date("2026-10-10T21:00:00Z"); // 11.10 00:00 in Israel
    const end = defaultPackageExpiry(start);
    expect(localDateKey(end)).toBe("2027-10-11");
    expect(end.toISOString()).toBe("2027-10-10T21:00:00.000Z");
  });
  it("29.2 rolls to 1.3", () => {
    expect(localDateKey(defaultPackageExpiry(new Date("2028-02-28T22:00:00Z")))).toBe("2029-03-01");
  });
});

describe("the client wording of a package alert", () => {
  it("80%: how much is left", () => {
    const lines = prepaidClientAlertLines(
      { type: "UTILIZATION_PCT", thresholdValue: 80 },
      { utilizationPct: 80, remainingMinutes: 360 }
    );
    expect(lines.join(" ")).toContain("נוצלו 80% מחבילת השעות האחרונה");
    expect(lines.join(" ")).toContain("נותרו 6.00 שעות");
  });
  it("100%: further hours come off the next load", () => {
    const text = prepaidClientAlertLines(
      { type: "UTILIZATION_PCT", thresholdValue: 100 },
      { utilizationPct: 103.3, remainingMinutes: -60 }
    ).join(" ");
    expect(text).toContain("נוצלה במלואה");
    expect(text).toContain("1.00");
    expect(text).toContain("יקוזזו מהטעינה הבאה");
  });
  it("knows which rules mean 'all of it'", () => {
    expect(isFullPackageRule({ type: "UTILIZATION_PCT", thresholdValue: 100 })).toBe(true);
    expect(isFullPackageRule({ type: "OVERAGE", thresholdValue: 0 })).toBe(true);
    expect(isFullPackageRule({ type: "UTILIZATION_PCT", thresholdValue: 80 })).toBe(false);
  });
});

describe("forecast wording", () => {
  it("is null for a cycle", () => {
    expect(describeForecast(null)).toBeNull();
    expect(forecastCell(null)).toBe("");
  });
  it("names the date and the pace", () => {
    const text = describeForecast({
      status: "projected",
      weeklyMinutes: 450,
      depletionDate: new Date("2026-11-02T10:00:00Z"),
      daysLeft: 21,
    });
    expect(text).toContain("7.50 שעות בשבוע");
    expect(text).toMatch(/2026/);
  });
  it("contains no dash separators", () => {
    for (const f of [
      { status: "depleted", weeklyMinutes: null } as const,
      { status: "insufficient_data", weeklyMinutes: null } as const,
    ]) {
      expect(describeForecast(f)).not.toMatch(/[\u2013\u2014]/);
    }
  });
});
