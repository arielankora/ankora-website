import { describe, expect, it } from "vitest";
import { combineWallClockTime } from "@/lib/app-domain/time-entries";

// Regression test: manually-entered times were silently shifting by
// Israel's UTC offset because the naive `new Date(\`${date}T${time}\`)`
// construction is parsed in the server process's own timezone (UTC on
// Vercel), not Asia/Jerusalem. Caught via live QA on the Phase 2 Preview
// deployment - a 09:00-10:30 manual entry displayed back as 12:00-13:30.
describe("combineWallClockTime()", () => {
  it("interprets the date/time as Asia/Jerusalem wall-clock time in summer (IDT, UTC+3)", () => {
    const d = combineWallClockTime("2026-09-04", "09:00");
    expect(d.toISOString()).toBe("2026-09-04T06:00:00.000Z");
  });

  it("interprets the date/time as Asia/Jerusalem wall-clock time in winter (IST, UTC+2)", () => {
    const d = combineWallClockTime("2026-01-15", "09:00");
    expect(d.toISOString()).toBe("2026-01-15T07:00:00.000Z");
  });

  it("round-trips back to the entered wall-clock time when displayed in Asia/Jerusalem", () => {
    const d = combineWallClockTime("2026-09-04", "14:45");
    const displayed = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Jerusalem",
    }).format(d);
    expect(displayed).toBe("14:45");
  });
});
