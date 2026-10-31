import { describe, expect, it } from "vitest";
import { buildProcessVisual, dayLabel } from "@/lib/process-visual";
import type { ProcessStep } from "@/lib/process-rules";

// 31.10.2026 (task cmvtitlhs0001js08dzotqd6r): a process drawn as a band
// of days over its steps, from data the process already holds.

const step = (title: string, offsetBusinessDays: number | null, extra: Partial<ProcessStep> = {}): ProcessStep => ({
  title,
  mode: "MANUAL",
  offsetBusinessDays,
  actionTags: [],
  systemIds: [],
  output: null,
  verification: null,
  requiresApproval: false,
  amountMaxMinor: null,
  currency: null,
  channel: null,
  ...extra,
});

// The onboarding of an internal supplier (P1 of "Ankora פנימי"), as approved.
const onboarding = {
  triggerKinds: ["EVENT" as const],
  triggerText: "פתיחת משתמש לספק פנימי",
  slaBusinessDays: 5,
  steps: [
    step("פתיחת משתמש", 0),
    step("הפעלת הסוכן", 0),
    step("מייל עם ההתחייבות", 0, { mode: "ASSISTED" }),
    step("כניסה ראשונה", 2),
    step("בדיקת ה-PDF", 2, { mode: "ASSISTED", verification: "גרסה וחתימה" }),
    step("גישות לכלים", null),
    step("שיוך ללקוחות", null, { requiresApproval: true }),
    step("הדרכה", 5),
    step("סגירה", 5, { mode: "ASSISTED" }),
  ],
};

describe("process visual", () => {
  it("groups the steps by day, in the procedure's order, with the undated last", () => {
    const v = buildProcessVisual(onboarding);
    expect(v.groups.map((g) => g.day)).toEqual([0, 2, 5, null]);
    expect(v.groups[0].steps.map((s) => s.n)).toEqual([1, 2, 3]);
    expect(v.groups[3].steps.map((s) => s.n)).toEqual([6, 7]);
    expect(v.groups[3].steps[1].requiresApproval).toBe(true);
    expect(v.undated).toBe(2);
  });

  it("puts on the band only the days something happens on", () => {
    const v = buildProcessVisual(onboarding);
    expect(v.ticks.map((t) => t.day)).toEqual([0, 2, 5]);
    expect(v.ticks[0].marks).toEqual(["start", "steps"]);
    expect(v.ticks[2].marks).toEqual(["steps", "sla"]);
    expect(v.startLabel).toBe("כשמשהו קורה: פתיחת משתמש לספק פנימי");
  });

  it("adds the last allowed day even when no step falls on it, and marks steps after it", () => {
    const v = buildProcessVisual({ ...onboarding, slaBusinessDays: 3, steps: [step("א", 0), step("ב", 4)] });
    expect(v.ticks.map((t) => t.day)).toEqual([0, 3, 4]);
    expect(v.ticks[1].marks).toEqual(["sla"]);
    expect(v.ticks[2].marks).toEqual(["steps", "late"]);
    expect(v.late).toBe(1);
  });

  it("draws a process with no days and no trigger without inventing them", () => {
    const v = buildProcessVisual({ triggerKinds: [], triggerText: " ", slaBusinessDays: null, steps: [step("א", null)] });
    expect(v.startLabel).toBe("לא כתוב מה מפעיל אותו");
    expect(v.sla).toBeNull();
    expect(v.ticks.map((t) => t.day)).toEqual([0]);
    expect(v.groups).toEqual([{ day: null, steps: [expect.objectContaining({ n: 1 })] }]);
  });

  it("names days before the run's date", () => {
    expect(dayLabel(0)).toBe("יום 0");
    expect(dayLabel(3)).toBe("יום 3");
    expect(dayLabel(-2)).toBe("2 ימים לפני");
  });
});
