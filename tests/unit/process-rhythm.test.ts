import { describe, expect, it } from "vitest";
import {
  datesForRule,
  describeLegacyDates,
  describeRhythm,
  describeRule,
  emptyRule,
  kindsOf,
  readRule,
  readStartInput,
  rhythmError,
  ruleError,
  type ScheduleRule,
  type StoredStart,
} from "@/lib/process-rhythm";

// The rhythm of a process (13.11.2026, processes redesign, stage 1). What is
// worth holding: the sentence is built from the rule, so it cannot say one
// thing while the dates do another (Autenik P1: "on the 1st" and a run every
// day); nothing is chosen in advance; and every rule turns into dates the
// date engine knows.

const monthly = (days: number[], over: Partial<ScheduleRule> = {}): ScheduleRule => ({ ...emptyRule("MONTHLY"), monthDays: days, ...over });

const stored = (over: Partial<StoredStart>): StoredStart => ({
  kind: "ON_DEMAND",
  schedule: null,
  description: null,
  checkEveryDays: null,
  checkText: null,
  externalWhere: null,
  externalWhen: null,
  externalRecipient: null,
  ...over,
});

describe("the sentence", () => {
  it("says the board's example, word for word", () => {
    expect(describeRule(monthly([10, 25]))).toBe("פעמיים בחודש, ב-10 וב-25. בסוף שבוע או חג: יום העסקים שלפני.");
  });

  it("says each frequency, in Hebrew and English", () => {
    expect(describeRule(emptyRule("BUSINESS_DAILY"))).toBe("כל יום עסקים.");
    expect(describeRule(emptyRule("DAILY"), "en")).toBe("Every day, weekends and holidays included.");
    expect(describeRule({ ...emptyRule("WEEKLY"), weekdays: [4] })).toBe("פעם בשבוע, ביום חמישי.");
    expect(describeRule({ ...emptyRule("WEEKLY"), weekdays: [0, 3] }, "en")).toBe("twice a week, on Sunday and Wednesday.");
    expect(describeRule(monthly([1], { roll: "NONE" }))).toBe("פעם בחודש, ב-1.");
    expect(describeRule(monthly([LAST()], { roll: "PREVIOUS_BUSINESS_DAY" }))).toBe("פעם בחודש, ביום האחרון. בסוף שבוע או חג: יום העסקים שלפני.");
    expect(describeRule({ ...emptyRule("QUARTERLY"), monthDays: [1], roll: "NEXT_BUSINESS_DAY" })).toBe("פעם ברבעון, ב-1 בחודש הראשון של כל רבעון. בסוף שבוע או חג: יום העסקים שאחרי.");
    expect(describeRule({ ...emptyRule("YEARLY"), yearDates: [{ month: 3, day: 15 }, { month: 1, day: 31 }], roll: "NONE" })).toBe("פעמיים בשנה: 31 בינואר ו-15 במרץ.");
    expect(describeRule({ ...emptyRule("ONCE"), onceDate: "2026-12-03", roll: "NONE" })).toBe("פעם אחת, ב-3.12.2026.");
  });

  it("says a period and a condition", () => {
    expect(describeRule({ ...emptyRule("BUSINESS_DAILY"), rangeStart: "2026-09-01", rangeEnd: "2027-08-31", condition: "יעד ה-SLA לא עמד." })).toBe(
      "כל יום עסקים. רק מ-1.9.2026 עד 31.8.2027. רק אם יעד ה-SLA לא עמד."
    );
  });

  it("puts the starts in one order, whatever order they were saved in", () => {
    const text = describeRhythm([
      stored({ kind: "ON_DEMAND" }),
      stored({ kind: "EVENT", description: "ספק חדש" }),
      stored({ kind: "SCHEDULE", schedule: monthly([5], { roll: "NONE" }) }),
    ]);
    expect(text).toBe("פעם בחודש, ב-5. כשמשהו קורה: ספק חדש. כשמבקשים.");
  });

  it("reads dates linked before the rhythm, as each one runs", () => {
    const legacy = [
      { recurrence: "MONTHLY", month: 1, day: 10, weekday: null, intervalMonths: null, onceDate: null, rollConvention: "NONE" },
      { recurrence: "BUSINESS_DAILY", month: 1, day: 1, weekday: null, intervalMonths: null, onceDate: null, rollConvention: "NONE" },
    ];
    expect(describeLegacyDates(legacy)).toBe("פעם בחודש, ב-10. כל יום עסקים.");
    expect(describeRhythm([stored({ kind: "SCHEDULE", schedule: { legacy: true } })], legacy)).toBe("פעם בחודש, ב-10. כל יום עסקים.");
    expect(describeLegacyDates([])).toBe("לפי מועד, בלי מועד מקושר.");
  });

  it("says an external process and an ongoing one", () => {
    expect(describeRhythm([stored({ kind: "EXTERNAL", externalWhere: "משימה מתוזמנת של Claude", externalWhen: "כל יום ב-07:40", externalRecipient: "אריאל" })])).toBe(
      "רץ אוטומטית מחוץ לאפליקציה: משימה מתוזמנת של Claude, כל יום ב-07:40. התוצאה אל אריאל."
    );
    expect(describeRhythm([stored({ kind: "CONTINUOUS", checkEveryDays: 7, checkText: "אין חשבונית תקועה" })])).toBe("שוטף, בדיקה כל שבוע: אין חשבונית תקועה.");
    expect(describeRhythm([stored({ kind: "CONTINUOUS" })])).toBe("שוטף, בלי תדירות בדיקה.");
  });
});

