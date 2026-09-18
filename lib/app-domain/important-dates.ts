import "server-only";
import { prisma } from "@/lib/prisma";
import { ForbiddenError, assertCan, canManageClients } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { computeNextOccurrence } from "@/lib/app-domain/important-dates-recurrence";
import { DEFAULT_REMINDER_OFFSETS_BY_CATEGORY } from "@/lib/app-domain/important-dates-reminders";
import { HOLIDAY_CATALOG, HOLIDAY_CALENDAR_LABELS, type HolidayCalendarKey } from "@/lib/app-domain/important-dates-holidays";
import type {
  User,
  ImportantDate,
  ImportantDateCategory,
  ImportantDateStatus,
  ImportantDateSensitivity,
  CalendarType,
  RecurrenceType,
} from "@prisma/client";

// Phase 10 domain service (spec: "מועדים חשובים" - Important Dates).
// Follows lib/app-domain/tasks.ts's access-scoping precedent (no dedicated
// `important_date.*` CRUD permission - see permissions.ts's Phase 10
// comment): "can this user see/act on this ImportantDate" reduces to "can
// this user see/act on this date's client," answered by
// listAccessibleClients()/canManageClients(), exactly like Tasks. The one
// exception is HolidayCalendarSubscription management, which DOES require
// `important_date.manage_catalog` (SUPER_ADMIN-only) - see that file.
//
// Optimistic concurrency follows the exact Phase 7 pattern from
// time-entries.ts (ConflictError + expectedUpdatedAt compare) rather than
// a version column, per the spec's own "לפי הדפוס הקיים" instruction.

export class ConflictError extends Error {
  constructor(public readonly current: ImportantDate) {
    super("This date was changed by someone else since you opened it.");
    this.name = "ConflictError";
  }
}

async function assertClientAccess(actor: User, clientId: string) {
  const accessible = await listAccessibleClients(actor);
  if (!accessible.some((c) => c.id === clientId)) {
    throw new ForbiddenError("You are not assigned to this client.");
  }
}

async function requireDate(id: string) {
  const date = await prisma.importantDate.findFirst({ where: { id, deletedAt: null } });
  if (!date) throw new Error("Important date not found.");
  return date;
}

// ---------------------------------------------------------------------------
// Sensitivity / field-redaction (spec: "medical dates default to
// Sensitive"; and a hard "never store" list for specific field shapes)
// ---------------------------------------------------------------------------

/// Spec's explicit "never store" list: passport/visa NUMBERS, detailed
/// medical information, scanned documents. This module's own `notes`
/// field is free text and is NEVER a substitute for those - the UI layer
/// (Phase 10 UI, app/(product)/app/(authenticated)/important-dates/) must
/// never render an input labeled in a way that invites entering one of
/// these (e.g. no "passport number" field exists anywhere in the schema -
/// see ImportantDate in prisma/schema.prisma, which only has
/// relatedEntityType/relatedEntityName/relationToClient as free strings
/// for WHO/WHAT the date is about, never a document number or medical
/// detail field). This function is a defensive, best-effort runtime guard
/// against notes text that looks like it's trying to store one anyway -
/// it never silently drops content; it throws, so the caller sees the
/// rejection and can rephrase, exactly like FutureEntryError does for
/// time entries.
const PASSPORT_LIKE_PATTERN = /\b[A-Za-z]{1,2}\d{6,9}\b/; // heuristic: 1-2 letters + 6-9 digits, typical passport/ID document number shapes.

export function assertNotesDoNotContainForbiddenData(notes: string | null | undefined): void {
  if (!notes) return;
  if (PASSPORT_LIKE_PATTERN.test(notes)) {
    throw new Error(
      "הערות לא יכולות לכלול מספרי דרכון/מסמך. אנא הסירו את המספר מהטקסט (מדיניות המערכת: לעולם לא לשמור מספרי מסמכים או פרטים רפואיים מפורטים)."
    );
  }
}

