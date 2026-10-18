import "server-only";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/app-auth/audit";
import { processCalendar } from "@/lib/business-calendar";
import { computeNextOccurrence, recurrenceInputFromRow } from "@/lib/app-domain/important-dates-recurrence";

// Org-brain decision 6 (claude/org-brain-spec-2026-10-12.md): a date that
// starts a process is on the process's calendar.
//
// A run already counts its steps in the business days of the process's
// entity (US for NUX Inc). The date itself did not: it kept whatever a
// person picked when it was written, Israel by default, so a Washington
// filing due on Sunday moved to the wrong day, or the run opened on an
// American holiday. Now the date follows the process: the calendar set on
// the process, otherwise its entity's country. A process with neither
// leaves its dates as they are.
//
// Run whenever what decides changes (dates linked, the process's calendar
// or entity, an entity's country), and every night as a sweep, so a date
// is never left on the wrong calendar by a path that forgot to call it.

type ProcessRow = { code: string; title: string; businessCalendar: string | null; entityId: string | null };

/// The process's calendar, with its entity looked up (a removed entity
/// decides nothing).
export async function calendarOfProcess(p: ProcessRow) {
  const entity = p.entityId ? await prisma.clientEntity.findFirst({ where: { id: p.entityId, deletedAt: null }, select: { name: true, country: true } }) : null;
  const c = processCalendar({ businessCalendar: p.businessCalendar, entity });
  return c ? { ...c, code: p.code, title: p.title } : null;
}

export async function syncDateCalendars(where: { clientId?: string; processId?: string } = {}, now = new Date()): Promise<{ changed: number }> {
  const dates = await prisma.importantDate.findMany({
    where: {
      deletedAt: null,
      processId: where.processId ?? { not: null },
      ...(where.clientId ? { clientId: where.clientId } : {}),
    },
    include: { process: { select: { code: true, title: true, businessCalendar: true, entityId: true } } },
  });
  let changed = 0;
  for (const date of dates) {
    if (!date.process) continue;
    const c = await calendarOfProcess(date.process);
    if (!c || c.key === date.businessCalendar) continue;
    // The occurrence moves only if it falls on a day that rolls; computed
    // from now, as saving the date would.
    const next = date.recurrence === "ONCE" && date.nextOccurrenceAt && date.nextOccurrenceAt.getTime() < now.getTime()
      ? date.nextOccurrenceAt
      : computeNextOccurrence(recurrenceInputFromRow({ ...date, businessCalendar: c.key }), now);
    await prisma.importantDate.update({ where: { id: date.id }, data: { businessCalendar: c.key, nextOccurrenceAt: next } });
    await recordAudit({
      actorId: null,
      action: "important_date.calendar",
      entityType: "ImportantDate",
      entityId: date.id,
      clientId: date.clientId,
      before: { businessCalendar: date.businessCalendar, nextOccurrenceAt: date.nextOccurrenceAt },
      after: { businessCalendar: c.key, nextOccurrenceAt: next, by: c.by, process: date.process.code },
    });
    changed++;
  }
  return { changed };
}

/// The calendar a date must have, if its process decides it.
export async function lockedCalendarFor(processId: string | null) {
  if (!processId) return null;
  const process = await prisma.process.findFirst({ where: { id: processId, deletedAt: null }, select: { code: true, title: true, businessCalendar: true, entityId: true } });
  return process ? calendarOfProcess(process) : null;
}
