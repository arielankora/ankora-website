import { describe, expect, it } from "vitest";
import { formatDuration, formatSource, SOURCE_LABEL } from "@/lib/time-entry-format";

// Extracted (2026-09-11) from app/(product)/app/time-entries/AdminEntryRow.tsx
// so the on-screen table and app/api/time-entries/export/route.ts render
// duration/source identically. Zero project imports (no "server-only", no
// prisma), so - like tests/unit/csv.test.ts - this one actually runs in
// the sandbox, unlike most other report-related tests (see the header
// comment on tests/unit/reports.test.ts for that limitation).

describe("formatDuration()", () => {
  it("renders a running timer (null seconds) as active", () => {
    expect(formatDuration(null)).toBe("פעיל");
  });

  it("formats whole hours with no leftover minutes", () => {
    expect(formatDuration(3600)).toBe("1:00");
  });

  it("formats hours + minutes, zero-padded", () => {
    expect(formatDuration(5400)).toBe("1:30");
    expect(formatDuration(65)).toBe("0:01");
  });

  it("rounds partial minutes", () => {
    expect(formatDuration(3629)).toBe("1:00"); // 29s rounds down
    expect(formatDuration(3631)).toBe("1:01"); // 31s rounds up
  });

  it("formats zero seconds", () => {
    expect(formatDuration(0)).toBe("0:00");
  });
});

describe("formatSource()", () => {
  it("labels known sources in Hebrew", () => {
    expect(formatSource("MANUAL")).toBe("ידני");
    expect(formatSource("TIMER")).toBe("טיימר");
  });

  it("falls back to the raw value for an unknown source", () => {
    expect(formatSource("IMPORTED")).toBe("IMPORTED");
  });

  it("SOURCE_LABEL exposes the same mapping formatSource reads from", () => {
    expect(SOURCE_LABEL.MANUAL).toBe("ידני");
    expect(SOURCE_LABEL.TIMER).toBe("טיימר");
  });
});
