import { describe, expect, it } from "vitest";
import { isPastLongTimerThreshold, selectUnnotifiedEntries, LONG_TIMER_NOTIFICATION_TYPE } from "@/lib/app-domain/notifications";

// Phase 9 gap-fix (docs/adr/0001 section 17.2, spec §6.1's missing
// email/persisted-notification half of the long-running-timer warning).
// Note: importing "@/lib/app-domain/notifications" pulls in
// lib/prisma.ts/lib/email.ts through its own imports, so - like every
// other lib/app-domain/*.ts test file in this suite (see
// tests/unit/reports.test.ts's comment) - this file cannot actually RUN
// in this sandbox. It runs normally on Vercel's Preview build.
//
// isPastLongTimerThreshold() and selectUnnotifiedEntries() are pure
// functions extracted specifically so this dedupe/threshold logic is
// unit-testable in isolation, same pattern as
// lib/app-domain/alerts.ts's currentValueForThreshold()/
// isThresholdBreached()/decideAlertAction() (tests/unit/alerts.test.ts).

describe("isPastLongTimerThreshold() - spec 6.1", () => {
  const now = new Date("2026-09-06T12:00:00Z");

  it("is false for a timer started less than LONG_TIMER_HOURS ago", () => {
    const startedOneHourAgo = new Date(now.getTime() - 1 * 3600_000);
    expect(isPastLongTimerThreshold(startedOneHourAgo, now)).toBe(false);
  });

  it("is true for a timer started exactly LONG_TIMER_HOURS ago", () => {
    const startedAtThreshold = new Date(now.getTime() - 8 * 3600_000);
    expect(isPastLongTimerThreshold(startedAtThreshold, now)).toBe(true);
  });

  it("is true for a timer started well past LONG_TIMER_HOURS ago", () => {
    const startedTwelveHoursAgo = new Date(now.getTime() - 12 * 3600_000);
    expect(isPastLongTimerThreshold(startedTwelveHoursAgo, now)).toBe(true);
  });
});

describe("selectUnnotifiedEntries() - AlertEvent-style (type, entityId) dedupe", () => {
  it("excludes entries whose id is already in the notified set", () => {
    const entries = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const result = selectUnnotifiedEntries(entries, ["b"]);
    expect(result.map((e) => e.id)).toEqual(["a", "c"]);
  });

  it("returns every entry unchanged when nothing has been notified yet", () => {
    const entries = [{ id: "a" }, { id: "b" }];
    expect(selectUnnotifiedEntries(entries, [])).toEqual(entries);
  });

  it("returns nothing when every entry has already been notified", () => {
    const entries = [{ id: "a" }, { id: "b" }];
    expect(selectUnnotifiedEntries(entries, ["a", "b"])).toEqual([]);
  });

  it("ignores null entityIds from unrelated notification rows without matching every entry", () => {
    // Notification.entityId is nullable on the schema (used by other
    // notification types); a null in the "already notified" set must
    // never accidentally suppress every real entry.
    const entries = [{ id: "a" }, { id: "b" }];
    expect(selectUnnotifiedEntries(entries, [null, null])).toEqual(entries);
  });
});

describe("LONG_TIMER_NOTIFICATION_TYPE", () => {
  it("is a stable, non-empty dedupe key", () => {
    expect(LONG_TIMER_NOTIFICATION_TYPE).toBe("long_running_timer");
  });
});