/// A field a caller (UI, export, notification body) should redact for a
/// SENSITIVE date when the viewer is not its responsible user, an
/// additional user on it, or an admin. Mirrors spec's "medical dates
/// default to Sensitive" intent: sensitivity restricts WHO sees the
/// date's details, not just a display flag.
export function canViewSensitiveDetails(actor: User, date: Pick<ImportantDate, "sensitivity" | "responsibleUserId" | "additionalUserIds">): boolean {
  if (date.sensitivity !== "SENSITIVE") return true;
  if (canManageClients(actor.role)) return true;
  if (date.responsibleUserId === actor.id) return true;
  if (date.additionalUserIds.includes(actor.id)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

// Shared with ImportantDateInput.reminderRules below and with the
// default-offsets fallback in createImportantDate() - both branches of that
// function's `??` need to resolve to this exact same type. Without it, TS
// unions the two branches into `FullShape | { daysBefore: number }`, and
// accessing r.sendInApp on the merged array errors with "Property
// 'sendInApp' does not exist on type '{ daysBefore: number }'" - invisible
// in this sandbox (no generated Prisma Client to run a real build against),
// but caught immediately by a real `tsc`/Vercel build.
type ReminderRuleCreateInput = { daysBefore: number; sendInApp?: boolean; sendEmail?: boolean; createTask?: boolean };

export interface ImportantDateInput {
  clientId: string;
  title: string;
  type: string;
  category: ImportantDateCategory;
  relatedEntityType?: string | null;
  relatedEntityName?: string | null;
  relationToClient?: string | null;
  calendarType?: CalendarType;
  month: number;
  day: number;
  originYear?: number | null;
  recurrence?: RecurrenceType;
  customIntervalDays?: number | null;
  onceDate?: Date | null;
  leapDayUseMarchFirst?: boolean;
  hebrewAdarTwoInLeapYear?: boolean;
  timezone?: string;
  responsibleUserId: string;
  additionalUserIds?: string[];
  extraEmailRecipients?: string[];
  sensitivity?: ImportantDateSensitivity;
  notes?: string | null;
  createAutoTask?: boolean;
  autoTaskLeadDays?: number | null;
  autoTaskCategoryId?: string | null;
  /// When provided (and truthy), no explicit ReminderRule list needs to
  /// be passed - defaults are created from DEFAULT_REMINDER_OFFSETS_BY_CATEGORY.
  useDefaultReminders?: boolean;
  reminderRules?: ReminderRuleCreateInput[];
}

function normalizeStringArray(values: string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map((v) => v.trim()).filter(Boolean)));
}

/// Auto-defaults sensitivity to SENSITIVE for the HEALTH_TRAVEL category
/// unless the caller explicitly overrides it - spec: "medical dates
/// default to Sensitive." HEALTH_TRAVEL is the closest category match
/// (there is no separate MEDICAL category - see
/// ImportantDateCategory in prisma/schema.prisma's own 6-category list);
/// travel dates within that same category are not inherently sensitive,
/// but defaulting the whole category to Sensitive is the conservative,
/// privacy-preserving choice, and any user creating a specific date can
/// still set it back to NORMAL explicitly (this is a default, not a
/// lock).
function resolveSensitivityDefault(category: ImportantDateCategory, explicit?: ImportantDateSensitivity): ImportantDateSensitivity {
  if (explicit) return explicit;
  return category === "HEALTH_TRAVEL" ? "SENSITIVE" : "NORMAL";
}

export async function listImportantDates(
  actor: User,
  filters: { clientId?: string; status?: ImportantDateStatus; category?: ImportantDateCategory; responsibleUserId?: string } = {}
) {
  const accessible = await listAccessibleClients(actor);
  const accessibleIds = accessible.map((c) => c.id);
  if (accessibleIds.length === 0) return [];

  const clientId = filters.clientId && accessibleIds.includes(filters.clientId) ? filters.clientId : undefined;

  const dates = await prisma.importantDate.findMany({
    where: {
      deletedAt: null,
      clientId: clientId ?? { in: accessibleIds },
      status: filters.status || undefined,
      category: filters.category || undefined,
      responsibleUserId: filters.responsibleUserId || undefined,
    },
    include: { client: true, responsibleUser: true, reminderRules: true },
    orderBy: [{ nextOccurrenceAt: "asc" }],
  });

  // Redact notes for SENSITIVE dates the caller isn't entitled to see in
  // full - list screens must never leak sensitive details via a card
  // preview even though the underlying row was fetched.
  return dates.map((d) => (canViewSensitiveDetails(actor, d) ? d : { ...d, notes: null }));
}

