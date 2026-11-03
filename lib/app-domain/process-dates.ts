import "server-only";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createImportantDate } from "@/lib/app-domain/important-dates";
import { linkProcessDates } from "@/lib/app-domain/processes";
import { assertClientAccess } from "@/lib/app-domain/client-sources";
import type { ProcessDateSchedule } from "@/lib/process-date-schedule";

// 3.11.2026: "להוסיף מועד" on a process only listed the client's dates to
// link. With none that fits, there was nothing to press, and the run
// opened by hand ("פתיחת ריצה") looked like a date and was not one (P7 of
// Grantor: two runs for one day, still "בלי מועד"). The date is created
// here, from the process, and linked to it in one step.

/// Creates a date that starts this process and links it. Its title is the
/// process's, its responsible person the process's owner. No reminders: the
/// run the date opens is the work, and a daily date would remind daily.
export async function addProcessDate(actor: User, processId: string, schedule: ProcessDateSchedule) {
  const process = await prisma.process.findFirst({ where: { id: processId, deletedAt: null }, select: { id: true, clientId: true, code: true, title: true, ownerId: true } });
  if (!process) throw new Error("התהליך לא נמצא.");
  await assertClientAccess(actor, process.clientId);
  const created = await createImportantDate(actor, {
    clientId: process.clientId,
    title: `${process.code} ${process.title}`.slice(0, 200),
    type: "CLIENT",
    category: "GENERAL",
    calendarType: "GREGORIAN",
    month: schedule.month,
    day: schedule.day,
    recurrence: schedule.recurrence,
    weekday: schedule.weekday,
    onceDate: schedule.onceDate,
    responsibleUserId: process.ownerId ?? actor.id,
    useDefaultReminders: false,
    reminderRules: [],
  });
  const linked = await prisma.importantDate.findMany({ where: { processId, deletedAt: null }, select: { id: true } });
  await linkProcessDates(actor, processId, [...linked.map((d) => d.id), created.id]);
  return created;
}
