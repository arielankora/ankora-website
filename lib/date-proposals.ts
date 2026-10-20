// A date proposed by Claude (spec 3.10): a client's own deadline, payday
// or event, said in a meeting. Before this, a date could only be typed in
// by hand, so payroll on the 1st or a departure on the 22nd stayed a line
// of text and nothing reminded anyone. Pure: the shape, its checks, and
// what the dates engine gets once it is approved.

import { z } from "zod";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

export const DATE_CATEGORIES = ["PEOPLE_FAMILY", "DOCUMENTS_AUTHORITIES", "BUSINESS_FINANCE", "VEHICLE_PROPERTY", "HEALTH_TRAVEL", "GENERAL"] as const;

export const DatePayload = z.object({
  title: z.string().min(1).max(200),
  category: z.enum(DATE_CATEGORIES).nullish(),
  /// ONCE: on `date`. ANNUAL: every year on the day and month of `date`.
  /// MONTHLY: on `dayOfMonth` (every `intervalMonths`). WEEKLY: on `weekday`.
  recurrence: z.enum(["ONCE", "ANNUAL", "MONTHLY", "WEEKLY"]),
  date: ymd.nullish(),
  dayOfMonth: z.number().int().min(1).max(31).nullish(),
  intervalMonths: z.number().int().nullish(),
  /// 0 Sunday to 6 Saturday.
  weekday: z.number().int().min(0).max(6).nullish(),
  /// "the 8th or the 9th": every day it may fall on.
  dayAlternatives: z.array(z.number().int().min(1).max(31)).max(5).nullish(),
  /// What happens when it falls on a day off.
  ifNotBusinessDay: z.enum(["BEFORE", "AFTER"]).nullish(),
  businessCalendar: z.enum(["IL", "US"]).nullish(),
  conditionText: z.string().max(300).nullish(),
  /// Something due to reach us that day, and from whom.
  expectsReceipt: z.boolean().nullish(),
  expectedFrom: z.string().max(200).nullish(),
  /// Who at Ankora is responsible, by name. Nobody: whoever approves.
  responsibleName: z.string().max(200).nullish(),
  /// The process it starts, by code (P3) or title.
  processName: z.string().max(200).nullish(),
  /// Open a task this many days before.
  taskDaysBefore: z.number().int().min(0).max(60).nullish(),
  notes: z.string().max(1000).nullish(),
  sensitivity: z.enum(["NORMAL", "SENSITIVE"]).nullish(),
  clientVisible: z.boolean().nullish(),
});
export type DatePayloadValue = z.infer<typeof DatePayload>;

/// What is missing for the date to ever occur, in words; null when whole.
export function dateShapeError(p: Record<string, unknown>): string | null {
  const r = p.recurrence;
  const has = (k: string) => p[k] !== undefined && p[k] !== null && p[k] !== "";
  if ((r === "ONCE" || r === "ANNUAL") && !has("date")) return r === "ONCE" ? "מועד חד-פעמי צריך תאריך." : "מועד שנתי צריך יום וחודש (date).";
  if (r === "MONTHLY" && !has("dayOfMonth") && !(Array.isArray(p.dayAlternatives) && p.dayAlternatives.length)) return "מועד חודשי צריך יום בחודש.";
  if (r === "WEEKLY" && !has("weekday")) return "מועד שבועי צריך יום בשבוע.";
  if (has("intervalMonths") && r !== "MONTHLY") return '"כל כמה חודשים" רק למועד חודשי.';
  if (r === "ONCE" && has("date") && new Date(`${p.date}T00:00:00Z`).getTime() < Date.now() - 86_400_000) return "התאריך כבר עבר.";
  return null;
}

/// The schedule the dates engine takes (createImportantDate).
export function dateSchedule(p: DatePayloadValue) {
  const d = p.date ? new Date(`${p.date}T00:00:00Z`) : null;
  const alternatives = [...new Set((p.dayAlternatives ?? []).filter((x) => Number.isInteger(x)))].sort((a, b) => a - b);
  const approximate = alternatives.length >= 2 && (p.recurrence === "MONTHLY" || p.recurrence === "ANNUAL");
  const day = p.recurrence === "MONTHLY" ? (p.dayOfMonth ?? Math.min(...alternatives)) : d ? d.getUTCDate() : 1;
  return {
    recurrence: p.recurrence,
    month: d ? d.getUTCMonth() + 1 : 1,
    day,
    originYear: d ? d.getUTCFullYear() : null,
    onceDate: p.recurrence === "ONCE" ? d : null,
    weekday: p.recurrence === "WEEKLY" ? (p.weekday ?? null) : null,
    intervalMonths: p.recurrence === "MONTHLY" ? (p.intervalMonths ?? null) : null,
    precision: approximate ? ("APPROXIMATE" as const) : ("EXACT" as const),
    dayAlternatives: approximate ? alternatives : [],
    rollConvention: p.ifNotBusinessDay === "BEFORE" ? ("PREVIOUS_BUSINESS_DAY" as const) : p.ifNotBusinessDay === "AFTER" ? ("NEXT_BUSINESS_DAY" as const) : ("NONE" as const),
    businessCalendar: p.businessCalendar ?? "IL",
  };
}

const WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

/// When, as a reviewer reads it: "כל חודש ב-1", "22.10.2026".
export function dateWhen(p: Record<string, unknown>): string {
  const date = typeof p.date === "string" ? p.date : "";
  const [y, m, d] = date.split("-");
  const alts = Array.isArray(p.dayAlternatives) && p.dayAlternatives.length >= 2 ? (p.dayAlternatives as number[]).join(" או ") : null;
  if (p.recurrence === "ONCE") return date ? `${Number(d)}.${Number(m)}.${y}` : "";
  if (p.recurrence === "ANNUAL") return date ? `כל שנה ב-${Number(d)}.${Number(m)}` : "";
  if (p.recurrence === "WEEKLY") return typeof p.weekday === "number" ? `כל יום ${WEEKDAYS[p.weekday]}` : "";
  if (p.recurrence === "MONTHLY") {
    const every = typeof p.intervalMonths === "number" && p.intervalMonths > 1 ? `כל ${p.intervalMonths} חודשים` : "כל חודש";
    return `${every} ב-${alts ?? p.dayOfMonth ?? ""}`;
  }
  return "";
}
