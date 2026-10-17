import { describe, expect, it } from "vitest";
import { businessDaysBetween, controlFrom, controlLine, controlParts, type ControlData } from "@/lib/client-control";

// The control line at the top of a client's file (spec 7.6).

const base: ControlData = {
  processes: 0,
  withAnkora: 0,
  inHandover: 0,
  avgCompleteness: null,
  needsReview: 0,
  noBackup: 0,
  exceptionsInForce: 0,
  exceptionsRequested: 0,
  uncertain: 0,
  openQuestions: 0,
  systemsWithoutAccess: 0,
  daysSinceBatch: null,
};

describe("businessDaysBetween", () => {
  it("counts Israeli business days after the first day, up to and including the last", () => {
    expect(businessDaysBetween("2026-10-15", "2026-10-15")).toBe(0);
    // Thursday to Sunday: Friday and Saturday do not count.
    expect(businessDaysBetween("2026-10-15", "2026-10-18")).toBe(1);
    expect(businessDaysBetween("2026-10-15", "2026-10-21")).toBe(4);
  });
});

describe("controlParts", () => {
  it("a client with nothing yet says so, and never shows zeros", () => {
    expect(controlLine(base)).toBe("אין עדיין תהליכים · עוד לא הגיעה אצווה מהחילוץ");
  });

  it("the spec's line, in its order, with warnings where a person is needed", () => {
    const parts = controlParts({
      ...base,
      processes: 18,
      withAnkora: 5,
      inHandover: 9,
      avgCompleteness: 6,
      needsReview: 3,
      noBackup: 4,
      exceptionsInForce: 2,
      exceptionsRequested: 1,
      uncertain: 9,
      openQuestions: 18,
      systemsWithoutAccess: 6,
      daysSinceBatch: 0,
    });
    expect(parts.map((p) => p.text).join(" · ")).toBe(
      "18 תהליכים, 5 אצלנו ו-9 בחפיפה · שלמות ממוצעת 6 מתוך 9 · 3 תהליכים דורשים סקירה · 4 תהליכים בלי מחליף · 2 חריגות בתוקף · בקשת חריגה אחת ממתינה · 9 פריטים לא ודאיים · 18 שאלות פתוחות · 6 מערכות בלי גישה · אצווה אחרונה: היום"
    );
    expect(parts.filter((p) => p.warn).map((p) => p.text)).toEqual([
      "שלמות ממוצעת 6 מתוך 9",
      "3 תהליכים דורשים סקירה",
      "4 תהליכים בלי מחליף",
      "בקשת חריגה אחת ממתינה",
      "6 מערכות בלי גישה",
    ]);
  });

  it("the last batch warns after three business days", () => {
    expect(controlParts({ ...base, daysSinceBatch: 3 }).at(-1)).toEqual({ text: "אצווה אחרונה: לפני 3 ימי עבודה", warn: false });
    expect(controlParts({ ...base, daysSinceBatch: 4 }).at(-1)).toEqual({ text: "אצווה אחרונה: לפני 4 ימי עבודה", warn: true });
  });
});

describe("controlFrom", () => {
  it("counts from the rows the screen shows: weakest field, questions apart, closed facts out", () => {
    const d = controlFrom({
      processes: [
        { transitionStatus: "WITH_ANKORA", completeness: { score: 9 }, needsReview: false, backupOwnerId: "b", status: "ACTIVE" },
        { transitionStatus: "IN_HANDOVER", completeness: { score: 6 }, needsReview: true, backupOwnerId: null, status: "ACTIVE" },
      ],
      exceptions: [{ status: "APPROVED" }, { status: "REQUESTED" }],
      facts: [
        { kind: "QUESTION", answeredAt: null, closedAt: null, knowledgeStatus: "MISSING", fieldStatus: {} },
        { kind: "QUESTION", answeredAt: new Date(), closedAt: null, knowledgeStatus: "CONFIRMED", fieldStatus: {} },
        { kind: "TEMPORARY", answeredAt: null, closedAt: new Date(), knowledgeStatus: "UNCERTAIN", fieldStatus: {} },
        { kind: "NOTE", answeredAt: null, closedAt: null, knowledgeStatus: "UNCERTAIN", fieldStatus: {} },
      ],
      otherItems: [{ knowledgeStatus: "CONFIRMED", fieldStatus: { registrationNumber: { status: "MISSING" } } }],
      systems: [{ accessStatus: "HAS_ACCESS" }, { accessStatus: "PENDING" }, { accessStatus: "NOT_NEEDED" }],
      daysSinceBatch: 1,
    });
    expect(d).toMatchObject({ processes: 2, withAnkora: 1, inHandover: 1, avgCompleteness: 7.5, needsReview: 1, noBackup: 1, exceptionsInForce: 1, exceptionsRequested: 1, uncertain: 2, openQuestions: 1, systemsWithoutAccess: 1 });
  });
});