function LAST() {
  return 31;
}

describe("the rule", () => {
  it("has nothing chosen in advance, and asks for what is missing", () => {
    expect(rhythmError([])?.code).toBe("noStart");
    expect(ruleError(emptyRule("MONTHLY"))?.code).toBe("noMonthDay");
    expect(ruleError(emptyRule("WEEKLY"))?.code).toBe("noWeekday");
    expect(ruleError(emptyRule("YEARLY"))?.code).toBe("noYearDate");
    expect(ruleError(emptyRule("ONCE"))?.code).toBe("noOnceDate");
    expect(ruleError(emptyRule("BUSINESS_DAILY"))).toBeNull();
    expect(ruleError({ ...emptyRule("YEARLY"), yearDates: [{ month: 2, day: 30 }] })?.code).toBe("badYearDate");
    expect(ruleError({ ...emptyRule("BUSINESS_DAILY"), rangeStart: "2027-01-01", rangeEnd: "2026-01-01" })?.code).toBe("rangeOrder");
    expect(rhythmError([{ kind: "CONTINUOUS", checkEveryDays: null, checkText: null }])?.code).toBe("noCheck");
    expect(rhythmError([{ kind: "EXTERNAL", where: "Claude", when: "", recipient: null }])?.code).toBe("noWhen");
    expect(rhythmError([{ kind: "ON_DEMAND" }, { kind: "ON_DEMAND" }])?.code).toBe("duplicateKind");
  });

  it("becomes one date per day, in the date engine's terms", () => {
    expect(datesForRule(monthly([25, 10]))).toEqual([
      { recurrence: "MONTHLY", month: 1, day: 10, weekday: null, intervalMonths: null, onceDate: null, rollConvention: "PREVIOUS_BUSINESS_DAY" },
      { recurrence: "MONTHLY", month: 1, day: 25, weekday: null, intervalMonths: null, onceDate: null, rollConvention: "PREVIOUS_BUSINESS_DAY" },
    ]);
    expect(datesForRule({ ...emptyRule("QUARTERLY"), monthDays: [1], quarterMonth: 1, roll: "NEXT_BUSINESS_DAY" })[0]).toMatchObject({ recurrence: "MONTHLY", month: 1, day: 1, intervalMonths: 3 });
    expect(datesForRule({ ...emptyRule("WEEKLY"), weekdays: [3, 0] }).map((x) => x.weekday)).toEqual([0, 3]);
    expect(datesForRule(emptyRule("DAILY"))).toEqual([expect.objectContaining({ recurrence: "DAILY", rollConvention: "NONE" })]);
    expect(datesForRule({ ...emptyRule("ONCE"), onceDate: "2026-12-03" })[0]).toMatchObject({ recurrence: "ONCE", month: 12, day: 3, onceDate: "2026-12-03" });
  });

  it("says the trigger kinds every other reader still reads", () => {
    expect(kindsOf([{ kind: "ON_DEMAND" }, { kind: "SCHEDULE" }, { kind: "EXTERNAL" }])).toEqual(["SCHEDULED", "EXTERNAL", "ON_DEMAND"]);
  });

  it("reads what the editor sends, and nothing else", () => {
    expect(readStartInput({ kind: "SCHEDULE", schedule: { frequency: "MONTHLY", monthDays: [10, 10, 25], roll: "PREVIOUS_BUSINESS_DAY" } })).toEqual({
      kind: "SCHEDULE",
      schedule: { ...emptyRule("MONTHLY"), monthDays: [10, 25], roll: "PREVIOUS_BUSINESS_DAY" },
    });
    expect(readStartInput({ kind: "SCHEDULE", schedule: null })).toEqual({ kind: "SCHEDULE", schedule: null });
    expect(readStartInput({ kind: "CONTINUOUS", checkEveryDays: "7", checkText: " x " })).toEqual({ kind: "CONTINUOUS", checkEveryDays: 7, checkText: "x" });
    expect(readStartInput({ kind: "WHATEVER" })).toBeNull();
    expect(readRule({ frequency: "HOURLY" })).toBeNull();
  });
});
