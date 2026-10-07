import { describe, expect, it } from "vitest";
import { formatClockMinutes } from "@/lib/hours-format";
import { formatReportCell } from "@/lib/report-cell";
import { formatDuration } from "@/lib/time-entry-format";

describe("formatClockMinutes", () => {
  it("formats positive durations as H:MM", () => {
    expect(formatClockMinutes(0)).toBe("0:00");
    expect(formatClockMinutes(184)).toBe("3:04");
    expect(formatClockMinutes(1821)).toBe("30:21");
  });

  it("RIMED, October 2026: an overrun of 21 minutes is -0:21, not -1:-21", () => {
    expect(formatClockMinutes(-21)).toBe("-0:21");
    expect(formatClockMinutes(-61)).toBe("-1:01");
    expect(formatClockMinutes(-180)).toBe("-3:00");
  });
});

describe("formatDuration", () => {
  it("never prints 60 minutes: 59.5 minutes rounds to 1:00", () => {
    expect(formatDuration(3570)).toBe("1:00");
    expect(formatDuration(3599)).toBe("1:00");
    expect(formatDuration(null)).toBe("פעיל");
  });
});

describe("formatReportCell", () => {
  const used = { key: "usedMinutes", type: "bankHours" as const };
  const remaining = { key: "remainingMinutes", type: "bankHours" as const };
  const pct = { key: "utilizationPct", type: "percent" as const };

  it("RIMED: 30:21 used of a 30:00 bank reads as an overrun in words", () => {
    const row = { client: "RIMED", totalMinutes: 1800, usedMinutes: 1821, remainingMinutes: -21, utilizationPct: 101.2 };
    expect(formatReportCell(row, used)).toMatchObject({ text: "30.35", tone: undefined });
    expect(formatReportCell(row, remaining)).toEqual({ text: "חריגה 0.35", figure: "0.35", prefix: "חריגה", tone: "overdrawn" });
    expect(formatReportCell(row, pct)).toMatchObject({ text: "101.2%", tone: "overdrawn" });
  });

  it("Gilad Komorov: matches the Hour Banks screen to the hundredth", () => {
    const row = { totalMinutes: 900, usedMinutes: 184, remainingMinutes: 716 };
    expect(formatReportCell(row, used).text).toBe("3.07");
    // 716 minutes alone would round to 11.93 too, but derive it like bankFigures.
    expect(formatReportCell(row, remaining).text).toBe("11.93");
  });

  it("exactly used up is 0.00 and not an overrun", () => {
    const row = { totalMinutes: 600, usedMinutes: 600, remainingMinutes: 0, utilizationPct: 100 };
    expect(formatReportCell(row, remaining)).toMatchObject({ text: "0.00", tone: undefined });
    expect(formatReportCell(row, pct).tone).toBeUndefined();
  });

  it("plain minutes columns stay H:MM and text stays text", () => {
    expect(formatReportCell({ actualMinutes: 125 }, { key: "actualMinutes", type: "minutes" }).text).toBe("2:05");
    expect(formatReportCell({ client: "-Acme" }, { key: "client" })).toMatchObject({ text: "-Acme", figure: "" });
  });
});
