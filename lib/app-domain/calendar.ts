import "server-only";

import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { listTasks, OPEN_STATUSES } from "@/lib/app-domain/tasks";
import { occurrencesInRange } from "@/lib/app-domain/calendar-occurrences";
import { dayEndInZone, dayStartInZone, localDateKey, TIMEZONE } from "@/lib/timezone";
import { visibleDays, type CalendarShow, type CalendarView } from "@/lib/calendar-keys";

// 19.10.2026, the calendar screen (/app/calendar): open tasks by due
// date and important dates by occurrence, for the days one view draws,
// plus the open tasks that have no due date at all.
//
// Two decisions shape this file:
//
// - **Days are keys, decided here.** A task's due date is stored two ways
//   (UTC midnight of the local day from the task screen, 23:59 local from
//   the MCP server). Both fall on the same Israel day, so every instant is
//   turned into a key with localDateKey and the client only ever sees keys.
//   lib/timezone.ts is server-only, and that is the reason it stays here.
//
// - **Occurrences are computed, not stored.** An important date keeps one
//   `nextOccurrenceAt`. A month view of a monthly date needs every
//   occurrence in the range, so the recurrence engine is walked forward
//   from the first visible day. Holidays are the exception: their rows are
//   GREGORIAN ANNUAL with THIS year's day, which is wrong next year for
//   anything lunar, so they are recomputed from the holiday catalog.

export type CalendarTask = {
  id: string;
  title: string;
  clientName: string;
  /// null for the side panel's undated tasks.
  dueKey: string | null;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  status: string;
  clientVisible: boolean;
  assigneeName: string | null;
};

export type CalendarDate = {
  /// The important date's id. Several occurrences share it.
  id: string;
  title: string;
  clientName: string;
  dayKey: string;
};

export type CalendarData = {
  days: string[];
  tasks: CalendarTask[];
  dates: CalendarDate[];
  undated: CalendarTask[];
  /// 20.10.2026, the drawer: open tasks whose due day is before today,
  /// INCLUDING those before the range on screen. Without this list a task
  /// that slipped last week was on no screen of the calendar at all.
  /// Oldest first: the one that has waited longest is the one to place.
  overdue: CalendarTask[];
  /// The real counts, for the toolbar's buttons: the two lists above stop
  /// at their limit.
  undatedTotal: number;
  overdueTotal: number;
};

/// A drawer list is something someone reads, not a dump. Past this the
/// drawer says how many more there are and links to the tasks screen.
export const UNDATED_LIMIT = 50;
export const OVERDUE_LIMIT = 50;

/// Statuses a date can be in and still belong on a calendar.
const HIDDEN_DATE_STATUSES = new Set(["ARCHIVED", "PAUSED"]);

type TaskRow = Awaited<ReturnType<typeof listTasks>>[number];

function toCalendarTask(t: TaskRow): CalendarTask {
  return {
    id: t.id,
    title: t.title,
    clientName: t.client.name,
    dueKey: t.dueDate ? localDateKey(t.dueDate, TIMEZONE) : null,
    priority: t.priority,
    status: t.status,
    clientVisible: t.clientVisible,
    assigneeName: t.assignedTo?.name ?? null,
  };
}

export async function loadCalendar(
  actor: User,
  opts: { view: CalendarView; date: string; show: CalendarShow; clientId?: string; mine: boolean; today: string }
): Promise<CalendarData> {
  const days = visibleDays(opts.view, opts.date);
  const startKey = days[0];
  const endKey = days[days.length - 1];
  // "שלי" on the calendar is the tasks screen's default: work I carry or
  // supervise. The narrower halves are on the tasks screen.
  const person = opts.mine ? { involvedUserId: actor.id } : {};
  const base = { clientId: opts.clientId, statusIn: OPEN_STATUSES, ...person };

  const wantTasks = opts.show !== "dates";
  const wantDates = opts.show !== "tasks";

  // "Overdue" is due before the start of TODAY, in Israel: a task due
  // today is not late yet. One millisecond before today's start, because
  // `dueBefore` is inclusive.
  const todayStart = dayStartInZone(opts.today);
  const overdueBefore = todayStart ? new Date(todayStart.getTime() - 1) : undefined;

  // The drawer is about tasks, so it follows the same switch.
  const [dated, undated, overdue, dates] = await Promise.all([
    wantTasks ? listTasks(actor, { ...base, dueFrom: dayStartInZone(startKey), dueBefore: dayEndInZone(endKey) }) : [],
    wantTasks ? listTasks(actor, { ...base, noDueDate: true }) : [],
    wantTasks && overdueBefore ? listTasks(actor, { ...base, dueBefore: overdueBefore }) : [],
    wantDates ? loadDates(actor, startKey, endKey, opts.clientId, opts.mine) : [],
  ]);

  const overdueRows = overdue.map(toCalendarTask).sort((a, b) => ((a.dueKey ?? "") < (b.dueKey ?? "") ? -1 : (a.dueKey ?? "") > (b.dueKey ?? "") ? 1 : 0));

  return {
    days,
    tasks: dated.map(toCalendarTask),
    dates,
    undated: undated.slice(0, UNDATED_LIMIT).map(toCalendarTask),
    overdue: overdueRows.slice(0, OVERDUE_LIMIT),
    undatedTotal: undated.length,
    overdueTotal: overdueRows.length,
  };
}

async function loadDates(actor: User, startKey: string, endKey: string, clientId: string | undefined, mine: boolean): Promise<CalendarDate[]> {
  const accessibleIds = (await listAccessibleClients(actor)).map((c) => c.id);
  if (accessibleIds.length === 0) return [];
  const scoped = clientId && accessibleIds.includes(clientId) ? clientId : undefined;

  const rows = await prisma.importantDate.findMany({
    where: {
      deletedAt: null,
      clientId: scoped ?? { in: accessibleIds },
      status: { notIn: ["ARCHIVED", "PAUSED"] },
      ...(mine ? { OR: [{ responsibleUserId: actor.id }, { additionalUserIds: { has: actor.id } }] } : {}),
    },
    include: { client: { select: { name: true } } },
  });

  const out: CalendarDate[] = [];
  for (const row of rows) {
    if (HIDDEN_DATE_STATUSES.has(row.status)) continue;
    // A sensitive date's title is visible on the dates list too; only its
    // notes are redacted (canViewSensitiveDetails), and the calendar never
    // carries notes.
    for (const dayKey of occurrencesInRange(row, startKey, endKey)) {
      out.push({ id: row.id, title: row.title, clientName: row.client.name, dayKey });
    }
  }
  return out.sort((a, b) => (a.dayKey === b.dayKey ? a.title.localeCompare(b.title, "he") : a.dayKey < b.dayKey ? -1 : 1));
}
