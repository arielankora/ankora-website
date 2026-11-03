import { describe, expect, it } from "vitest";
import { formatPortalDate, formatPortalRange } from "@/lib/portal-dates";

// 3.11.2026, Hadas's review: one date form on every portal screen.
describe("formatPortalDate", () => {
  const now = new Date("2026-11-03T10:00:00Z");

  it("writes a Date and a day key the same way", () => {
    expect(formatPortalDate(new Date("2026-11-01T08:00:00Z"), now)).toBe(formatPortalDate("2026-11-01", now));
  });

  it("never writes the ISO form", () => {
    expect(formatPortalDate("2026-11-01", now)).not.toContain("2026-11-01");
    expect(formatPortalDate("2026-11-01", now)).toContain("1");
  });

  it("adds the year only outside the current year", () => {
    expect(formatPortalDate("2026-11-01", now)).not.toContain("2026");
    expect(formatPortalDate("2025-12-28", now)).toContain("2025");
  });

  it("uses Israel's calendar day near midnight", () => {
    // 22:30 UTC on 31.10 is already 1.11 in Israel.
    expect(formatPortalDate(new Date("2026-10-31T22:30:00Z"), now)).toBe(formatPortalDate("2026-11-01", now));
  });
});

describe("formatPortalRange", () => {
  it("ends on the day before the exclusive end, across a clock change", () => {
    const now = new Date("2026-11-03T10:00:00Z");
    // October 2026 in Israel: 1.10 00:00 (UTC+3) to 1.11 00:00 (UTC+2).
    const text = formatPortalRange(new Date("2026-09-30T21:00:00Z"), new Date("2026-10-31T22:00:00Z"), now);
    expect(text).toBe(`${formatPortalDate("2026-10-01", now)} עד ${formatPortalDate("2026-10-31", now)}`);
  });
});
