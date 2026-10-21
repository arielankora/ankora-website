import { describe, expect, it } from "vitest";
import { DatePayload, dateSchedule, dateShapeError, dateWhen } from "@/lib/date-proposals";
import { proposalHeadline, proposalProblems } from "@/lib/knowledge-proposals";

// Spec 3.10: a date said in a meeting comes in as a proposal, and becomes
// a date the engine schedules once approved.

describe("a proposed date", () => {
  it("a monthly payday", () => {
    const p = DatePayload.parse({ title: "שליחת טבלת השכר לדקלה", recurrence: "MONTHLY", dayOfMonth: 1, ifNotBusinessDay: "BEFORE" });
    expect(dateShapeError(p)).toBeNull();
    expect(dateSchedule(p)).toMatchObject({ recurrence: "MONTHLY", day: 1, rollConvention: "PREVIOUS_BUSINESS_DAY", precision: "EXACT" });
    expect(proposalHeadline("DATE", p)).toBe("שליחת טבלת השכר לדקלה: כל חודש ב-1");
  });

  it("a day that falls on one of two", () => {
    const p = DatePayload.parse({ title: "משכורת", recurrence: "MONTHLY", dayAlternatives: [9, 8] });
    expect(dateSchedule(p)).toMatchObject({ day: 8, precision: "APPROXIMATE", dayAlternatives: [8, 9] });
    expect(dateWhen(p)).toBe("כל חודש ב-9 או 8");
  });

  it("a one-off date, and an annual one", () => {
    const once = DatePayload.parse({ title: "היום האחרון של גיא", recurrence: "ONCE", date: "2099-10-22" });
    expect(dateSchedule(once)).toMatchObject({ recurrence: "ONCE", month: 10, day: 22, onceDate: new Date("2099-10-22T00:00:00Z") });
    expect(dateWhen(once)).toBe("22.10.2099");
    const annual = DatePayload.parse({ title: "דוח שנתי", recurrence: "ANNUAL", date: "2027-05-31" });
    expect(dateSchedule(annual)).toMatchObject({ month: 5, day: 31, onceDate: null });
  });

  it("says what is missing, on the card", () => {
    expect(dateShapeError({ recurrence: "MONTHLY" })).toContain("יום בחודש");
    expect(dateShapeError({ recurrence: "ONCE" })).toContain("תאריך");
    expect(dateShapeError({ recurrence: "WEEKLY" })).toContain("יום בשבוע");
    expect(dateShapeError({ recurrence: "ONCE", date: "2020-01-01" })).toContain("עבר");
    expect(proposalProblems("DATE", { title: "x", recurrence: "MONTHLY" }, []).some((f) => f.code === "SHAPE" && f.block)).toBe(true);
  });
});

describe("a proposed date as a key, against the dates in the file", () => {
  it("monthly by its day, once by its date, annual by day and month", async () => {
    const { dateProposalKey } = await import("@/lib/date-proposals");
    expect(dateProposalKey({ title: "x", recurrence: "MONTHLY", dayOfMonth: 25 })).toMatchObject({ recurrence: "MONTHLY", day: 25 });
    expect(dateProposalKey({ title: "x", recurrence: "ONCE", date: "2026-11-02" })).toMatchObject({ recurrence: "ONCE", once: "2026-11-02" });
    expect(dateProposalKey({ title: "x", recurrence: "ANNUAL", date: "1991-10-26" })).toMatchObject({ recurrence: "ANNUAL", month: 10, day: 26 });
    expect(dateProposalKey({ title: "x", recurrence: "WEEKLY", weekday: 2 })).toMatchObject({ recurrence: "WEEKLY", weekday: 2 });
    expect(dateProposalKey({ recurrence: "MONTHLY" })).toEqual({ recurrence: "MONTHLY" });
  });
  it("finds the same birthday stored by a person", async () => {
    const { dateProposalKey } = await import("@/lib/date-proposals");
    const { findDateMatches, dateKeyFromRow } = await import("@/lib/name-match");
    const stored = [{ id: "d1", name: "יום הולדת של אורן מירון (לידה 26.10.1991)", key: dateKeyFromRow({ recurrence: "ANNUAL", month: 10, day: 26, nextOccurrenceAt: new Date("2026-10-26T00:00:00Z") }) }];
    expect(findDateMatches({ name: "יום הולדת של אורן מירון", key: dateProposalKey({ title: "x", recurrence: "ANNUAL", date: "1991-10-26" }) }, stored).map((m) => m.id)).toEqual(["d1"]);
  });
});