export async function getImportantDate(actor: User, id: string) {
  const date = await requireDate(id);
  await assertClientAccess(actor, date.clientId);
  const full = await prisma.importantDate.findUniqueOrThrow({
    where: { id },
    include: { client: true, responsibleUser: true, createdBy: true, reminderRules: true, tasks: true },
  });
  return canViewSensitiveDetails(actor, full) ? full : { ...full, notes: null };
}

export async function createImportantDate(actor: User, input: ImportantDateInput) {
  await assertClientAccess(actor, input.clientId);
  assertNotesDoNotContainForbiddenData(input.notes);

  const title = input.title.trim();
  if (!title) throw new Error("כותרת היא שדה חובה.");

  const calendarType = input.calendarType ?? "GREGORIAN";
  const recurrence = input.recurrence ?? "ANNUAL";
  const sensitivity = resolveSensitivityDefault(input.category, input.sensitivity);

  const nextOccurrenceAt = computeNextOccurrence(
    {
      calendarType,
      month: input.month,
      day: input.day,
      recurrence,
      onceDate: input.onceDate ?? null,
      customIntervalDays: input.customIntervalDays ?? null,
      originYear: input.originYear ?? null,
      leapDayUseMarchFirst: input.leapDayUseMarchFirst,
      hebrewAdarTwoInLeapYear: input.hebrewAdarTwoInLeapYear,
      timezone: input.timezone,
    },
    new Date()
  );

  const date = await prisma.importantDate.create({
    data: {
      clientId: input.clientId,
      title,
      type: input.type.trim(),
      category: input.category,
      relatedEntityType: input.relatedEntityType || null,
      relatedEntityName: input.relatedEntityName || null,
      relationToClient: input.relationToClient || null,
      calendarType,
      month: input.month,
      day: input.day,
      originYear: input.originYear ?? null,
      recurrence,
      customIntervalDays: input.customIntervalDays ?? null,
      onceDate: input.onceDate ?? null,
      leapDayUseMarchFirst: input.leapDayUseMarchFirst ?? false,
      hebrewAdarTwoInLeapYear: input.hebrewAdarTwoInLeapYear ?? true,
      timezone: input.timezone || "Asia/Jerusalem",
      responsibleUserId: input.responsibleUserId,
      additionalUserIds: normalizeStringArray(input.additionalUserIds),
      extraEmailRecipients: normalizeStringArray(input.extraEmailRecipients),
      sensitivity,
      notes: input.notes || null,
      createAutoTask: input.createAutoTask ?? false,
      autoTaskLeadDays: input.autoTaskLeadDays ?? null,
      autoTaskCategoryId: input.autoTaskCategoryId || null,
      nextOccurrenceAt,
      source: "MANUAL",
      createdById: actor.id,
      reminderRules: {
        create: (
          input.reminderRules ?? (input.useDefaultReminders !== false
            ? DEFAULT_REMINDER_OFFSETS_BY_CATEGORY[input.category].map(
                (daysBefore): ReminderRuleCreateInput => ({ daysBefore })
              )
            : [])
        ).map((r) => ({
          daysBefore: r.daysBefore,
          sendInApp: r.sendInApp ?? true,
          sendEmail: r.sendEmail ?? false,
          createTask: r.createTask ?? false,
          // ReminderRule.extraAnkoraRecipients/clientRecipients are
          // String[] with no @default in the schema (same precedent as
          // AlertRule.recipientsAnkora) - Prisma requires an explicit
          // value on create even when empty.
          extraAnkoraRecipients: [],
          clientRecipients: [],
        })),
      },
    },
    include: { reminderRules: true },
  });

  await recordAudit({
    actorId: actor.id,
    action: "important_date.create",
    entityType: "ImportantDate",
    entityId: date.id,
    clientId: date.clientId,
    after: date,
  });

  return date;
}

