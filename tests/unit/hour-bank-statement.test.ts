import { describe, expect, it } from "vitest";
import { asOfCutoff, buildHourBankStatement, pickBank, type StatementInput } from "@/lib/app-domain/hour-bank-statement";
import { localDateTimeToUtc } from "@/lib/timezone";

// 1.11.2026: get_hours_bank's arithmetic. Pure functions only.

const il = (day: string, time = "00:00") => localDateTimeToUtc(day, time);

const entry = (day: string, time: string, minutes: number) => ({
  actualSeconds: minutes * 60,
  billableSeconds: minutes * 60,
  taskId: null,
  startAt: il(day, time),
});

// A previous package that overran by 126 minutes, then a 30-hour package
// loaded on 12.10.2026 carrying that overrun in.
const previous = {
  id: "p1",
  kind: "PREPAID" as const,
  cycleStart: il("2026-09-01"),
  cycleEnd: il("2026-10-12", "10:00"),
  purchasedMinutes: 600,
  rolloverInMinutes: 0,
  status: "CLOSED" as const,
};
const current = {
  id: "p2",
  kind: "PREPAID" as const,
  cycleStart: il("2026-10-12", "10:00"),
  cycleEnd: il("2027-10-12"),
  purchasedMinutes: 1800,
  rolloverInMinutes: -126,
  status: "OPEN" as const,
};

function input(over: Partial<StatementInput> = {}): StatementInput {
  return {
    banks: [current, previous],
    adjustments: [
      { id: "a1", hourBankId: "p2", minutes: 30, reason: "שעת היכרות על חשבוננו", effectiveAt: il("2026-10-20", "09:00") },
      { id: "a2", hourBankId: "p2", minutes: -15, reason: "תיקון", effectiveAt: il("2026-11-01", "08:00") },
    ],
    entries: [
      entry("2026-09-10", "10:00", 726), // previous package: 600 + 126 overrun
      entry("2026-10-13", "09:00", 900),
      entry("2026-10-31", "23:30", 600), // still 31.10 in Israel
      entry("2026-11-01", "00:10", 120), // 1.11 in Israel, after the cut
    ],
    policy: null,
    cutoff: null,
    now: il("2026-11-01", "12:00"),
    ...over,
  };
}

describe("asOfCutoff: the end of the day in Israel, exclusive", () => {
  it("31.10.2026 ends at Israel midnight going into 1.11", () => {
    expect(asOfCutoff("2026-10-31")?.toISOString()).toBe(il("2026-11-01").toISOString());
  });
  it("rejects anything that is not YYYY-MM-DD", () => {
    expect(asOfCutoff("31.10.2026")).toBeUndefined();
  });
});

describe("pickBank", () => {
  it("without a date: the package covering now", () => {
    expect(pickBank([previous, current], null, il("2026-11-01"))?.id).toBe("p2");
  });
  it("as of the day before a load: the package that was running", () => {
    expect(pickBank([previous, current], asOfCutoff("2026-10-11")!, il("2026-11-01"))?.id).toBe("p1");
  });
  it("as of the day of a load: the new package", () => {
    expect(pickBank([previous, current], asOfCutoff("2026-10-12")!, il("2026-11-01"))?.id).toBe("p2");
  });
  it("before any package: none", () => {
    expect(pickBank([previous, current], asOfCutoff("2026-08-01")!, il("2026-11-01"))).toBeNull();
  });
});

describe("buildHourBankStatement", () => {
  it("as of 31.10.2026: entries up to Israel midnight, adjustments that took effect by then", () => {
    const s = buildHourBankStatement(input({ cutoff: asOfCutoff("2026-10-31")! }));
    const a = s.active!;
    expect(a.id).toBe("p2");
    expect(a.utilization.consumedMinutes).toBe(1500);
    expect(a.utilization.adjustmentMinutes).toBe(30);
    expect(a.utilization.totalMinutes).toBe(1800 - 126 + 30);
    expect(a.utilization.remainingMinutes).toBe(1704 - 1500);
    // The screen's "נוצל" tile for a package: what is gone of the 30 hours.
    expect(a.usedMinutes).toBe(1800 - 204);
    expect(a.cardTotalMinutes).toBe(1800);
    expect(a.adjustments.map((x) => x.id)).toEqual(["a1"]);
  });

  it("without a date: every adjustment counts, as on the screen", () => {
    const a = buildHourBankStatement(input()).active!;
    expect(a.utilization.consumedMinutes).toBe(1620);
    expect(a.utilization.adjustmentMinutes).toBe(15);
    expect(a.utilization.remainingMinutes).toBe(1800 - 126 + 15 - 1620);
  });

  it("a balance can be negative", () => {
    const a = buildHourBankStatement(input({ entries: [entry("2026-10-13", "09:00", 2000)] })).active!;
    expect(a.utilization.remainingMinutes).toBe(1800 - 126 + 15 - 2000);
    expect(a.utilization.remainingMinutes).toBeLessThan(0);
  });

  it("lists the previous package with its closing balance", () => {
    const s = buildHourBankStatement(input({ cutoff: asOfCutoff("2026-10-31")! }));
    expect(s.previous).toHaveLength(1);
    expect(s.previous[0].id).toBe("p1");
    expect(s.previous[0].utilization.remainingMinutes).toBe(-126);
  });

  it("newPackageLoadedSince: true for a week that holds the load, false for the week after", () => {
    const cutoff = asOfCutoff("2026-10-17")!;
    expect(buildHourBankStatement(input({ cutoff, since: il("2026-10-11") })).newPackageLoadedSince).toBe(true);
    const later = asOfCutoff("2026-10-24")!;
    expect(buildHourBankStatement(input({ cutoff: later, since: il("2026-10-18") })).newPackageLoadedSince).toBe(false);
    expect(buildHourBankStatement(input({ cutoff: later })).newPackageLoadedSince).toBeNull();
  });

  it("an expired open package reads as closed without being written", () => {
    const s = buildHourBankStatement(input({ banks: [{ ...current, cycleEnd: il("2026-10-30") }, previous] }));
    expect(s.active!.status).toBe("CLOSED");
  });

  it("a client with no bank", () => {
    expect(buildHourBankStatement(input({ banks: [] }))).toEqual({ active: null, previous: [], newPackageLoadedSince: null });
  });
});
