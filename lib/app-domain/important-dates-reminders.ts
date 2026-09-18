// Phase 10: Important Dates ("מועדים חשובים") - reminder defaults,
// idempotency, and message templates.
//
// Zero Prisma import, same reasoning as the other important-dates-*.ts
// pure modules.
//
// Default offset table decision: the original brief's own worked example
// of a per-type default-offsets table was not carried forward into this
// session's task summary in full literal form (only that such a table
// exists and that it varies by type/category). Rather than block on
// re-pasting the brief, this table was authored here as a reasonable,
// documented default per Ariel's standing "decide and document, don't
// stop to ask for things you can reasonably infer" instruction - grounded
// in the six categories that ARE fully preserved (see
// ImportantDateCategory in prisma/schema.prisma) and ordinary judgment
// about how much lead time each kind of date realistically needs:
//   - DOCUMENTS_AUTHORITIES (passport/visa/license renewals): long lead
//     time, renewal processes are slow -> 60/30/7 days.
//   - BUSINESS_FINANCE / VEHICLE_PROPERTY (contract/insurance renewals,
//     registrations): moderate lead time -> 30/7 days.
//   - HEALTH_TRAVEL (checkups, trip-prep deadlines): 14/3 days.
//   - PEOPLE_FAMILY (birthdays, anniversaries): short, personal -> 7/1
//     days.
//   - GENERAL (anything else): a safe middle default -> 14/3 days.
// Every one of these is a per-ImportantDate override-able default
// (ReminderRule rows are created from this table at ImportantDate-create
// time, per important-dates.ts, but are fully editable/removable
// afterward) - so a wrong guess here costs nothing beyond a slightly
// suboptimal first suggestion, never a hard constraint. Ariel can adjust
// this table at any time; it requires no migration (plain TS, not DB
// config).
//
// NOTE (bug found + fixed during Phase 10 build verification): this file
// deliberately has NO `import "server-only"`, unlike its sibling pure
// modules (important-dates-recurrence.ts, important-dates-holidays.ts).
// The first version of this file DID import it, matching the established
// convention - but ImportantDateForm.tsx (a Client Component, needs
// IMPORTANT_DATE_CATEGORY_LABELS/IMPORTANT_DATE_TYPE_EXAMPLES for its type
// dropdown) imports directly from this module, and `next build` itself is
// what caught it: "You're importing a component that needs server-only.
// That only works in a Server Component". Nothing in this file actually
// touches server-only resources (no Prisma, no secrets, no fs) - it is
// pure constants/functions safe to run in the browser - so the fix is to
// simply not gate it, rather than duplicate its exports into a second,
// client-safe copy.

export type ImportantDateCategoryLike =
  | "PEOPLE_FAMILY"
  | "DOCUMENTS_AUTHORITIES"
  | "BUSINESS_FINANCE"
  | "VEHICLE_PROPERTY"
  | "HEALTH_TRAVEL"
  | "GENERAL";

/// Example `type` values per category, shown in the UI's type picker
/// (spec: each category groups a curated example list of free-text
/// types - ImportantDate.type stays a plain string, per the schema's own
/// Notification.type-style precedent, so a client-specific type never
/// needs a migration to add).
export const IMPORTANT_DATE_TYPE_EXAMPLES: Record<ImportantDateCategoryLike, string[]> = {
  PEOPLE_FAMILY: ["יום הולדת", "יום נישואין", "יום זיכרון"],
  DOCUMENTS_AUTHORITIES: ["פג תוקף דרכון", "פג תוקף ויזה", "חידוש רישיון נהיגה", "חידוש תעודת זהות"],
  BUSINESS_FINANCE: ["חידוש חוזה", "תשלום מס", "הגשת דוח שנתי", "פדיון פיקדון"],
  VEHICLE_PROPERTY: ["חידוש ביטוח רכב", "טסט שנתי", "חידוש ביטוח דירה", "תשלום ארנונה"],
  HEALTH_TRAVEL: ["בדיקה תקופתית", "מועד טיסה", "פג תוקף ביטוח נסיעות"],
  GENERAL: ["מועד כללי"],
};