export async function updateImportantDate(
  actor: User,
  id: string,
  input: Partial<ImportantDateInput> & { expectedUpdatedAt?: Date }
) {
  const before = await requireDate(id);
  await assertClientAccess(actor, before.clientId);

  if (input.expectedUpdatedAt && input.expectedUpdatedAt.getTime() !== before.updatedAt.getTime()) {
    throw new ConflictError(before);
  }
  assertNotesDoNotContainForbiddenData(input.notes);

  const calendarType = input.calendarType ?? before.calendarType;
  const recurrence = input.recurrence ?? before.recurrence;
  const month = input.month ?? before.month;
  const day = input.day ?? before.day;

  const nextOccurrenceAt = computeNextOccurrence(
    {
      calendarType,
      month,
      day,
      recurrence,
      onceDate: input.onceDate !== undefined ? input.onceDate : before.onceDate,
      customIntervalDays: input.customIntervalDays !== undefined ? input.customIntervalDays : before.customIntervalDays,
      originYear: input.originYear !== undefined ? input.originYear : before.originYear,
      leapDayUseMarchFirst: input.leapDayUseMarchFirst ?? before.leapDayUseMarchFirst,
      hebrewAdarTwoInLeapYear: input.hebrewAdarTwoInLeapYear ?? before.hebrewAdarTwoInLeapYear,
      timezone: input.timezone ?? before.timezone,
    },
    new Date()
  );

  const updated = await prisma.importantDate.update({
    where: { id },
    data: {
      title: input.title?.trim() ?? undefined,
      type: input.type?.trim() ?? undefined,
      category: input.category ?? undefined,
      relatedEntityType: input.relatedEntityType !== undefined ? input.relatedEntityType || null : undefined,
      relatedEntityName: input.relatedEntityName !== undefined ? input.relatedEntityName || null : undefined,
      relationToClient: input.relationToClient !== undefined ? input.relationToClient || null : undefined,
      calendarType: input.calendarType ?? undefined,
      month: input.month ?? undefined,
      day: input.day ?? undefined,
      originYear: input.originYear !== undefined ? input.originYear : undefined,
      recurrence: input.recurrence ?? undefined,
      customIntervalDays: input.customIntervalDays !== undefined ? input.customIntervalDays : undefined,
      onceDate: input.onceDate !== undefined ? input.onceDate : undefined,
      leapDayUseMarchFirst: input.leapDayUseMarchFirst ?? undefined,
      hebrewAdarTwoInLeapYear: input.hebrewAdarTwoInLeapYear ?? undefined,
      timezone: input.timezone || undefined,
      responsibleUserId: input.responsibleUserId ?? undefined,
      additionalUserIds: input.additionalUserIds ? normalizeStringArray(input.additionalUserIds) : undefined,
      extraEmailRecipients: input.extraEmailRecipients ? normalizeStringArray(input.extraEmailRecipients) : undefined,
      sensitivity: input.sensitivity ?? undefined,
      notes: input.notes !== undefined ? input.notes || null : undefined,
      createAutoTask: input.createAutoTask ?? undefined,
      autoTaskLeadDays: input.autoTaskLeadDays !== undefined ? input.autoTaskLeadDays : undefined,
      autoTaskCategoryId: input.autoTaskCategoryId !== undefined ? input.autoTaskCategoryId || null : undefined,
      nextOccurrenceAt,
    },
  });

  await recordAudit({
    actorId: actor.id,
    action: "important_date.update",
    entityType: "ImportantDate",
    entityId: id,
    clientId: before.clientId,
    before,
    after: updated,
  });

  return updated;
}

