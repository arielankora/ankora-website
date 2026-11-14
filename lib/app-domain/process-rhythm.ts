import "server-only";
import { Prisma } from "@prisma/client";
import type { ProcessStartKind, ProcessTrigger, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DomainError } from "@/lib/domain-error";
import { assertCan } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { assertClientAccess } from "@/lib/app-domain/client-sources";
import { createImportantDate, deleteImportantDate } from "@/lib/app-domain/important-dates";
import { calendarOfProcess, syncDateCalendars } from "@/lib/app-domain/date-calendars";
import { computeLeadDate, computeNextOccurrence, computeRawNextOccurrence, recurrenceInputFromRow, type RecurrenceInput } from "@/lib/app-domain/important-dates-recurrence";
import { findSecrets } from "@/lib/secret-scan";
import { isBusinessCalendarKey } from "@/lib/business-calendar";
import { localDateKey, TIMEZONE } from "@/lib/timezone";
import { readSteps } from "@/lib/process-rules";
import { runLeadBusinessDays } from "@/lib/process-runs";
import {
  datesForRule,
  describeRhythm,
  isLegacySchedule,
  kindsOf,
  readRule,
  rhythmError,
  ruleError,
  type DateSpec,
  type ScheduleRule,
  type StartInput,
  type StoredStart,
} from "@/lib/process-rhythm";

// The rhythm of a process, stored (13.11.2026, processes redesign, stage 1;
// ops-runbooks/processes-redesign-spec-2026-11-13.md in claude-backup,
// 4.2 and 5.3). The editor sends the whole rhythm; it replaces what was
// there. A schedule's dates are generated from its rule and are edited
// from here only. Process.triggerKinds, triggerText, checkEveryDays and
// checkText are written from the rhythm on every save, so the daily job,
// readiness, the document and Claude keep reading them as before.

const START_SELECT = {
  id: true,
  kind: true,
  schedule: true,
  description: true,
  checkEveryDays: true,
  checkText: true,
  externalWhere: true,
  externalWhen: true,
  externalRecipient: true,
  sortOrder: true,
} as const;

const DATE_SELECT = {
  id: true,
  processStartId: true,
  recurrence: true,
  month: true,
  day: true,
  weekday: true,
  intervalMonths: true,
  onceDate: true,
  rollConvention: true,
  nextOccurrenceAt: true,
  status: true,
} as const;

async function findProcess(actor: User, id: string) {
  const row = await prisma.process.findUnique({ where: { id } });
  if (!row || row.deletedAt) throw new DomainError("processes.notFound", "התהליך לא נמצא.");
  await assertClientAccess(actor, row.clientId);
  return row;
}

function toStored(s: { kind: ProcessStartKind; schedule: Prisma.JsonValue; description: string | null; checkEveryDays: number | null; checkText: string | null; externalWhere: string | null; externalWhen: string | null; externalRecipient: string | null }): StoredStart {
  return { kind: s.kind, schedule: s.schedule, description: s.description, checkEveryDays: s.checkEveryDays, checkText: s.checkText, externalWhere: s.externalWhere, externalWhen: s.externalWhen, externalRecipient: s.externalRecipient };
}

/// The rhythm as the editor and the card read it.
export async function getProcessRhythm(actor: User, processId: string) {
  assertCan(actor.role, "time_entry.create_self");
  const process = await findProcess(actor, processId);
  const [starts, dates] = await Promise.all([
    prisma.processStart.findMany({ where: { processId }, orderBy: { sortOrder: "asc" }, select: START_SELECT }),
    prisma.importantDate.findMany({ where: { processId, deletedAt: null }, select: DATE_SELECT, orderBy: { nextOccurrenceAt: "asc" } }),
  ]);
  return {
    processId,
    notes: process.triggerNotes,
    starts: starts.map((s) => ({ ...toStored(s), id: s.id, legacy: s.kind === "SCHEDULE" && isLegacySchedule(s.schedule) })),
    dates,
    sentence: describeRhythm(starts.map(toStored), dates),
  };
}

function sameRule(a: unknown, b: ScheduleRule): boolean {
  const r = readRule(a);
  return !!r && JSON.stringify(r) === JSON.stringify(b);
}

