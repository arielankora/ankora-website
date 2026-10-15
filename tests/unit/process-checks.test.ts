import { describe, expect, it } from "vitest";
import { checkDueKey, checkEveryError, checkEveryText, checkState, isRoutine } from "@/lib/process-checks";

// The check of an ongoing process (org-brain spec 3.8): when it is due is
// computed in one place, so the home screen, the card, the daily reminder
// and the MCP tool never disagree.

describe("when a check is due", () => {
  it("is today when never checked, and N days after the last one otherwise", () => {
    expect(checkDueKey({ checkEveryDays: 7, lastCheckedKey: null }, "2026-10-16")).toBe("2026-10-16");
    expect(checkDueKey({ checkEveryDays: 7, lastCheckedKey: "2026-10-12" }, "2026-10-16")).toBe("2026-10-19");
    expect(checkDueKey({ checkEveryDays: 30, lastCheckedKey: "2026-12-20" }, "2026-12-21")).toBe("2027-01-19");
    expect(checkDueKey({ checkEveryDays: null, lastCheckedKey: null }, "2026-10-16")).toBeNull();
  });

  it("reads as late, today or later", () => {
    expect(checkState("2026-10-15", "2026-10-16")).toBe("OVERDUE");
    expect(checkState("2026-10-16", "2026-10-16")).toBe("DUE");
    expect(checkState("2026-10-17", "2026-10-16")).toBe("LATER");
  });
});

describe("a routine", () => {
  it("is an ongoing process that is not paused or retired", () => {
    expect(isRoutine({ triggerKinds: ["CONTINUOUS"], status: "ACTIVE" })).toBe(true);
    expect(isRoutine({ triggerKinds: ["CONTINUOUS", "SCHEDULED"], status: "DRAFT" })).toBe(true);
    expect(isRoutine({ triggerKinds: ["CONTINUOUS"], status: "PAUSED" })).toBe(false);
    expect(isRoutine({ triggerKinds: ["SCHEDULED"], status: "ACTIVE" })).toBe(false);
    expect(isRoutine({ triggerKinds: ["CONTINUOUS"], status: "ACTIVE", deletedAt: new Date() })).toBe(false);
  });

  it("is checked every 1 to 365 days, said the way people say it", () => {
    expect(checkEveryText(7)).toBe("פעם בשבוע");
    expect(checkEveryText(1)).toBe("כל יום");
    expect(checkEveryText(10)).toBe("כל 10 ימים");
    expect(checkEveryError(0)).not.toBeNull();
    expect(checkEveryError(366)).not.toBeNull();
    expect(checkEveryError(1.5)).not.toBeNull();
    expect(checkEveryError(14)).toBeNull();
    expect(checkEveryError(null)).toBeNull();
  });
});