/// Status transitions (spec's six-status lifecycle: ACTIVE,
/// NEEDS_ATTENTION, IN_PROGRESS, HANDLED_CURRENT, PAUSED, ARCHIVED). For a
/// recurring date, moving to HANDLED_CURRENT means "handled for the
/// CURRENT occurrence only" - the daily job (important-dates-job.ts,
/// task #357) is responsible for rolling a HANDLED_CURRENT recurring date
/// back to ACTIVE once nextOccurrenceAt has advanced past the occurrence
/// that was handled, so a status set once doesn't silently suppress next
/// year's reminder forever. A ONCE-recurrence date moved to
/// HANDLED_CURRENT or ARCHIVED stays there (there is no next occurrence
/// to roll forward to).
export async function updateImportantDateStatus(actor: User, id: string, status: ImportantDateStatus) {
  const before = await requireDate(id);
  await assertClientAccess(actor, before.clientId);

  const updated = await prisma.importantDate.update({
    where: { id },
    data: {
      status,
      archivedAt: status === "ARCHIVED" ? new Date() : status === before.status ? undefined : null,
      currentOccurrenceAt: status === "HANDLED_CURRENT" ? before.nextOccurrenceAt : undefined,
    },
  });

  await recordAudit({
    actorId: actor.id,
    action: "important_date.status_change",
    entityType: "ImportantDate",
    entityId: id,
    clientId: before.clientId,
    before,
    after: updated,
  });

  return updated;
}

export async function snoozeImportantDate(actor: User, id: string, snoozedUntil: Date) {
  const before = await requireDate(id);
  await assertClientAccess(actor, before.clientId);

  const updated = await prisma.importantDate.update({ where: { id }, data: { snoozedUntil } });

  await recordAudit({
    actorId: actor.id,
    action: "important_date.snooze",
    entityType: "ImportantDate",
    entityId: id,
    clientId: before.clientId,
    before,
    after: updated,
  });

  return updated;
}

