import { describe, expect, it } from "vitest";
import { readProcessDateSchedule } from "@/lib/process-date-schedule";

// 3.11.2026: the short form that adds a date from a process card.
describe("readProcessDateSchedule()", () => {
  it("every business day needs nothing else", () => {
    expect(readProcessDateSchedule({ recurrence: "BUSINESS_DAILY" })).toEqual({ recurrence: "BUSINESS_DAILY", month: 1, day: 1, weekday: null, onceDate: null });
  });
  it("weekly needs a weekday, Sunday included", () => {
    expect(readProcessDateSchedule({ recurrence: "WEEKLY", weekday: "0" })).toMatchObject({ recurrence: "WEEKLY", weekday: 0 });
    expect(readProcessDateSchedule({ recurrence: "WEEKLY", weekday: "" })).toEqual({ error: "צריך לבחור יום בשבוע." });
    expect(readProcessDateSchedule({ recurrence: "WEEKLY", weekday: "7" })).toEqual({ error: "צריך לבחור יום בשבוע." });
  });
  it("monthly needs a day of the month", () => {
    expect(readProcessDateSchedule({ recurrence: "MONTHLY", dayOfMonth: "10" })).toMatchObject({ recurrence: "MONTHLY", day: 10 });
    expect(readProcessDateSchedule({ recurrence: "MONTHLY", dayOfMonth: "32" })).toEqual({ error: "צריך יום בחודש, בין 1 ל-31." });
  });
  it("once needs a date, and keeps its month and day", () => {
    const r = readProcessDateSchedule({ recurrence: "ONCE", onceDate: "2026-11-04" });
    expect(r).toMatchObject({ recurrence: "ONCE", month: 11, day: 4 });
    expect(readProcessDateSchedule({ recurrence: "ONCE", onceDate: "" })).toEqual({ error: "צריך תאריך." });
  });
  it("an unknown choice is refused", () => {
    expect(readProcessDateSchedule({ recurrence: "DAILY" })).toEqual({ error: "צריך לבחור כל כמה זמן." });
  });
});