/// Saves the whole rhythm. What the editor no longer has is removed: a
/// schedule's generated dates are deleted, dates linked before stage 1 are
/// unlinked and stay in the client's dates as they were.
export async function saveProcessRhythm(actor: User, processId: string, starts: StartInput[], notes?: string | null, options: { businessCalendar?: string | null } = {}) {
  assertCan(actor.role, "time_entry.create_self");
  const process = await findProcess(actor, processId);
  const error = rhythmError(starts);
  if (error) throw new DomainError("processes.rhythmInvalid", error.message);
  const words = [notes, ...starts.map((s) => (s.kind === "EVENT" ? s.description : s.kind === "CONTINUOUS" ? s.checkText : s.kind === "EXTERNAL" ? `${s.where} ${s.when} ${s.recipient ?? ""}` : ""))]
    .filter(Boolean)
    .join("\n");
  if (findSecrets(words).length) throw new DomainError("processes.secrets", "יש כאן סיסמה, מפתח או מספר כרטיס. סודות נשמרים בכספת, לא בתיק.");

  const before = await getProcessRhythm(actor, processId);
  // The business calendar is set next to the dates it moves (the board's
  // "לוח ימי עבודה ... שינוי"). Null: the entity's country decides.
  if (options.businessCalendar !== undefined) {
    if (options.businessCalendar !== null && !isBusinessCalendarKey(options.businessCalendar)) throw new DomainError("processes.calendarUnknown", "לוח ימי העבודה לא מוכר.");
    if (options.businessCalendar !== process.businessCalendar) {
      await prisma.process.update({ where: { id: processId }, data: { businessCalendar: options.businessCalendar } });
      process.businessCalendar = options.businessCalendar;
    }
  }
  const existing = await prisma.processStart.findMany({ where: { processId }, select: { id: true, kind: true, schedule: true } });
  const byKind = new Map(existing.map((s) => [s.kind, s]));
  const calendar = await calendarOfProcess(process);

  // Starts that are gone.
  for (const s of existing) {
    if (starts.some((n) => n.kind === s.kind)) continue;
    if (s.kind === "SCHEDULE") await dropScheduleDates(actor, processId, s.id, isLegacySchedule(s.schedule));
    await prisma.processStart.delete({ where: { id: s.id } });
  }

  for (const [i, start] of starts.entries()) {
    const kept = byKind.get(start.kind);
    const data = {
      sortOrder: i,
      description: start.kind === "EVENT" ? start.description.trim() : null,
      checkEveryDays: start.kind === "CONTINUOUS" ? start.checkEveryDays : null,
      checkText: start.kind === "CONTINUOUS" ? start.checkText?.trim() || null : null,
      externalWhere: start.kind === "EXTERNAL" ? start.where.trim() : null,
      externalWhen: start.kind === "EXTERNAL" ? start.when.trim() : null,
      externalRecipient: start.kind === "EXTERNAL" ? start.recipient?.trim() || null : null,
      schedule: start.kind === "SCHEDULE" ? (start.schedule as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
    };
    if (start.kind !== "SCHEDULE") {
      if (kept) await prisma.processStart.update({ where: { id: kept.id }, data });
      else await prisma.processStart.create({ data: { ...data, processId, clientId: process.clientId, kind: start.kind } });
      continue;
    }
    // A legacy schedule kept as it is: its dates stay.
    if (start.schedule === null) {
      if (!kept || !isLegacySchedule(kept.schedule)) throw new DomainError("processes.rhythmInvalid", "צריך לבחור כל כמה זמן.");
      await prisma.processStart.update({ where: { id: kept.id }, data: { sortOrder: i } });
      continue;
    }
    const rule = start.schedule;
    // A schedule: unchanged, its dates stay. Changed, its dates are
    // replaced by the rule's.
    if (kept && sameRule(kept.schedule, rule)) {
      await prisma.processStart.update({ where: { id: kept.id }, data: { sortOrder: i } });
      continue;
    }
    const row = kept
      ? await prisma.processStart.update({ where: { id: kept.id }, data })
      : await prisma.processStart.create({ data: { ...data, processId, clientId: process.clientId, kind: "SCHEDULE" } });
    if (kept) await dropScheduleDates(actor, processId, kept.id, isLegacySchedule(kept.schedule));
    for (const spec of datesForRule(rule)) {
      const created = await createImportantDate(actor, {
        clientId: process.clientId,
        title: `${process.code} ${process.title}`.slice(0, 200),
        type: "CLIENT",
        category: "GENERAL",
        calendarType: "GREGORIAN",
        month: spec.month,
        day: spec.day,
        recurrence: spec.recurrence,
        weekday: spec.weekday,
        intervalMonths: spec.intervalMonths,
        onceDate: spec.onceDate ? new Date(`${spec.onceDate}T00:00:00Z`) : null,
        rollConvention: spec.rollConvention,
        businessCalendar: calendar?.key ?? "IL",
        autoTaskLeadDays: rule.leadBusinessDays,
        leadUnit: "BUSINESS_DAYS",
        rangeStart: rule.rangeStart ? new Date(`${rule.rangeStart}T00:00:00Z`) : null,
        rangeEnd: rule.rangeEnd ? new Date(`${rule.rangeEnd}T00:00:00Z`) : null,
        conditionText: rule.condition,
        responsibleUserId: process.ownerId ?? actor.id,
        useDefaultReminders: false,
        reminderRules: [],
      });
      await prisma.importantDate.update({ where: { id: created.id }, data: { processId, processStartId: row.id } });
    }
  }
  await syncDateCalendars({ processId });

  const after = await prisma.processStart.findMany({ where: { processId }, orderBy: { sortOrder: "asc" }, select: START_SELECT });
  const dates = await prisma.importantDate.findMany({ where: { processId, deletedAt: null }, select: DATE_SELECT });
  const continuous = starts.find((s) => s.kind === "CONTINUOUS");
  const updated = await prisma.process.update({
    where: { id: processId },
    data: {
      triggerKinds: kindsOf(after) as ProcessTrigger[],
      triggerText: describeRhythm(after.map(toStored), dates),
      triggerNotes: notes === undefined ? undefined : notes?.trim() || null,
      checkEveryDays: continuous?.kind === "CONTINUOUS" ? continuous.checkEveryDays : null,
      checkText: continuous?.kind === "CONTINUOUS" ? continuous.checkText?.trim() || null : null,
    },
  });
  await recordAudit({
    actorId: actor.id,
    action: "process.rhythm",
    entityType: "Process",
    entityId: processId,
    clientId: process.clientId,
    before: { sentence: before.sentence, starts: before.starts.map((s) => s.kind), notes: before.notes },
    after: { sentence: updated.triggerText, starts: after.map((s) => s.kind), notes: updated.triggerNotes },
  });
  return updated;
}

/// Generated dates are deleted; dates linked before stage 1 were made by
/// someone, maybe with reminders, and are only unlinked.
async function dropScheduleDates(actor: User, processId: string, startId: string, legacy: boolean) {
  const dates = await prisma.importantDate.findMany({ where: { processId, deletedAt: null, OR: [{ processStartId: startId }, ...(legacy ? [{ processStartId: null }] : [])] }, select: { id: true } });
  for (const d of dates) {
    if (legacy) await prisma.importantDate.update({ where: { id: d.id }, data: { processId: null, processStartId: null } });
    else await deleteImportantDate(actor, d.id);
  }
}

export type RhythmPreviewRow = { date: string; opens: string; movedFrom: string | null };

/// The next occurrences of a rule, before it is saved: the day, the day
/// the run opens, and the day it moved from when a roll moved it.
export async function previewProcessRhythm(actor: User, processId: string, rule: ScheduleRule, count = 5, now = new Date()): Promise<RhythmPreviewRow[]> {
  assertCan(actor.role, "time_entry.create_self");
  const process = await findProcess(actor, processId);
  const error = ruleError(rule);
  if (error) throw new DomainError("processes.rhythmInvalid", error.message);
  const calendar = (await calendarOfProcess(process))?.key ?? "IL";
  const approved = await prisma.processVersion.findFirst({ where: { processId, status: "APPROVED" }, orderBy: { version: "desc" }, select: { steps: true } });
  const bySteps = approved ? runLeadBusinessDays(readSteps(approved.steps)) : 0;
  return occurrencesOf(datesForRule(rule), calendar, Math.max(bySteps, rule.leadBusinessDays ?? 0), count, now, rule);
}

/// How many business days before the date the run opens by the steps
/// alone: the editor offers that, or earlier.
export async function stepsLeadOf(processId: string): Promise<number> {
  const approved = await prisma.processVersion.findFirst({ where: { processId, status: "APPROVED" }, orderBy: { version: "desc" }, select: { steps: true } });
  return approved ? runLeadBusinessDays(readSteps(approved.steps)) : 0;
}

function inputOf(spec: DateSpec, calendar: string, limits?: { rangeStart: string | null; rangeEnd: string | null }): RecurrenceInput {
  return {
    rangeStart: limits?.rangeStart ? new Date(`${limits.rangeStart}T00:00:00Z`) : null,
    rangeEnd: limits?.rangeEnd ? new Date(`${limits.rangeEnd}T00:00:00Z`) : null,
    calendarType: "GREGORIAN",
    month: spec.month,
    day: spec.day,
    recurrence: spec.recurrence,
    weekday: spec.weekday,
    intervalMonths: spec.intervalMonths,
    onceDate: spec.onceDate ? new Date(`${spec.onceDate}T00:00:00Z`) : null,
    rollConvention: spec.rollConvention,
    businessCalendar: calendar,
    timezone: TIMEZONE,
  };
}

export function occurrencesOf(specs: DateSpec[], calendar: string, leadBusinessDays: number, count: number, now: Date, limits?: { rangeStart: string | null; rangeEnd: string | null }): RhythmPreviewRow[] {
  const found = new Map<string, RhythmPreviewRow>();
  for (const spec of specs) {
    const input = inputOf(spec, calendar, limits);
    let from = now;
    for (let i = 0; i < count; i++) {
      const next = computeNextOccurrence(input, from);
      if (!next) break;
      const key = localDateKey(next, TIMEZONE);
      const raw = spec.rollConvention === "NONE" ? null : computeRawNextOccurrence(input, from);
      const rawKey = raw ? localDateKey(raw, TIMEZONE) : null;
      if (!found.has(key)) {
        found.set(key, {
          date: key,
          opens: localDateKey(computeLeadDate(next, leadBusinessDays, "BUSINESS_DAYS", calendar, TIMEZONE), TIMEZONE),
          movedFrom: rawKey && rawKey !== key ? rawKey : null,
        });
      }
      // The day after both, so a roll back never finds the same day again.
      const after = new Date(Math.max(next.getTime(), raw?.getTime() ?? 0) + 24 * 60 * 60 * 1000);
      from = after;
    }
  }
  return [...found.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(0, count);
}

/// Claude's proposals and the process form still write triggerKinds and
/// triggerText. A kind with no start gets one, built from what is known;
/// a start whose kind is gone is removed (its dates stay linked to the
/// process). Never touches a schedule the rhythm editor wrote.
export async function syncStartsFromKinds(processId: string) {
  const process = await prisma.process.findUnique({ where: { id: processId }, select: { id: true, clientId: true, triggerKinds: true, triggerText: true, checkEveryDays: true, checkText: true } });
  if (!process) return;
  const existing = await prisma.processStart.findMany({ where: { processId }, select: { id: true, kind: true } });
  const want: Record<ProcessTrigger, ProcessStartKind> = { SCHEDULED: "SCHEDULE", EVENT: "EVENT", ON_DEMAND: "ON_DEMAND", CONTINUOUS: "CONTINUOUS", EXTERNAL: "EXTERNAL" };
  const wanted = new Set(process.triggerKinds.map((k) => want[k]));
  for (const s of existing) if (!wanted.has(s.kind)) await prisma.processStart.delete({ where: { id: s.id } });
  for (const kind of wanted) {
    const has = existing.find((s) => s.kind === kind);
    if (kind === "CONTINUOUS" && has) {
      await prisma.processStart.update({ where: { id: has.id }, data: { checkEveryDays: process.checkEveryDays, checkText: process.checkText } });
      continue;
    }
    if (has) continue;
    const created = await prisma.processStart.create({
      data: {
        processId,
        clientId: process.clientId,
        kind,
        schedule: kind === "SCHEDULE" ? { legacy: true } : Prisma.DbNull,
        description: kind === "EVENT" ? process.triggerText : null,
        checkEveryDays: kind === "CONTINUOUS" ? process.checkEveryDays : null,
        checkText: kind === "CONTINUOUS" ? process.checkText : null,
        externalWhere: kind === "EXTERNAL" ? process.triggerText ?? "" : null,
        externalWhen: kind === "EXTERNAL" ? "" : null,
        sortOrder: ["SCHEDULE", "EXTERNAL", "EVENT", "CONTINUOUS", "ON_DEMAND"].indexOf(kind),
      },
    });
    if (kind === "SCHEDULE") await prisma.importantDate.updateMany({ where: { processId, deletedAt: null, processStartId: null }, data: { processStartId: created.id } });
  }
}

/// Dates linked to the process by hand (the link drawer, Claude, a next
/// step) belong to its schedule. A schedule the rhythm editor wrote no
/// longer says what its dates are once one is added by hand, so it becomes
/// legacy: its dates stay as they are, and are only unlinked, never
/// deleted, on the next edit. With no schedule, one is made.
export async function attachLinkedDates(processId: string) {
  const loose = await prisma.importantDate.count({ where: { processId, deletedAt: null, processStartId: null } });
  if (!loose) return;
  const process = await prisma.process.findUnique({ where: { id: processId }, select: { clientId: true, triggerKinds: true } });
  if (!process) return;
  let start = await prisma.processStart.findFirst({ where: { processId, kind: "SCHEDULE" }, select: { id: true, schedule: true } });
  if (!start) {
    start = await prisma.processStart.create({ data: { processId, clientId: process.clientId, kind: "SCHEDULE", schedule: { legacy: true }, sortOrder: 0 }, select: { id: true, schedule: true } });
    if (!process.triggerKinds.includes("SCHEDULED")) await prisma.process.update({ where: { id: processId }, data: { triggerKinds: { push: "SCHEDULED" } } });
  } else if (!isLegacySchedule(start.schedule)) {
    await prisma.processStart.update({ where: { id: start.id }, data: { schedule: { legacy: true } } });
  }
  await prisma.importantDate.updateMany({ where: { processId, deletedAt: null, processStartId: null }, data: { processStartId: start.id } });
}

/// What the editor shows around the rule: which business calendar the
/// process follows and why, and how early its steps open a run.
export async function processRhythmContext(actor: User, processId: string) {
  assertCan(actor.role, "time_entry.create_self");
  const process = await findProcess(actor, processId);
  const calendar = await calendarOfProcess(process);
  const entity = process.entityId ? await prisma.clientEntity.findFirst({ where: { id: process.entityId, deletedAt: null }, select: { name: true, country: true } }) : null;
  return {
    /// What the process itself says; null when its entity decides.
    setting: process.businessCalendar,
    /// The calendar in force, how it was decided, and the entity's name.
    calendar: calendar ? { key: calendar.key, by: calendar.by, entityName: calendar.entityName } : null,
    hasEntity: !!entity,
    stepsLead: await stepsLeadOf(processId),
  };
}

/// The next occurrences of the process's own dates, for the "מתי" card on
/// its page: the day, the day its run opens, and the day a roll moved.
export async function upcomingOfProcess(actor: User, processId: string, count = 3, now = new Date()): Promise<RhythmPreviewRow[]> {
  await findProcess(actor, processId);
  const [dates, stepsLead] = await Promise.all([
    prisma.importantDate.findMany({ where: { processId, deletedAt: null, status: { notIn: ["ARCHIVED", "PAUSED"] } } }),
    stepsLeadOf(processId),
  ]);
  const found = new Map<string, RhythmPreviewRow>();
  for (const row of dates) {
    const input = recurrenceInputFromRow(row);
    const lead = Math.max(stepsLead, row.autoTaskLeadDays ?? 0);
    let from = now;
    for (let i = 0; i < count; i++) {
      const next = computeNextOccurrence(input, from);
      if (!next) break;
      const key = localDateKey(next, TIMEZONE);
      const raw = row.rollConvention === "NONE" ? null : computeRawNextOccurrence(input, from);
      const rawKey = raw ? localDateKey(raw, TIMEZONE) : null;
      if (!found.has(key)) found.set(key, { date: key, opens: localDateKey(computeLeadDate(next, lead, "BUSINESS_DAYS", row.businessCalendar, TIMEZONE), TIMEZONE), movedFrom: rawKey && rawKey !== key ? rawKey : null });
      from = new Date(Math.max(next.getTime(), raw?.getTime() ?? 0) + 24 * 60 * 60 * 1000);
    }
  }
  return [...found.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(0, count);
}