/// Soft delete - reuses the app-wide `deletedAt` pattern (Client, Task,
/// TimeEntry all follow it; see docs/adr/0001's "Soft Delete" section).
/// Cascades to the date's ReminderRule/ReminderOccurrence rows only at
/// the DB level via onDelete: Cascade on ReminderRule (a hard FK
/// constraint, unrelated to this soft-delete flag) - soft-deleting an
/// ImportantDate does NOT hard-delete its rules/occurrences, it simply
/// stops the daily job from creating new ones (the job always filters on
/// deletedAt: null, same as every other soft-deleted list query in this
/// codebase).
export async function deleteImportantDate(actor: User, id: string) {
  const before = await requireDate(id);
  await assertClientAccess(actor, before.clientId);

  const updated = await prisma.importantDate.update({ where: { id }, data: { deletedAt: new Date() } });

  await recordAudit({
    actorId: actor.id,
    action: "important_date.delete",
    entityType: "ImportantDate",
    entityId: id,
    clientId: before.clientId,
    before,
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Reminder rules (per-date, editable after creation)
// ---------------------------------------------------------------------------

export async function addReminderRule(
  actor: User,
  importantDateId: string,
  input: { daysBefore: number; sendInApp?: boolean; sendEmail?: boolean; createTask?: boolean; escalateToManager?: boolean; escalateAfterDays?: number | null }
) {
  const date = await requireDate(importantDateId);
  await assertClientAccess(actor, date.clientId);

  const rule = await prisma.reminderRule.create({
    data: {
      importantDateId,
      daysBefore: input.daysBefore,
      sendInApp: input.sendInApp ?? true,
      sendEmail: input.sendEmail ?? false,
      createTask: input.createTask ?? false,
      escalateToManager: input.escalateToManager ?? false,
      escalateAfterDays: input.escalateAfterDays ?? null,
      extraAnkoraRecipients: [],
      clientRecipients: [],
    },
  });

  await recordAudit({
    actorId: actor.id,
    action: "reminder_rule.create",
    entityType: "ReminderRule",
    entityId: rule.id,
    clientId: date.clientId,
    after: rule,
  });

  return rule;
}

export async function removeReminderRule(actor: User, ruleId: string) {
  const rule = await prisma.reminderRule.findUniqueOrThrow({ where: { id: ruleId }, include: { importantDate: true } });
  await assertClientAccess(actor, rule.importantDate.clientId);

  await prisma.reminderRule.delete({ where: { id: ruleId } });

  await recordAudit({
    actorId: actor.id,
    action: "reminder_rule.delete",
    entityType: "ReminderRule",
    entityId: ruleId,
    clientId: rule.importantDate.clientId,
    before: rule,
  });
}

// ---------------------------------------------------------------------------
// Holiday calendar subscriptions (SUPER_ADMIN only - important_date.manage_catalog)
// ---------------------------------------------------------------------------

export function listHolidayCalendars() {
  return Object.entries(HOLIDAY_CALENDAR_LABELS).map(([calendarKey, label]) => ({
    calendarKey,
    label,
    holidayCount: HOLIDAY_CATALOG.filter((h) => h.calendarKeys.includes(calendarKey as HolidayCalendarKey)).length,
  }));
}

export async function listHolidaySubscriptionsForClient(actor: User, clientId: string) {
  await assertClientAccess(actor, clientId);
  return prisma.holidayCalendarSubscription.findMany({ where: { clientId } });
}

export async function setHolidayCalendarSubscription(
  actor: User,
  clientId: string,
  calendarKey: string,
  input: { enabled: boolean; defaultReminderDaysBefore?: number[]; responsibleUserId?: string | null; createTasks?: boolean }
) {
  assertCan(actor.role, "important_date.manage_catalog");
  await assertClientAccess(actor, clientId);

  const sub = await prisma.holidayCalendarSubscription.upsert({
    where: { clientId_calendarKey: { clientId, calendarKey } },
    create: {
      clientId,
      calendarKey,
      enabled: input.enabled,
      defaultReminderDaysBefore: input.defaultReminderDaysBefore ?? [30, 7],
      responsibleUserId: input.responsibleUserId || null,
      createTasks: input.createTasks ?? false,
    },
    update: {
      enabled: input.enabled,
      defaultReminderDaysBefore: input.defaultReminderDaysBefore ?? undefined,
      responsibleUserId: input.responsibleUserId !== undefined ? input.responsibleUserId || null : undefined,
      createTasks: input.createTasks ?? undefined,
    },
  });

  await recordAudit({
    actorId: actor.id,
    action: "holiday_calendar_subscription.update",
    entityType: "HolidayCalendarSubscription",
    entityId: sub.id,
    clientId,
    after: sub,
  });

  return sub;
}

// ---------------------------------------------------------------------------
// Dashboard / client-detail widgets
// ---------------------------------------------------------------------------

/// Overview dashboard "upcoming dates" card - the next N occurrences
/// across every client the actor can see, ACTIVE/NEEDS_ATTENTION/
/// IN_PROGRESS only (never PAUSED/ARCHIVED/HANDLED_CURRENT), sensitivity-
/// redacted the same way listImportantDates is.
export async function listUpcomingImportantDates(actor: User, limit = 5) {
  const accessible = await listAccessibleClients(actor);
  const accessibleIds = accessible.map((c) => c.id);
  if (accessibleIds.length === 0) return [];

  const dates = await prisma.importantDate.findMany({
    where: {
      deletedAt: null,
      clientId: { in: accessibleIds },
      status: { in: ["ACTIVE", "NEEDS_ATTENTION", "IN_PROGRESS"] },
      nextOccurrenceAt: { not: null },
    },
    include: { client: true },
    orderBy: { nextOccurrenceAt: "asc" },
    take: limit,
  });

  return dates.map((d) => (canViewSensitiveDetails(actor, d) ? d : { ...d, notes: null }));
}

export const IMPORTANT_DATE_STATUS_LABELS: Record<ImportantDateStatus, string> = {
  ACTIVE: "פעיל",
  NEEDS_ATTENTION: "דורש טיפול",
  IN_PROGRESS: "בטיפול",
  HANDLED_CURRENT: "טופל (מחזור נוכחי)",
  PAUSED: "מושהה",
  ARCHIVED: "בארכיון",
};
