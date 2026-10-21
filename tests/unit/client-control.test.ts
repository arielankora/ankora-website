import { describe, expect, it } from "vitest";
import { CONTROL_DETAIL_LIMIT, SCHEDULED_NO_DATE_NOTE, businessDaysBetween, controlDetails, controlFrom, controlLine, controlParts, scheduledWithoutDate, type ControlData } from "@/lib/client-control";

// The control line at the top of a client's file (spec 7.6).

const base: ControlData = {
  processes: 0,
  withAnkora: 0,
  inHandover: 0,
  avgCompleteness: null,
  needsReview: 0,
  scheduledNoDate: 0,
  noBackup: 0,
  exceptionsInForce: 0,
  exceptionsRequested: 0,
  uncertain: 0,
  openQuestions: 0,
  systemsWithoutAccess: 0,
  clientVisible: 0,
  noOwner: 0,
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

describe("visible to the client and owner (spec 3.1)", () => {
  it("counts what the client may see, and what nobody keeps, without warning", () => {
    const d = controlFrom({
      processes: [{ transitionStatus: "WITH_CLIENT", completeness: { score: 5 }, needsReview: false, backupOwnerId: "b", status: "ACTIVE", clientVisible: true }],
      exceptions: [],
      facts: [
        { kind: "NOTE", answeredAt: null, closedAt: null, knowledgeStatus: "CONFIRMED", fieldStatus: {}, clientVisible: true, ownerId: "u" },
        { kind: "QUESTION", answeredAt: null, closedAt: null, knowledgeStatus: "MISSING", fieldStatus: {}, clientVisible: true },
      ],
      otherItems: [{ knowledgeStatus: "CONFIRMED", fieldStatus: {} }],
      systems: [],
      daysSinceBatch: null,
    });
    expect(d).toMatchObject({ clientVisible: 2, noOwner: 1 });
    const parts = controlParts(d).map((p) => p.text);
    expect(parts).toContain("2 פריטים גלויים ללקוח");
    expect(parts).toContain("פריט אחד בלי בעלים");
    expect(controlParts({ ...base, clientVisible: 1 }).map((p) => p.text)).toContain("פריט אחד גלוי ללקוח");
  });
});

describe("what is behind each count (spec 7.6)", () => {
  it("each count that has names says which key it opens", () => {
    const keys = controlParts({ ...base, processes: 2, avgCompleteness: 7, needsReview: 1, uncertain: 3, daysSinceBatch: 0 }).map((p) => p.key);
    expect(keys).toEqual(["processes", "completeness", "needsReview", "uncertain", undefined]);
  });

  it("names the same rows the counts come from", () => {
    const full = controlDetails({
      processes: [
        { code: "P1", title: "תשלומי ספקים", transitionStatus: "WITH_ANKORA", completeness: { score: 9 }, needsReview: false, backupOwnerId: "b", status: "ACTIVE" },
        { code: "P2", title: "דוח רבעוני", transitionStatus: "IN_HANDOVER", completeness: { score: 6 }, needsReview: true, reviewLabel: "כלל השתנה", backupOwnerId: null, status: "ACTIVE", clientVisible: true },
        { code: "P3", title: "ישן", transitionStatus: "WITH_CLIENT", completeness: { score: 1 }, needsReview: true, backupOwnerId: null, status: "RETIRED" },
      ],
      exceptions: [{ status: "REQUESTED", what: "תשלום בלי אישור", ruleTitle: "סף" }],
      facts: [
        { kind: "NOTE", body: "מגבלת Justworks", answeredAt: null, closedAt: null, knowledgeStatus: "UNCERTAIN", fieldStatus: {}, ownerId: "u" },
        { kind: "QUESTION", body: "מי מורשה החתימה?", answeredAt: null, closedAt: null, knowledgeStatus: "MISSING", fieldStatus: {} },
      ],
      otherItems: [{ label: "Mercury", knowledgeStatus: "CONFIRMED", fieldStatus: {}, clientVisible: true }],
      systems: [{ systemName: "Doka", accessStatus: "PENDING" }],
    });
    const d = Object.fromEntries(Object.entries(full).map(([k, v]) => [k, v!.map((x) => x.text)])) as Record<string, string[]>;
    expect(full.completeness![0].note).toBe("6 מתוך 9");
    expect(full.needsReview![0].note).toBe("כלל השתנה");
    expect(full.systemsWithoutAccess![0].note).toBe("הגישה ממתינה");
    expect(d.processes).toEqual(["P1 תשלומי ספקים", "P2 דוח רבעוני"]);
    expect(d.completeness).toEqual(["P2 דוח רבעוני"]);
    expect(d.needsReview).toEqual(["P2 דוח רבעוני"]);
    expect(d.noBackup).toEqual(["P2 דוח רבעוני"]);
    expect(d.exceptionsRequested).toEqual(["סף: תשלום בלי אישור"]);
    expect(d.uncertain).toEqual(["מגבלת Justworks"]);
    expect(d.openQuestions).toEqual(["מי מורשה החתימה?"]);
    expect(d.clientVisible).toEqual(["P2 דוח רבעוני", "Mercury"]);
    expect(d.noOwner).toEqual(["Mercury"]);
    expect(d.systemsWithoutAccess).toEqual(["Doka"]);
  });

  it("a long list stops, and says how many more", () => {
    const many = Array.from({ length: CONTROL_DETAIL_LIMIT + 5 }, (_, i) => ({ label: `פריט ${i}`, knowledgeStatus: "CONFIRMED" as const, fieldStatus: {} }));
    const d = controlDetails({ processes: [], exceptions: [], facts: [], otherItems: many, systems: [] });
    expect(d.noOwner).toHaveLength(CONTROL_DETAIL_LIMIT + 1);
    expect(d.noOwner!.at(-1)).toEqual({ text: "ועוד 5" });
  });
});

describe("control details lead to the item", () => {
  it("each name carries the item's id, and why it is listed", () => {
    const d = controlDetails({
      processes: [],
      exceptions: [{ status: "APPROVED", what: "בלי אישור עד 1.11", ruleTitle: "סף", policyId: "pol1" }],
      facts: [{ id: "f1", kind: "NOTE", body: "מגבלת Justworks", answeredAt: null, closedAt: null, knowledgeStatus: "UNCERTAIN", fieldStatus: {}, ownerId: null, toResolve: "לשאול את שני" }],
      otherItems: [],
      systems: [{ id: "s1", systemName: "Mercury", accessStatus: "NO_ACCESS" }],
    });
    expect(d.uncertain).toEqual([{ text: "מגבלת Justworks", id: "f1", note: "לשאול את שני" }]);
    expect(d.noOwner).toEqual([{ text: "מגבלת Justworks", id: "f1" }]);
    expect(d.exceptionsInForce).toEqual([{ text: "סף: בלי אישור עד 1.11", id: "pol1" }]);
    expect(d.systemsWithoutAccess).toEqual([{ text: "Mercury", id: "s1", note: "אין גישה" }]);
  });
});

describe("a process that runs by a date, with no date ahead (21.10.2026)", () => {
  const proc = (over: Record<string, unknown>) => ({ code: "P2", title: "תשלומי ספקים", transitionStatus: "IN_HANDOVER", completeness: { score: 4 }, needsReview: false, backupOwnerId: "b", status: "ACTIVE", triggerKinds: ["SCHEDULED"], nextDate: null, ...over });
  it("only an approved one that runs by a date and has none", () => {
    expect(scheduledWithoutDate(proc({}))).toBe(true);
    expect(scheduledWithoutDate(proc({ nextDate: new Date("2026-10-25") }))).toBe(false);
    expect(scheduledWithoutDate(proc({ status: "DRAFT" }))).toBe(false);
    expect(scheduledWithoutDate(proc({ triggerKinds: ["EVENT"] }))).toBe(false);
    expect(scheduledWithoutDate(proc({ triggerKinds: undefined }))).toBe(false);
  });
  it("is a warning on the line, and names the process with why", () => {
    const d = controlFrom({ processes: [proc({}), proc({ code: "P1", nextDate: new Date("2026-10-22") })], exceptions: [], facts: [], otherItems: [], systems: [], daysSinceBatch: 0 });
    expect(d.scheduledNoDate).toBe(1);
    const part = controlParts(d).find((p) => p.key === "scheduledNoDate");
    expect(part).toEqual({ text: "תהליך אחד לפי מועד בלי מועד הבא", warn: true, key: "scheduledNoDate" });
    expect(controlParts({ ...base, processes: 3, scheduledNoDate: 2 }).map((p) => p.text)).toContain("2 תהליכים לפי מועד בלי מועד הבא");
    const details = controlDetails({ processes: [{ ...proc({}), id: "p2" }], exceptions: [], facts: [], otherItems: [], systems: [] });
    expect(details.scheduledNoDate).toEqual([{ text: "P2 תשלומי ספקים", id: "p2", note: SCHEDULED_NO_DATE_NOTE }]);
  });
});
