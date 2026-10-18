import "server-only";
import type { ImportantDate } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/app-auth/audit";

// Org brain (claude/org-brain-spec-2026-10-12.md, 3.10 and 5.3): a date
// that cannot be scheduled is a question in the client's file, not only a
// notification someone may miss.
//
// - An unknown date ("yearly, day missing") is never scheduled. It shows
//   as a gap on its process, and from now as an open question in section
//   13, for whoever owns the date: "when is it?". Once per date.
// - A conditional date ("quarterly, only if we missed the SLA") asks, on
//   its lead day, whether the condition holds. Besides the notification,
//   the question waits in the file until someone answers it. Once per
//   occurrence.
//
// The question is linked to its date through externalRefs, which is how a
// second run of the job knows it was already asked. A sensitive date asks
// a sensitive question, seen only by its owner, like the date itself.

type DateRow = Pick<ImportantDate, "id" | "clientId" | "title" | "responsibleUserId" | "sensitivity" | "conditionText">;

const ref = (date: { id: string }, occurrence?: string) => ({ system: "ImportantDate", id: date.id, ...(occurrence ? { occurrence } : {}) });

async function asked(date: { id: string; clientId: string }, occurrence?: string): Promise<boolean> {
  const found = await prisma.clientFact.findFirst({
    where: { clientId: date.clientId, kind: "QUESTION", externalRefs: { array_contains: [ref(date, occurrence)] } },
    select: { id: true },
  });
  return !!found;
}

async function ask(date: DateRow, body: string, occurrence?: string) {
  const sensitive = date.sensitivity === "SENSITIVE";
  const fact = await prisma.clientFact.create({
    data: {
      clientId: date.clientId,
      kind: "QUESTION",
      body: body.slice(0, 2000),
      assigneeId: date.responsibleUserId,
      knowledgeStatus: "MISSING",
      toResolve: "תשובה לשאלה.",
      externalRefs: [ref(date, occurrence)],
      ...(sensitive ? { sensitivity: "SENSITIVE" as const, audience: "RESTRICTED" as const, audienceUserIds: [date.responsibleUserId] } : {}),
    },
  });
  await recordAudit({ actorId: null, action: "client_fact.add", entityType: "ClientFact", entityId: fact.id, clientId: date.clientId, after: { kind: "QUESTION", from: "ImportantDate", dateId: date.id, occurrence: occurrence ?? null } });
  return fact;
}

/// The daily job: every live date whose day is unknown asks once.
export async function askUnknownDates(): Promise<{ asked: number }> {
  const dates = await prisma.importantDate.findMany({
    where: { precision: "UNKNOWN", deletedAt: null, archivedAt: null, status: { notIn: ["ARCHIVED", "PAUSED"] } },
    select: { id: true, clientId: true, title: true, responsibleUserId: true, sensitivity: true, conditionText: true },
  });
  let n = 0;
  for (const d of dates) {
    if (await asked(d)) continue;
    await ask(d, `מתי ${d.title}? המועד חוזר, אבל היום שלו לא ידוע, ולכן הוא לא מתוזמן.`);
    n++;
  }
  return { asked: n };
}

/// A conditional date on its lead day: the question for this occurrence,
/// in the file. `dayLabel` is the occurrence as people read it.
export async function askCondition(date: DateRow, occurrenceKey: string, dayLabel: string): Promise<boolean> {
  if (!date.conditionText || (await asked(date, occurrenceKey))) return false;
  await ask(date, `${date.title} (${dayLabel}): האם ${date.conditionText}? אם כן, פותחים משימה.`, occurrenceKey);
  return true;
}
