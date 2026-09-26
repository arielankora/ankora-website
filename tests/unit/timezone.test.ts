import { describe, expect, it } from "vitest";
import { dayEndInZone, dayStartInZone, localDateKey, localDateTimeToUtc } from "@/lib/timezone";

// Phase 8 regression tests: spec section 24's pre-production checklist item
// "Timezone tests around midnight/month boundary" was previously untested,
// which is exactly why the toISOString()-based date grouping bug in
// reports.ts/client-portal.ts/report-schedules.ts shipped unnoticed across
// Phases 5-6 - see docs/adr/0001, Phase 8 addendum section 15.3.
describe("localDateKey()", () => {
  it("reports the Israel-local day, not the UTC day, in winter (IST, UTC+2)", () => {
    // 2025-12-31T22:30:00Z is 2026-01-01 00:30 in Israel (winter, +2).
    // toISOString().slice(0, 10) would incorrectly say "2025-12-31".
    const d = new Date("2025-12-31T22:30:00Z");
    expect(localDateKey(d)).toBe("2026-01-01");
    expect(d.toISOString().slice(0, 10)).toBe("2025-12-31"); // documents the bug this fixes
  });

  it("reports the Israel-local day, not the UTC day, in summer (IDT, UTC+3)", () => {
    // 2026-08-31T21:30:00Z is 2026-09-01 00:30 in Israel (summer, +3).
    const d = new Date("2026-08-31T21:30:00Z");
    expect(localDateKey(d)).toBe("2026-09-01");
    expect(d.toISOString().slice(0, 10)).toBe("2026-08-31"); // documents the bug this fixes
  });

  it("agrees with the UTC day when the instant is well inside both calendars' daytime", () => {
    const d = new Date("2026-06-15T10:00:00Z");
    expect(localDateKey(d)).toBe("2026-06-15");
  });

  it("accepts an arbitrary timeZone override", () => {
    const d = new Date("2026-01-01T02:00:00Z");
    expect(localDateKey(d, "UTC")).toBe("2026-01-01");
    expect(localDateKey(d, "America/Los_Angeles")).toBe("2025-12-31");
  });
});

describe("localDateTimeToUtc()", () => {
  it("round-trips through localDateKey for a Jerusalem wall-clock midnight in winter", () => {
    const utc = localDateTimeToUtc("2026-01-01", "00:00", "Asia/Jerusalem");
    expect(utc.toISOString()).toBe("2025-12-31T22:00:00.000Z");
    expect(localDateKey(utc)).toBe("2026-01-01");
  });

  it("round-trips through localDateKey for a Jerusalem wall-clock midnight in summer (DST)", () => {
    const utc = localDateTimeToUtc("2026-09-01", "00:00", "Asia/Jerusalem");
    expect(utc.toISOString()).toBe("2026-08-31T21:00:00.000Z");
    expect(localDateKey(utc)).toBe("2026-09-01");
  });
});

// 26.9.2026: report date filters now mean Israel's day, not the server's.
describe("dayStartInZone / dayEndInZone - a report's date filter", () => {
  it("starts an Israeli summer day at 21:00 UTC the evening before", () => {
    expect(dayStartInZone("2026-09-26")?.toISOString()).toBe("2026-09-25T21:00:00.000Z");
  });

  it("ends it one millisecond before the next Israeli midnight", () => {
    expect(dayEndInZone("2026-09-26")?.toISOString()).toBe("2026-09-26T20:59:59.999Z");
  });

  it("uses winter time after the clocks change", () => {
    expect(dayStartInZone("2026-12-01")?.toISOString()).toBe("2026-11-30T22:00:00.000Z");
  });

  it("keeps a DST change inside the day: the October change day is 25 hours long", () => {
    // Israel leaves summer time on Sunday 25.10.2026.
    const start = dayStartInZone("2026-10-25")!;
    const end = dayEndInZone("2026-10-25")!;
    expect((end.getTime() + 1 - start.getTime()) / 3600_000).toBe(25);
  });

  it("refuses anything that is not a YYYY-MM-DD date", () => {
    expect(dayStartInZone("26/09/2026")).toBeUndefined();
    expect(dayStartInZone("")).toBeUndefined();
    expect(dayEndInZone(undefined)).toBeUndefined();
  });
});