export const IMPORTANT_DATE_CATEGORY_LABELS: Record<ImportantDateCategoryLike, string> = {
  PEOPLE_FAMILY: "אנשים ומשפחה",
  DOCUMENTS_AUTHORITIES: "מסמכים ורשויות",
  BUSINESS_FINANCE: "עסקי ופיננסי",
  VEHICLE_PROPERTY: "רכב ונכסים",
  HEALTH_TRAVEL: "בריאות ונסיעות",
  GENERAL: "כללי",
};

export const DEFAULT_REMINDER_OFFSETS_BY_CATEGORY: Record<ImportantDateCategoryLike, number[]> = {
  PEOPLE_FAMILY: [7, 1],
  DOCUMENTS_AUTHORITIES: [60, 30, 7],
  BUSINESS_FINANCE: [30, 7],
  VEHICLE_PROPERTY: [30, 7],
  HEALTH_TRAVEL: [14, 3],
  GENERAL: [14, 3],
};

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

/// Builds the ReminderOccurrence.idempotencyKey (a real `@unique` DB
/// column - see prisma/schema.prisma's Phase 10 section - the same
/// "DB constraint is the real guarantee" two-layer pattern TimeEntry's
/// one-active-timer partial unique index uses). Composed from every axis
/// that could otherwise legitimately produce two reminders for "the same"
/// notification: which ImportantDate, which occurrence year (an ANNUAL
/// date fires once per year; re-running the daily job on the same day
/// must not double-send), which ReminderRule (a date can have several
/// rules at different day offsets), and which channel (in-app and email
/// are tracked as separate sends, matching AlertRule's own
/// sendInApp/sendEmail-are-independent precedent).
export function buildReminderIdempotencyKey(params: {
  importantDateId: string;
  reminderRuleId: string;
  occurrenceYear: number;
  channel: "IN_APP" | "EMAIL";
}): string {
  return `${params.importantDateId}:${params.reminderRuleId}:${params.occurrenceYear}:${params.channel}`;
}

/// Builds Task.importantDateOccurrenceKey for an auto-created task (spec:
/// "creating the same auto-task twice for the same recurring occurrence
/// must never happen" - enforced at the DB level by
/// @@unique([importantDateId, importantDateOccurrenceKey]) on Task, this
/// is just the value going into that column). Deliberately does NOT
/// include a rule or channel component (unlike the reminder key above) -
/// an ImportantDate has at most one auto-task per occurrence year
/// regardless of how many ReminderRules exist on it (createAutoTask is a
/// property of the ImportantDate itself, not of any one rule).
export function buildAutoTaskOccurrenceKey(occurrenceYear: number): string {
  return `occurrence:${occurrenceYear}`;
}

// ---------------------------------------------------------------------------
// Message templates
// ---------------------------------------------------------------------------

export interface ReminderMessageInput {
  clientName: string;
  dateTitle: string;
  occurrenceDate: string; // pre-formatted, e.g. "28/02/2026" - formatting is a display concern, not this module's
  daysBefore: number;
}

/// Plain-text in-app notification body (Notification.type will be a new
/// "important_date.reminder" string - free-string precedent, same as
/// every other Notification.type value - no schema change needed).
export function buildInAppReminderMessage(input: ReminderMessageInput): string {
  const when = input.daysBefore === 0 ? "היום" : input.daysBefore === 1 ? "מחר" : `בעוד ${input.daysBefore} ימים`;
  return `${input.dateTitle} (${input.clientName}) - ${when}, בתאריך ${input.occurrenceDate}.`;
}

export function buildEmailReminderSubject(input: ReminderMessageInput): string {
  return `תזכורת: ${input.dateTitle} - ${input.clientName}`;
}

export function buildEmailReminderBody(input: ReminderMessageInput): string {
  const when = input.daysBefore === 0 ? "היום" : input.daysBefore === 1 ? "מחר" : `בעוד ${input.daysBefore} ימים`;
  return [
    `שלום,`,
    ``,
    `מועד חשוב מתקרב עבור ${input.clientName}:`,
    `${input.dateTitle} - ${when} (${input.occurrenceDate}).`,
    ``,
    `הודעה זו נשלחה אוטומטית ממערכת ניהול הזמן של Ankora.`,
  ].join("\n");
}

export function buildEscalationMessage(input: ReminderMessageInput & { originalResponsibleName: string }): string {
  return `${input.dateTitle} (${input.clientName}) לא טופל על ידי ${input.originalResponsibleName} - המועד חל ב-${input.occurrenceDate}.`;
}
