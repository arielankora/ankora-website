import { describe, expect, it } from "vitest";
import { shiftBusinessDays } from "@/lib/business-calendar";
import { runDescription, runLeadBusinessDays, stepDueKeys, stepTitle } from "@/lib/process-runs";
import type { ProcessStep } from "@/lib/process-rules";

// Org brain, phase 1 (claude/org-brain-spec-2026-10-12.md, 5.3): when a
// run opens, when each step is due, and what the task says.

const step = (over: Partial<ProcessStep>): ProcessStep => ({
  title: "שלב",
  mode: "MANUAL",
  offsetBusinessDays: null,
  actionTags: [],
  systemIds: [],
  output: null,
  verification: null,
  requiresApproval: false,
  ...over,
});

describe("shiftBusinessDays", () => {
  it("counts business days both ways in the calendar's week", () => {
    // Tuesday 10.11.2026: two Israeli business days before is Sunday 8.11
    // (Monday 9 is one, Sunday 8 is two).
    expect(shiftBusinessDays("2026-11-10", -2, "IL")).toBe("2026-11-08");
    // In the US week, Friday 6.11 instead (Monday 9, Friday 6).
    expect(shiftBusinessDays("2026-11-10", -2, "US")).toBe("2026-11-06");
    // Thursday 12.11 plus one in Israel skips Friday and Saturday.
    expect(shiftBusinessDays("2026-11-12", 1, "IL")).toBe("2026-11-15");
    expect(shiftBusinessDays("2026-11-12", 0, "IL")).toBe("2026-11-12");
  });
});

describe("a run", () => {
  const steps = [step({ title: "חשבוניות ל-Doka" }), step({ title: "מייל לאיילה", offsetBusinessDays: -2, mode: "ASSISTED", actionTags: ["PAYMENT"], requiresApproval: true })];

  it("opens one business day before its earliest step, and dates each step", () => {
    expect(runLeadBusinessDays(steps)).toBe(3);
    expect(runLeadBusinessDays([step({})])).toBe(0);
    expect(stepDueKeys("2026-11-10", steps, "IL")).toEqual(["2026-11-10", "2026-11-08"]);
  });

  it("names each step with how it is done and who approves", () => {
    expect(stepTitle(steps[0], "אורן")).toBe("חשבוניות ל-Doka");
    expect(stepTitle(steps[1], "מורשה חתימה")).toBe("מייל לאיילה (Claude מכין, אדם בודק), דורש אישור של מורשה חתימה");
  });

  it("says which procedure, the steps, the rules, the exceptions and the gaps", () => {
    const d = runDescription({
      code: "P1",
      title: "תשלומי ספקים, LTD",
      version: 2,
      purpose: null,
      steps,
      highlights: "רישום ותשלום הם שני ערוצים נפרדים",
      outputs: null,
      gaps: ["אין מחליף: הידע אצל אדם אחד"],
      rules: ["Inc ו-LTD: לא שולחים לאיילה שום דבר של Inc"],
      exceptions: [],
      exceptionPlaybook: null,
      systemName: () => "",
    });
    expect(d).toContain("**ריצה של P1 תשלומי ספקים, LTD, לפי נוהל גרסה 2.**");
    expect(d).toContain("2. מייל לאיילה (Claude מכין, אדם בודק · תשלום)");
    expect(d).toContain("**דגשים:** רישום ותשלום הם שני ערוצים נפרדים");
    expect(d).toContain("- Inc ו-LTD: לא שולחים לאיילה שום דבר של Inc");
    expect(d).toContain("- אין מחליף: הידע אצל אדם אחד");
    expect(d).not.toContain("חריגות מאושרות");
  });
});
